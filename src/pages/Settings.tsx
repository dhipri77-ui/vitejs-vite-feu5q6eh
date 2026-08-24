import { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth as getSecondaryAuth } from 'firebase/auth';
import { useAccessGuard } from '../lib/useAccessGuard';

interface Project {
  id: string;
  name: string;
  code: string;
  startDate: string;
  completionDate: string;
  assumedManHours: number;
  attendanceMode: string;
  managerEmail?: string;
  budget?: number;
}

interface StaffMember {
  id: string;
  email: string;
  role: string;
}

// Converts a stored 'YYYY-MM-DD' date string to 'DD/MM/YYYY' for display.
const formatDate = (isoDate?: string): string => {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

const firebaseConfig = {
  apiKey: 'AIzaSyCGgUJNRgC2Mx_5gZbZqWVK2UuJBaZw3yo',
  authDomain: 'manpower-management-5e29c.firebaseapp.com',
  projectId: 'manpower-management-5e29c',
  storageBucket: 'manpower-management-5e29c.firebasestorage.app',
  messagingSenderId: '781986664508',
  appId: '1:781986664508:web:dc9407e9e0858eb34cb339',
};

// Shared helper: creates a Firebase Auth account via a throwaway secondary
// app instance, so creating this new login doesn't sign the master out of
// their own session (the same trick handleAssignManager already used).
const createStaffLogin = async (email: string, password: string) => {
  const secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
  const secondaryAuth = getSecondaryAuth(secondaryApp);
  await createUserWithEmailAndPassword(secondaryAuth, email, password);
  await deleteApp(secondaryApp);
};

const FONT_STACK = "'Poppins', 'Segoe UI', Arial, sans-serif";

export default function Settings() {
  const { loading: accessLoading, allowed } = useAccessGuard(['master']);

  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [startDate, setStartDate] = useState('');
  const [completionDate, setCompletionDate] = useState('');
  const [assumedManHours, setAssumedManHours] = useState('');
  const [attendanceMode, setAttendanceMode] = useState('geofence');
  const [budget, setBudget] = useState('');
  type Holiday = { id: string; date: string; name: string };
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');
  const [managerProjectId, setManagerProjectId] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [managerMsg, setManagerMsg] = useState('');

  // Assign HR
  const [hrEmail, setHrEmail] = useState('');
  const [hrPassword, setHrPassword] = useState('');
  const [hrMsg, setHrMsg] = useState('');

  // Assign Accountant
  const [acctEmail, setAcctEmail] = useState('');
  const [acctPassword, setAcctPassword] = useState('');
  const [acctMsg, setAcctMsg] = useState('');

  // Manage existing HR/Accountant logins
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [staffMsg, setStaffMsg] = useState('');

  const fetchProjects = async () => {
    const snapshot = await getDocs(collection(db, 'projects'));
    const list = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as Project[];
    setProjects(list);
  };

  const fetchHolidays = async () => {
    const snapshot = await getDocs(collection(db, 'companyHolidays'));
    const list = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as { id: string; date: string; name: string }[];
    list.sort((a, b) => a.date.localeCompare(b.date));
    setHolidays(list);
  };

  const fetchStaff = async () => {
    const snapshot = await getDocs(collection(db, 'staffRoles'));
    const list = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as StaffMember[];
    list.sort((a, b) => a.email.localeCompare(b.email));
    setStaffList(list);
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayDate || !holidayName) return;
    await addDoc(collection(db, 'companyHolidays'), {
      date: holidayDate,
      name: holidayName,
    });
    setHolidayDate('');
    setHolidayName('');
    fetchHolidays();
  };

  const handleDeleteHoliday = async (id: string) => {
    if (!confirm('Delete this holiday?')) return;
    await deleteDoc(doc(db, 'companyHolidays', id));
    fetchHolidays();
  };

  useEffect(() => {
    fetchProjects();
    fetchHolidays();
    fetchStaff();
  }, []);
  if (accessLoading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }
  if (!allowed) {
    return (
      <div style={{ padding: '40px', fontFamily: FONT_STACK }}>
        <h1 style={{ color: '#dc2626' }}>Access Restricted</h1>
        <p style={{ color: '#666' }}>
          You don't have permission to view this page.
        </p>
      </div>
    );
  }

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !code || !startDate || !completionDate || !assumedManHours)
      return;
    await addDoc(collection(db, 'projects'), {
      name,
      code,
      startDate,
      completionDate,
      assumedManHours: Number(assumedManHours),
      attendanceMode,
      budget: Number(budget || 0),
    });
    setName('');
    setCode('');
    setStartDate('');
    setCompletionDate('');
    setAssumedManHours('');
    setAttendanceMode('geofence');
    setBudget('');
    fetchProjects();
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm('Delete this project?')) return;
    await deleteDoc(doc(db, 'projects', id));
    fetchProjects();
  };

  const handleAssignManager = async (e: React.FormEvent) => {
    e.preventDefault();
    setManagerMsg('');
    if (!managerProjectId || !managerEmail || !managerPassword) {
      setManagerMsg('Please select a project and fill in email/password.');
      return;
    }
    try {
      await createStaffLogin(managerEmail, managerPassword);

      await updateDoc(doc(db, 'projects', managerProjectId), {
        managerEmail,
      });

      setManagerMsg('Project manager created and assigned successfully.');
      setManagerEmail('');
      setManagerPassword('');
      setManagerProjectId('');
      fetchProjects();
    } catch (err: any) {
      setManagerMsg('Error: ' + err.message);
    }
  };

  const handleAssignHR = async (e: React.FormEvent) => {
    e.preventDefault();
    setHrMsg('');
    if (!hrEmail || !hrPassword) {
      setHrMsg('Please fill in email and password.');
      return;
    }
    try {
      await createStaffLogin(hrEmail, hrPassword);
      await addDoc(collection(db, 'staffRoles'), {
        email: hrEmail,
        role: 'hr',
      });
      setHrMsg('HR login created successfully.');
      setHrEmail('');
      setHrPassword('');
      fetchStaff();
    } catch (err: any) {
      setHrMsg('Error: ' + err.message);
    }
  };

  const handleAssignAccountant = async (e: React.FormEvent) => {
    e.preventDefault();
    setAcctMsg('');
    if (!acctEmail || !acctPassword) {
      setAcctMsg('Please fill in email and password.');
      return;
    }
    try {
      await createStaffLogin(acctEmail, acctPassword);
      await addDoc(collection(db, 'staffRoles'), {
        email: acctEmail,
        role: 'accountant',
      });
      setAcctMsg('Accountant login created successfully.');
      setAcctEmail('');
      setAcctPassword('');
      fetchStaff();
    } catch (err: any) {
      setAcctMsg('Error: ' + err.message);
    }
  };

  const handleChangeStaffRole = async (id: string, newRole: string) => {
    setStaffMsg('');
    try {
      await updateDoc(doc(db, 'staffRoles', id), { role: newRole });
      setStaffMsg('Role updated.');
      fetchStaff();
    } catch (err: any) {
      setStaffMsg('Error: ' + err.message);
    }
  };

  const handleRemoveStaff = async (id: string, email: string) => {
    if (
      !confirm(
        `Remove ${email}'s HR/Accountant access? Their login will no longer be able to open any page in the app. Note: this does NOT delete their underlying login account - only removes their app permissions. To fully delete the login itself, do that separately in Firebase Console > Authentication > Users.`
      )
    )
      return;
    try {
      await deleteDoc(doc(db, 'staffRoles', id));
      setStaffMsg('Access removed.');
      fetchStaff();
    } catch (err: any) {
      setStaffMsg('Error: ' + err.message);
    }
  };

  const attendanceModeLabel = (mode: string) => {
    if (mode === 'geofence') return 'Geofence Only';
    if (mode === 'manual') return 'Manual Only';
    if (mode === 'both') return 'Both';
    return mode;
  };

  return (
    <div
      style={{
        padding: '40px',
        fontFamily: FONT_STACK,
        maxWidth: '900px',
      }}
    >
      <div style={{ paddingRight: '170px' }}>
        <p style={companyNameStyle}>Airmech W.L.L</p>
        <h1 style={pageTitleStyle}>Admin Console</h1>
      </div>

      {/* ADD NEW PROJECT */}
      <h3 style={{ ...sectionTitleStyle, marginTop: '100px' }}>
        Add New Project
      </h3>
      <div style={bluePanelStyle}>
        <form
          onSubmit={handleAddProject}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            maxWidth: '400px',
          }}
        >
          <input
            placeholder="Project Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Project Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={inputStyle}
          />
          <label style={labelStyle}>Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={inputStyle}
          />
          <label style={labelStyle}>Planned Completion Date</label>
          <input
            type="date"
            value={completionDate}
            onChange={(e) => setCompletionDate(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Assumed Man Hours"
            type="number"
            value={assumedManHours}
            onChange={(e) => setAssumedManHours(e.target.value)}
            style={inputStyle}
          />
          <label style={labelStyle}>Attendance Mode</label>
          <select
            value={attendanceMode}
            onChange={(e) => setAttendanceMode(e.target.value)}
            style={inputStyle}
          >
            <option value="geofence">Geofence Only</option>
            <option value="manual">Manual Only</option>
            <option value="both">Both (Geofence + Manual Fallback)</option>
          </select>
          <input
            placeholder="Budget"
            type="number"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" style={sectionButtonStyle}>
            Add Project
          </button>
        </form>
      </div>

      {/* COMPANY HOLIDAYS */}
      <h3 style={sectionTitleStyle}>Company Holidays</h3>
      <div style={bluePanelStyle}>
        <p style={{ fontSize: '14px', color: '#1e40af', marginTop: 0 }}>
          Applies automatically to every project.
        </p>
        <form
          onSubmit={handleAddHoliday}
          style={{ display: 'flex', gap: '10px', maxWidth: '450px' }}
        >
          <input
            type="date"
            value={holidayDate}
            onChange={(e) => setHolidayDate(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Holiday Name"
            value={holidayName}
            onChange={(e) => setHolidayName(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="submit" style={{ ...sectionButtonStyle, marginTop: 0 }}>
            Add
          </button>
        </form>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: '15px',
          }}
        >
          <thead>
            <tr
              style={{ textAlign: 'left', borderBottom: '2px solid #93c5fd' }}
            >
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {holidays.map((h) => (
              <tr key={h.id} style={{ borderBottom: '1px solid #bfdbfe' }}>
                <td style={tdStyle}>{formatDate(h.date)}</td>
                <td style={tdStyle}>{h.name}</td>
                <td style={tdStyle}>
                  <button
                    onClick={() => handleDeleteHoliday(h.id)}
                    style={deleteButtonStyle}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ASSIGN PROJECT MANAGER */}
      <h3 style={sectionTitleStyle}>Assign Project Manager</h3>
      <div style={bluePanelStyle}>
        <form
          onSubmit={handleAssignManager}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            maxWidth: '400px',
          }}
        >
          <label style={labelStyle}>Select Project</label>
          <select
            value={managerProjectId}
            onChange={(e) => setManagerProjectId(e.target.value)}
            style={inputStyle}
          >
            <option value="">-- Select a project --</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code}){' '}
                {p.managerEmail ? `— currently: ${p.managerEmail}` : ''}
              </option>
            ))}
          </select>
          <input
            placeholder="Manager Email"
            type="email"
            value={managerEmail}
            onChange={(e) => setManagerEmail(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Manager Password"
            type="password"
            value={managerPassword}
            onChange={(e) => setManagerPassword(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" style={sectionButtonStyle}>
            Create & Assign Manager
          </button>
          {managerMsg && (
            <p
              style={{
                fontSize: '14px',
                color: managerMsg.startsWith('Error') ? '#dc2626' : '#16a34a',
              }}
            >
              {managerMsg}
            </p>
          )}
        </form>
      </div>

      {/* ASSIGN HR */}
      <h3 style={sectionTitleStyle}>Assign HR</h3>
      <div style={bluePanelStyle}>
        <p style={{ fontSize: '14px', color: '#1e40af', marginTop: 0 }}>
          HR logins can access the Employee Master and Idle Pool pages only.
        </p>
        <form
          onSubmit={handleAssignHR}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            maxWidth: '400px',
          }}
        >
          <input
            placeholder="HR Email"
            type="email"
            value={hrEmail}
            onChange={(e) => setHrEmail(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="HR Password"
            type="password"
            value={hrPassword}
            onChange={(e) => setHrPassword(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" style={sectionButtonStyle}>
            Create HR Login
          </button>
          {hrMsg && (
            <p
              style={{
                fontSize: '14px',
                color: hrMsg.startsWith('Error') ? '#dc2626' : '#16a34a',
              }}
            >
              {hrMsg}
            </p>
          )}
        </form>
      </div>

      {/* ASSIGN ACCOUNTANT */}
      <h3 style={sectionTitleStyle}>Assign Accountant</h3>
      <div style={bluePanelStyle}>
        <p style={{ fontSize: '14px', color: '#1e40af', marginTop: 0 }}>
          Accountant logins can access Salary & Pay Slip (all projects) and
          Daily Attendance Summary (all projects) only.
        </p>
        <form
          onSubmit={handleAssignAccountant}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            maxWidth: '400px',
          }}
        >
          <input
            placeholder="Accountant Email"
            type="email"
            value={acctEmail}
            onChange={(e) => setAcctEmail(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Accountant Password"
            type="password"
            value={acctPassword}
            onChange={(e) => setAcctPassword(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" style={sectionButtonStyle}>
            Create Accountant Login
          </button>
          {acctMsg && (
            <p
              style={{
                fontSize: '14px',
                color: acctMsg.startsWith('Error') ? '#dc2626' : '#16a34a',
              }}
            >
              {acctMsg}
            </p>
          )}
        </form>
      </div>

      {/* MANAGE HR & ACCOUNTANT LOGINS */}
      <h3 style={sectionTitleStyle}>Manage HR & Accountant Logins</h3>
      <div style={bluePanelStyle}>
        <p style={{ fontSize: '14px', color: '#1e40af', marginTop: 0 }}>
          Change someone's role, or remove their app access. Removing access
          revokes what they can do in the app but does not delete their
          underlying login - do that separately in Firebase Console if needed.
        </p>
        {staffList.length === 0 ? (
          <p style={{ fontSize: '14px', color: '#1e40af' }}>
            No HR or Accountant logins created yet.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{ textAlign: 'left', borderBottom: '2px solid #93c5fd' }}
              >
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {staffList.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #bfdbfe' }}>
                  <td style={tdStyle}>{s.email}</td>
                  <td style={tdStyle}>
                    <select
                      value={s.role}
                      onChange={(e) =>
                        handleChangeStaffRole(s.id, e.target.value)
                      }
                      style={{ ...inputStyle, padding: '6px' }}
                    >
                      <option value="hr">HR</option>
                      <option value="accountant">Accountant</option>
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => handleRemoveStaff(s.id, s.email)}
                      style={deleteButtonStyle}
                    >
                      Remove Access
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {staffMsg && (
          <p
            style={{
              fontSize: '14px',
              marginTop: '10px',
              color: staffMsg.startsWith('Error') ? '#dc2626' : '#16a34a',
            }}
          >
            {staffMsg}
          </p>
        )}
      </div>

      {/* ALL PROJECTS */}
      <h3 style={sectionTitleStyle}>All Projects</h3>
      <div style={bluePanelStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr
              style={{ textAlign: 'left', borderBottom: '2px solid #93c5fd' }}
            >
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Code</th>
              <th style={thStyle}>Assumed Hrs</th>
              <th style={thStyle}>Budget</th>
              <th style={thStyle}>Attendance</th>
              <th style={thStyle}>Manager</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #bfdbfe' }}>
                <td style={tdStyle}>{p.name}</td>
                <td style={tdStyle}>{p.code}</td>
                <td style={tdStyle}>{p.assumedManHours}</td>
                <td style={tdStyle}>{p.budget || 0}</td>
                <td style={tdStyle}>{attendanceModeLabel(p.attendanceMode)}</td>
                <td style={tdStyle}>{p.managerEmail || '—'}</td>
                <td style={tdStyle}>
                  <button
                    onClick={() => handleDeleteProject(p.id)}
                    style={deleteButtonStyle}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const companyNameStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '26px',
  fontWeight: 800,
  color: '#0d9488',
  margin: '0 0 2px',
};
const pageTitleStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '40px',
  fontWeight: 900,
  color: '#1e3a8a',
  letterSpacing: '0.4px',
  margin: 0,
};
const sectionTitleStyle: React.CSSProperties = {
  marginTop: '35px',
  marginBottom: 0,
  padding: '12px 18px',
  background: '#1e3a8a',
  border: '1px solid #1e3a8a',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '19px',
  fontWeight: 700,
};
const bluePanelStyle: React.CSSProperties = {
  background: '#dbeafe',
  border: '1px solid #93c5fd',
  borderRadius: '0 0 10px 10px',
  padding: '20px',
  marginTop: 0,
};
const labelStyle: React.CSSProperties = { fontSize: '14px', color: '#1e40af' };
const inputStyle: React.CSSProperties = {
  padding: '9px',
  borderRadius: '6px',
  border: '1px solid #93c5fd',
  fontSize: '15px',
  background: '#fff',
};
const sectionButtonStyle: React.CSSProperties = {
  marginTop: '5px',
  padding: '12px 18px',
  background: '#bfdbfe',
  color: '#1e3a8a',
  border: '1px solid #93c5fd',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '15px',
};
const deleteButtonStyle: React.CSSProperties = {
  padding: '5px 10px',
  background: '#dc2626',
  color: '#fff',
  border: 'none',
  borderRadius: '5px',
  cursor: 'pointer',
  fontSize: '12px',
};
const thStyle: React.CSSProperties = {
  padding: '10px 8px',
  fontSize: '15px',
  color: '#1e3a8a',
};
const tdStyle: React.CSSProperties = { padding: '10px 8px', fontSize: '15px' };
