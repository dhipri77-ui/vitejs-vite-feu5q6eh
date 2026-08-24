import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useAccessGuard } from '../lib/useAccessGuard';

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

export default function MasterAttendanceSummary() {
  const { loading: accessLoading, allowed } = useAccessGuard([
    'master',
    'accountant',
  ]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [customStart, setCustomStart] = useState(todayStr());
  const [customEnd, setCustomEnd] = useState(todayStr());
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(
    null
  );
  const [summariesByProject, setSummariesByProject] = useState<{
    [pid: string]: EmployeeSummary[];
  }>({});
  const [fetchingProjectId, setFetchingProjectId] = useState<string | null>(
    null
  );

  useEffect(() => {
    const loadProjects = async () => {
      const snap = await getDocs(collection(db, 'projects'));
      // Idle Pool has no real attendance concept (idle employees don't
      // check in/out - flat prorated pay), so it's excluded here, same
      // as the original single-project page never showed it either.
      const all = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Project))
        .filter((p) => p.name !== 'IDLE-AWAITING');
      all.sort((a, b) => a.name.localeCompare(b.name));
      setProjects(all);
      setLoading(false);
    };
    loadProjects();
  }, []);

  const getDateRange = (): { start: string; end: string } => {
    if (viewMode === 'daily') return { start: selectedDate, end: selectedDate };
    if (viewMode === 'weekly') return getWeekRange();
    if (viewMode === 'monthly') return getMonthRange();
    return { start: customStart, end: customEnd };
  };

  const fetchSummaryForProject = async (projectId: string) => {
    setFetchingProjectId(projectId);
    const { start, end } = getDateRange();

    const q = query(
      collection(db, 'attendance'),
      where('projectId', '==', projectId),
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

    setSummariesByProject((prev) => ({
      ...prev,
      [projectId]: Object.values(map),
    }));
    setFetchingProjectId(null);
  };

  const toggleProject = (projectId: string) => {
    if (expandedProjectId === projectId) {
      setExpandedProjectId(null);
      return;
    }
    setExpandedProjectId(projectId);
    if (!summariesByProject[projectId]) {
      fetchSummaryForProject(projectId);
    }
  };

  // Changing the period invalidates every already-fetched project block -
  // clear cached summaries so re-expanding fetches fresh for the new range.
  const clearAndSet = (fn: () => void) => {
    fn();
    setSummariesByProject({});
  };

  if (accessLoading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }
  if (!allowed) {
    return (
      <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
        <h1 style={{ color: '#dc2626' }}>Access Restricted</h1>
        <p style={{ color: '#666' }}>
          You don't have permission to view this page.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }

  const { start: rangeStart, end: rangeEnd } = getDateRange();

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
        <h1 style={pageTitleStyle}>Daily Attendance Summary</h1>
        <p style={pageSubtitleStyle}>All Projects</p>
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
                onClick={() => clearAndSet(() => setViewMode(mode))}
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
            onChange={(e) => clearAndSet(() => setSelectedDate(e.target.value))}
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
              onChange={(e) =>
                clearAndSet(() => setCustomStart(e.target.value))
              }
              style={inputStyle}
            />
            <label style={labelStyle}>To</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => clearAndSet(() => setCustomEnd(e.target.value))}
              style={inputStyle}
            />
          </div>
        )}

        {viewMode === 'weekly' && (
          <p style={rangeTextStyle}>
            Showing this week: {formatDate(rangeStart)} → {formatDate(rangeEnd)}
          </p>
        )}
        {viewMode === 'monthly' && (
          <p style={rangeTextStyle}>
            Showing this month: {formatDate(rangeStart)} →{' '}
            {formatDate(rangeEnd)}
          </p>
        )}
        <p style={{ ...rangeTextStyle, marginTop: '10px' }}>
          Changing the period clears already-generated blocks below - open a
          project again to refresh for the new period.
        </p>
      </div>

      {projects.length === 0 ? (
        <p style={{ ...panelEmptyStyle, marginTop: '20px' }}>
          No projects found.
        </p>
      ) : (
        projects.map((proj) => {
          const summaries = summariesByProject[proj.id];
          const isExpanded = expandedProjectId === proj.id;
          const isFetching = fetchingProjectId === proj.id;

          return (
            <div key={proj.id} style={{ marginTop: '20px' }}>
              <button
                onClick={() => toggleProject(proj.id)}
                style={projectHeaderButtonStyle}
              >
                <span>{proj.name}</span>
              </button>

              {isExpanded && (
                <div style={bluePanelStyle}>
                  {isFetching ? (
                    <p style={panelEmptyStyle}>Loading summary...</p>
                  ) : !summaries || summaries.length === 0 ? (
                    <p style={panelEmptyStyle}>
                      No attendance records found for this project/period.
                    </p>
                  ) : (
                    <table
                      style={{ width: '100%', borderCollapse: 'collapse' }}
                    >
                      <thead>
                        <tr
                          style={{
                            textAlign: 'left',
                            borderBottom: '2px solid #93c5fd',
                          }}
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
                          <tr
                            key={s.code}
                            style={{ borderBottom: '1px solid #bfdbfe' }}
                          >
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
              )}
            </div>
          );
        })
      )}
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
const pageTitleStyle: React.CSSProperties = {
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
  fontSize: '32px',
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
const projectHeaderButtonStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '14px 20px',
  background: '#1e3a8a',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '17px',
  fontWeight: 700,
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
