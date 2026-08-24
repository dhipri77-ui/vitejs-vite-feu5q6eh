import { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

interface Project {
  id: string;
  name: string;
}

interface AttendanceRecord {
  employeeCode: string;
  employeeName: string;
  date: string;
  status: string;
  basicHours: number;
  otHours: number;
  totalHours: number;
}

interface EmployeeSummary {
  code: string;
  name: string;
  daysPresent: number;
  totalBasic: number;
  totalOt: number;
  totalHours: number;
}

type ViewMode = 'daily' | 'weekly' | 'monthly' | 'custom';

// Converts a stored 'YYYY-MM-DD' date string to 'DD/MM/YYYY' for display.
const formatDate = (isoDate?: string): string => {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

const todayStr = () => new Date().toISOString().split('T')[0];

const getWeekRange = () => {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  };
};

const getMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
};

export default function AttendanceSummary() {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [customStart, setCustomStart] = useState(todayStr());
  const [customEnd, setCustomEnd] = useState(todayStr());
  const [summaries, setSummaries] = useState<EmployeeSummary[]>([]);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user?.email) {
        const q = query(
          collection(db, 'projects'),
          where('managerEmail', '==', user.email)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const docSnap = snapshot.docs[0];
          setProject({ id: docSnap.id, ...docSnap.data() } as Project);
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const getDateRange = (): { start: string; end: string } => {
    if (viewMode === 'daily') return { start: selectedDate, end: selectedDate };
    if (viewMode === 'weekly') return getWeekRange();
    if (viewMode === 'monthly') return getMonthRange();
    return { start: customStart, end: customEnd };
  };

  const fetchSummary = async () => {
    if (!project) return;
    setFetching(true);
    const { start, end } = getDateRange();

    const q = query(
      collection(db, 'attendance'),
      where('projectId', '==', project.id),
      where('date', '>=', start),
      where('date', '<=', end)
    );
    const snapshot = await getDocs(q);
    const records = snapshot.docs.map((d) => d.data()) as AttendanceRecord[];

    const map: { [code: string]: EmployeeSummary } = {};
    records.forEach((r) => {
      if (!map[r.employeeCode]) {
        map[r.employeeCode] = {
          code: r.employeeCode,
          name: r.employeeName,
          daysPresent: 0,
          totalBasic: 0,
          totalOt: 0,
          totalHours: 0,
        };
      }
      if (r.status === 'present') {
        map[r.employeeCode].daysPresent += 1;
        map[r.employeeCode].totalBasic += r.basicHours || 0;
        map[r.employeeCode].totalOt += r.otHours || 0;
        map[r.employeeCode].totalHours += r.totalHours || 0;
      }
    });

    setSummaries(Object.values(map));
    setFetching(false);
  };

  useEffect(() => {
    if (project) fetchSummary();
    // eslint-disable-next-line
  }, [project, viewMode, selectedDate, customStart, customEnd]);

  if (loading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }

  if (!project) {
    return (
      <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
        <h1 style={companyBannerStyle}>Airmech W.L.L</h1>
        <h1 style={projectTitleStyle}>Daily Attendance Summary</h1>
        <p style={{ color: '#dc2626' }}>
          No project is assigned to your account.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '40px',
        fontFamily: 'Arial, sans-serif',
        maxWidth: '900px',
      }}
    >
      <div style={{ paddingRight: '170px' }}>
        <h1 style={companyBannerStyle}>Airmech W.L.L</h1>
        <h1 style={projectTitleStyle}>{project.name}</h1>
        <p style={pageSubtitleStyle}>Daily Attendance Summary</p>
      </div>

      <h3 style={{ ...sectionTitleStyle, marginTop: '90px' }}>
        {viewMode.charAt(0).toUpperCase() + viewMode.slice(1)} View
      </h3>
      <div style={bluePanelStyle}>
        <div
          style={{
            display: 'flex',
            gap: '10px',
            marginBottom: '15px',
            flexWrap: 'wrap',
          }}
        >
          {(['daily', 'weekly', 'monthly', 'custom'] as ViewMode[]).map(
            (mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  ...tabButtonStyle,
                  background: viewMode === mode ? '#1e3a8a' : '#ffffff',
                  color: viewMode === mode ? '#fff' : '#1e3a8a',
                }}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            )
          )}
        </div>

        {viewMode === 'daily' && (
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={inputStyle}
          />
        )}

        {viewMode === 'custom' && (
          <div
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              marginBottom: '15px',
            }}
          >
            <label style={labelStyle}>From</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              style={inputStyle}
            />
            <label style={labelStyle}>To</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              style={inputStyle}
            />
          </div>
        )}

        {viewMode === 'weekly' && (
          <p style={rangeTextStyle}>
            Showing this week: {formatDate(getWeekRange().start)} →{' '}
            {formatDate(getWeekRange().end)}
          </p>
        )}
        {viewMode === 'monthly' && (
          <p style={rangeTextStyle}>
            Showing this month: {formatDate(getMonthRange().start)} →{' '}
            {formatDate(getMonthRange().end)}
          </p>
        )}

        {fetching ? (
          <p style={panelEmptyStyle}>Loading summary...</p>
        ) : summaries.length === 0 ? (
          <p style={panelEmptyStyle}>
            No attendance records found for this period.
          </p>
        ) : (
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
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Days Present</th>
                <th style={thStyle}>Basic Hrs</th>
                <th style={thStyle}>OT Hrs</th>
                <th style={thStyle}>Total Hrs</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.code} style={{ borderBottom: '1px solid #bfdbfe' }}>
                  <td style={tdStyle}>{s.code}</td>
                  <td style={tdStyle}>{s.name}</td>
                  <td style={tdStyle}>{s.daysPresent}</td>
                  <td style={tdStyle}>{s.totalBasic}</td>
                  <td style={tdStyle}>{s.totalOt}</td>
                  <td style={tdStyle}>{s.totalHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const companyBannerStyle: React.CSSProperties = {
  fontFamily: "'Poppins', 'Segoe UI', sans-serif",
  fontSize: '46px',
  fontWeight: 900,
  color: '#0d9488',
  textAlign: 'center',
  margin: '0 0 16px',
};
const projectTitleStyle: React.CSSProperties = {
  fontFamily: "'Poppins', 'Segoe UI', sans-serif",
  fontSize: '40px',
  fontWeight: 900,
  color: '#1e3a8a',
  letterSpacing: '0.4px',
  margin: '0 0 10px',
};
const pageSubtitleStyle: React.CSSProperties = {
  margin: '0 0 10px',
  padding: 0,
  background: 'none',
  color: '#d4af37',
  fontFamily: "'Inter', 'Segoe UI', sans-serif",
  fontSize: '40px',
  fontWeight: 600,
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
const tabButtonStyle: React.CSSProperties = {
  padding: '9px 18px',
  border: '1px solid #93c5fd',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '15px',
  fontWeight: 600,
};
const labelStyle: React.CSSProperties = { fontSize: '14px', color: '#1e40af' };
const inputStyle: React.CSSProperties = {
  padding: '9px',
  borderRadius: '6px',
  border: '1px solid #93c5fd',
  fontSize: '15px',
  background: '#fff',
  marginBottom: '15px',
};
const rangeTextStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#1e40af',
  marginTop: 0,
};
const panelEmptyStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#1e40af',
  marginTop: '15px',
};
const thStyle: React.CSSProperties = {
  padding: '10px 8px',
  fontSize: '15px',
  color: '#1e3a8a',
};
const tdStyle: React.CSSProperties = { padding: '10px 8px', fontSize: '15px' };
