import { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import { workerEmailFor } from '../lib/workerAuth';

interface ActiveAssignment {
  projectId: string;
  projectName: string;
  employeeCode: string;
  employeeName: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
}

type LocStatus = 'idle' | 'checking' | 'inside' | 'outside' | 'error';

const today = () => new Date().toISOString().split('T')[0];

// ---- Device binding helpers ----
const DEVICE_ID_KEY = 'workerDeviceId';

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id =
      (crypto as any).randomUUID?.() ??
      `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/**
 * Checks/binds this browser's device to the given employee code.
 * Returns { ok: true } if this device is allowed to proceed,
 * or { ok: false, message } if it belongs to a different device.
 */
async function checkAndBindDevice(
  employeeCode: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const deviceId = getOrCreateDeviceId();
  const bindingRef = doc(db, 'employeeDevices', employeeCode);
  const snap = await getDoc(bindingRef);

  if (!snap.exists()) {
    // First-ever login for this employee code: bind this device now.
    await setDoc(bindingRef, {
      employeeCode,
      deviceId,
      boundAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  const data = snap.data();
  if (data.deviceId === deviceId) {
    return { ok: true };
  }

  return {
    ok: false,
    message:
      'This employee ID is already registered on another device. Please contact your supervisor if you have switched phones.',
  };
}
// ---- end device binding helpers ----

function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function WorkerCheckIn() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [code, setCode] = useState('');
  const [mobile, setMobile] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [assignment, setAssignment] = useState<ActiveAssignment | null>(null);
  const [loadingAssignment, setLoadingAssignment] = useState(false);

  const [locStatus, setLocStatus] = useState<LocStatus>('idle');
  const [distance, setDistance] = useState<number | null>(null);

  const [todayEntry, setTodayEntry] = useState<{
    checkIn?: string;
    checkOut?: string;
  }>({});
  const [actionMsg, setActionMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try {
      const email = workerEmailFor(code);
      await signInWithEmailAndPassword(auth, email, mobile);

      // Device-binding check happens right after successful auth,
      // before we let the worker proceed to their assignment.
      const deviceCheck = await checkAndBindDevice(code);
      if (!deviceCheck.ok) {
        await signOut(auth);
        setLoginError(deviceCheck.message);
        setLoggingIn(false);
        return;
      }

      setLoggedIn(true);
      await loadAssignment(code);
    } catch (err: any) {
      setLoginError('Invalid employee code or mobile number.');
    } finally {
      setLoggingIn(false);
    }
  };

  const loadAssignment = async (employeeCode: string) => {
    setLoadingAssignment(true);
    try {
      const empQ = query(
        collection(db, 'projectEmployees'),
        where('employeeCode', '==', employeeCode)
      );
      const empSnap = await getDocs(empQ);
      const activeDocs = empSnap.docs.filter((d) => d.data().status !== 'left');
      if (activeDocs.length === 0) {
        setAssignment(null);
        setLoadingAssignment(false);
        return;
      }
      const peData = activeDocs[0].data();
      const projSnap = await getDoc(doc(db, 'projects', peData.projectId));
      if (!projSnap.exists()) {
        setAssignment(null);
        setLoadingAssignment(false);
        return;
      }
      const projData = projSnap.data();
      setAssignment({
        projectId: peData.projectId,
        projectName: projData.name,
        employeeCode: peData.employeeCode,
        employeeName: peData.name,
        latitude: projData.latitude,
        longitude: projData.longitude,
        radiusMeters: projData.radiusMeters,
      });
      await loadTodayEntry(peData.projectId, employeeCode);
      setLoadingAssignment(false);
    } catch (err: any) {
      console.error('loadAssignment error:', err);
      setLoadingAssignment(false);
    }
  };

  const loadTodayEntry = async (projectId: string, employeeCode: string) => {
    const docId = `${projectId}_${employeeCode}_${today()}`;
    const snap = await getDoc(doc(db, 'attendance', docId));
    if (snap.exists()) {
      const data = snap.data();
      setTodayEntry({
        checkIn: data.checkInTime,
        checkOut: data.checkOutTime,
      });
    } else {
      setTodayEntry({});
    }
  };

  const checkLocation = () => {
    if (
      !assignment?.latitude ||
      !assignment?.longitude ||
      !assignment?.radiusMeters
    ) {
      setLocStatus('error');
      return;
    }
    setLocStatus('checking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const dist = distanceMeters(
          pos.coords.latitude,
          pos.coords.longitude,
          assignment.latitude!,
          assignment.longitude!
        );
        setDistance(dist);
        setLocStatus(dist <= assignment.radiusMeters! ? 'inside' : 'outside');
      },
      () => {
        setLocStatus('error');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  useEffect(() => {
    if (assignment) checkLocation();
    // eslint-disable-next-line
  }, [assignment]);

  const handleCheckIn = async () => {
    if (!assignment) return;
    setBusy(true);
    setActionMsg('');
    try {
      const now = new Date();
      const docId = `${assignment.projectId}_${
        assignment.employeeCode
      }_${today()}`;
      await setDoc(
        doc(db, 'attendance', docId),
        {
          projectId: assignment.projectId,
          employeeCode: assignment.employeeCode,
          employeeName: assignment.employeeName,
          date: today(),
          status: 'present',
          markedBy: 'geofence',
          checkInTime: now.toISOString(),
        },
        { merge: true }
      );
      setTodayEntry((prev) => ({ ...prev, checkIn: now.toISOString() }));
      setActionMsg('Checked in successfully at ' + now.toLocaleTimeString());
    } catch (err: any) {
      setActionMsg('Error: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCheckOut = async () => {
    if (!assignment || !todayEntry.checkIn) return;
    setBusy(true);
    setActionMsg('');
    try {
      const now = new Date();
      const inTime = new Date(todayEntry.checkIn);
      const hoursWorked = Math.max(
        0,
        (now.getTime() - inTime.getTime()) / (1000 * 60 * 60)
      );
      const basicHours = Math.min(hoursWorked, 8);
      const otHours = Math.max(0, hoursWorked - 8);
      const docId = `${assignment.projectId}_${
        assignment.employeeCode
      }_${today()}`;
      await setDoc(
        doc(db, 'attendance', docId),
        {
          checkOutTime: now.toISOString(),
          basicHours: Number(basicHours.toFixed(2)),
          otHours: Number(otHours.toFixed(2)),
          totalHours: Number(hoursWorked.toFixed(2)),
          markedBy: 'geofence',
        },
        { merge: true }
      );
      setTodayEntry((prev) => ({ ...prev, checkOut: now.toISOString() }));
      setActionMsg('Checked out successfully at ' + now.toLocaleTimeString());
    } catch (err: any) {
      setActionMsg('Error: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setLoggedIn(false);
    setAssignment(null);
    setCode('');
    setMobile('');
    setTodayEntry({});
    setLocStatus('idle');
  };

  if (!loggedIn) {
    return (
      <div style={pageWrapStyle}>
        <div style={cardStyle}>
          <p style={companyNameStyle}>Airmech W.L.L</p>
          <h2 style={{ marginTop: 0, textAlign: 'center', color: '#1e3a8a' }}>
            Worker Login
          </h2>
          <form
            onSubmit={handleLogin}
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <input
              placeholder="Employee Code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={inputStyle}
            />
            <input
              placeholder="Mobile Number"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              style={inputStyle}
            />
            <button type="submit" style={buttonStyle} disabled={loggingIn}>
              {loggingIn ? 'Logging in...' : 'Login'}
            </button>
          </form>
          {loginError && (
            <p
              style={{ color: '#dc2626', fontSize: '13px', marginTop: '10px' }}
            >
              {loginError}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (loadingAssignment) {
    return (
      <div style={pageWrapStyle}>
        <div style={cardStyle}>
          <p>Loading your assignment...</p>
        </div>
      </div>
    );
  }

  if (!assignment) {
    return (
      <div style={pageWrapStyle}>
        <div style={cardStyle}>
          <p style={{ color: '#dc2626' }}>
            You are not currently assigned to any active project. Please contact
            your supervisor.
          </p>
          <button
            onClick={handleLogout}
            style={{ ...buttonStyle, marginTop: '15px' }}
          >
            Log Out
          </button>
        </div>
      </div>
    );
  }

  if (
    !assignment.latitude ||
    !assignment.longitude ||
    !assignment.radiusMeters
  ) {
    return (
      <div style={pageWrapStyle}>
        <div style={cardStyle}>
          <p style={{ color: '#dc2626' }}>
            Your project ({assignment.projectName}) has not set up a location
            yet. Please contact your Project Manager.
          </p>
          <button
            onClick={handleLogout}
            style={{ ...buttonStyle, marginTop: '15px' }}
          >
            Log Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={pageWrapStyle}>
      <div style={cardStyle}>
        <p style={companyNameStyle}>Airmech W.L.L</p>
        <h2 style={{ marginTop: 0, color: '#1e3a8a' }}>
          {assignment.employeeName}
        </h2>
        <p style={{ color: '#666', marginTop: '-8px' }}>
          {assignment.projectName} · {today()}
        </p>

        {locStatus === 'checking' && (
          <p style={{ color: '#666' }}>Checking your location...</p>
        )}
        {locStatus === 'error' && (
          <p style={{ color: '#dc2626' }}>
            Could not get your location. Please enable location access and try
            again.
          </p>
        )}
        {locStatus === 'outside' && (
          <p style={{ color: '#dc2626' }}>
            You are outside the project area
            {distance !== null ? ` (${Math.round(distance)}m away)` : ''}. Move
            closer to mark your attendance.
          </p>
        )}
        {locStatus === 'inside' && (
          <p style={{ color: '#16a34a' }}>
            You are within the project area. You can mark your attendance.
          </p>
        )}

        {(locStatus === 'outside' || locStatus === 'error') && (
          <button onClick={checkLocation} style={secondaryButtonStyle}>
            Retry Location
          </button>
        )}

        <div style={{ marginTop: '20px' }}>
          {!todayEntry.checkIn && (
            <button
              onClick={handleCheckIn}
              disabled={locStatus !== 'inside' || busy}
              style={buttonStyle}
            >
              {busy ? 'Working...' : 'Check In'}
            </button>
          )}
          {todayEntry.checkIn && !todayEntry.checkOut && (
            <>
              <p style={{ fontSize: '13px', color: '#16a34a' }}>
                Checked in at{' '}
                {new Date(todayEntry.checkIn).toLocaleTimeString()}
              </p>
              <button
                onClick={handleCheckOut}
                disabled={locStatus !== 'inside' || busy}
                style={buttonStyle}
              >
                {busy ? 'Working...' : 'Check Out'}
              </button>
            </>
          )}
          {todayEntry.checkIn && todayEntry.checkOut && (
            <p style={{ fontSize: '14px', color: '#16a34a' }}>
              You've completed your check-in/out for today ({' '}
              {new Date(todayEntry.checkIn).toLocaleTimeString()} →{' '}
              {new Date(todayEntry.checkOut).toLocaleTimeString()}).
            </p>
          )}
        </div>

        {actionMsg && (
          <p
            style={{
              fontSize: '13px',
              color: actionMsg.startsWith('Error') ? '#dc2626' : '#16a34a',
              marginTop: '10px',
            }}
          >
            {actionMsg}
          </p>
        )}

        <button
          onClick={handleLogout}
          style={{ ...secondaryButtonStyle, marginTop: '25px' }}
        >
          Log Out
        </button>
      </div>
    </div>
  );
}

const FONT_STACK = "'Poppins', 'Segoe UI', Arial, sans-serif";

const pageWrapStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f8fafc',
  fontFamily: FONT_STACK,
  padding: '20px',
};
const cardStyle: React.CSSProperties = {
  background: '#fff',
  padding: '28px',
  borderRadius: '12px',
  width: '100%',
  maxWidth: '380px',
  boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
};
const companyNameStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '20px',
  fontWeight: 800,
  color: '#0d9488',
  textAlign: 'center',
  margin: '0 0 4px 0',
};
const inputStyle: React.CSSProperties = {
  padding: '10px',
  borderRadius: '6px',
  border: '1px solid #ccc',
  fontSize: '15px',
  fontFamily: FONT_STACK,
};
const buttonStyle: React.CSSProperties = {
  padding: '12px',
  background: '#1e3a8a',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '15px',
  fontWeight: 600,
  fontFamily: FONT_STACK,
  width: '100%',
};
const secondaryButtonStyle: React.CSSProperties = {
  padding: '10px',
  background: '#64748b',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '13px',
  fontFamily: FONT_STACK,
  width: '100%',
};
