import { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  getDoc,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

interface Project {
  id: string;
  name: string;
  attendanceMode: string;
}

interface ProjectEmployee {
  id: string;
  employeeCode: string;
  name: string;
  position: string;
  payType: string;
}

interface AttendanceEntry {
  status: 'present' | 'absent';
  basicHours: string;
  otHours: string;
}

// Converts a stored 'YYYY-MM-DD' date string to 'DD/MM/YYYY' for display.
const formatDate = (isoDate?: string): string => {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

const today = () => new Date().toISOString().split('T')[0];

export default function AttendanceLog() {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<ProjectEmployee[]>([]);
  const [date, setDate] = useState(today());
  const [entries, setEntries] = useState<{ [code: string]: AttendanceEntry }>(
    {}
  );
  const [saveMsg, setSaveMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [holidayName, setHolidayName] = useState<string | null>(null);
  const [workedOnHoliday, setWorkedOnHoliday] = useState<{
    [code: string]: string;
  }>({});

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
          const proj = { id: docSnap.id, ...docSnap.data() } as Project;
          setProject(proj);
          fetchEmployees(proj.id);
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (project) checkHoliday(project.id, date);
  }, [date, project]);

  const fetchEmployees = async (projectId: string) => {
    const q = query(
      collection(db, 'projectEmployees'),
      where('projectId', '==', projectId)
    );
    const snapshot = await getDocs(q);
    const all = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as ProjectEmployee[];
    const active = all.filter((e: any) => e.status !== 'left');

    // payType on the projectEmployees record is just a copy taken at
    // Add-time - pull the live value from HR master so a later HR edit
    // (e.g. switching someone to Basic + OT) is reflected immediately,
    // not just for employees added after the edit.
    const codes = active.map((e) => e.employeeCode);
    if (codes.length > 0) {
      const hrPayTypeMap: { [code: string]: string } = {};
      for (let i = 0; i < codes.length; i += 30) {
        const batch = codes.slice(i, i + 30);
        const hrQ = query(
          collection(db, 'employees'),
          where('code', 'in', batch)
        );
        const hrSnap = await getDocs(hrQ);
        hrSnap.docs.forEach((d) => {
          const data: any = d.data();
          hrPayTypeMap[data.code] = data.payType;
        });
      }
      active.forEach((e: any) => {
        if (hrPayTypeMap[e.employeeCode]) {
          e.payType = hrPayTypeMap[e.employeeCode];
        }
      });
    }

    setEmployees(active);
  };

  const checkHoliday = async (projectId: string, selectedDate: string) => {
    const companyQ = query(
      collection(db, 'companyHolidays'),
      where('date', '==', selectedDate)
    );
    const companySnap = await getDocs(companyQ);
    if (!companySnap.empty) {
      setHolidayName(companySnap.docs[0].data().name);
      return;
    }
    const projQ = query(
      collection(db, 'projectHolidays'),
      where('projectId', '==', projectId),
      where('date', '==', selectedDate)
    );
    const projSnap = await getDocs(projQ);
    if (!projSnap.empty) {
      setHolidayName(projSnap.docs[0].data().name);
      return;
    }
    setHolidayName(null);
  };

  const loadAttendanceForDate = async (
    projectId: string,
    selectedDate: string
  ) => {
    const newEntries: { [code: string]: AttendanceEntry } = {};
    const newWorked: { [code: string]: string } = {};
    for (const emp of employees) {
      const docId = `${projectId}_${emp.employeeCode}_${selectedDate}`;
      const snap = await getDoc(doc(db, 'attendance', docId));
      if (snap.exists()) {
        const data = snap.data();
        newEntries[emp.employeeCode] = {
          status: data.status,
          basicHours: String(data.basicHours ?? ''),
          otHours: String(data.otHours ?? ''),
        };
        if (data.workedOnHoliday) {
          newWorked[emp.employeeCode] = String(data.holidayWorkedHours ?? '');
        }
      } else {
        newEntries[emp.employeeCode] = {
          status: 'present',
          basicHours: '8',
          otHours: '0',
        };
      }
    }
    setEntries(newEntries);
    setWorkedOnHoliday(newWorked);
  };

  useEffect(() => {
    if (project && employees.length > 0)
      loadAttendanceForDate(project.id, date);
    // eslint-disable-next-line
  }, [employees, date]);

  const updateEntry = (
    code: string,
    field: keyof AttendanceEntry,
    value: string
  ) => {
    setEntries((prev) => ({
      ...prev,
      [code]: { ...prev[code], [field]: value },
    }));
  };

  const updateWorkedOnHoliday = (code: string, value: string) => {
    setWorkedOnHoliday((prev) => ({ ...prev, [code]: value }));
  };

  const handleSaveAll = async () => {
    if (!project) return;
    setSaving(true);
    setSaveMsg('');
    try {
      for (const emp of employees) {
        const entry = entries[emp.employeeCode];
        if (!entry) continue;
        const docId = `${project.id}_${emp.employeeCode}_${date}`;

        let basicHours = 0;
        let otHours = 0;
        let holidayWorkedHours = 0;
        let workedFlag = false;

        if (holidayName) {
          basicHours = 8;
          const workedInput = Number(workedOnHoliday[emp.employeeCode] || 0);
          if (workedInput > 0) {
            otHours = workedInput;
            holidayWorkedHours = workedInput;
            workedFlag = true;
          }
        } else if (entry.status === 'present') {
          basicHours = Number(entry.basicHours || 0);
          otHours = Number(entry.otHours || 0);
        }

        await setDoc(doc(db, 'attendance', docId), {
          projectId: project.id,
          employeeCode: emp.employeeCode,
          employeeName: emp.name,
          date,
          status: holidayName ? 'present' : entry.status,
          basicHours,
          otHours,
          totalHours: basicHours + otHours,
          markedBy: 'manual',
          isHoliday: !!holidayName,
          holidayName: holidayName || '',
          workedOnHoliday: workedFlag,
          holidayWorkedHours,
        });
      }
      setSaveMsg('Attendance saved successfully for ' + formatDate(date));
    } catch (err: any) {
      setSaveMsg('Error saving attendance: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }

  if (!project) {
    return (
      <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
        <h1 style={companyBannerStyle}>Airmech W.L.L</h1>
        <h1 style={projectTitleStyle}>Daily Attendance Log</h1>
        <p style={{ color: '#dc2626' }}>
          No project is assigned to your account.
        </p>
      </div>
    );
  }

  if (project.attendanceMode === 'geofence') {
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
          <p style={pageSubtitleStyle}>Daily Attendance Log</p>
        </div>
        <p style={{ color: '#666', marginTop: '90px' }}>
          This project is set to <strong>Geofence Only</strong> attendance mode.
          Manual entry is not available. Geofence-based attendance marking will
          be available in a future update.
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
        <p style={pageSubtitleStyle}>Daily Attendance Log</p>
      </div>

      <h3 style={{ ...sectionTitleStyle, marginTop: '90px' }}>
        {formatDate(date)}
      </h3>
      <div style={bluePanelStyle}>
        <label style={labelStyle}>Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ ...inputStyle, display: 'block', marginTop: '6px' }}
        />

        {holidayName && (
          <div style={holidayBannerStyle}>
            <strong>Holiday: {holidayName}</strong> — all employees are
            auto-credited with Basic Hours. If someone worked this day, enter
            their worked hours below (counted entirely as OT, in addition to
            Basic Hours).
          </div>
        )}

        {employees.length === 0 ? (
          <p style={panelEmptyStyle}>No employees added to this project yet.</p>
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
                {!holidayName && <th style={thStyle}>Status</th>}
                {!holidayName && <th style={thStyle}>Basic Hrs</th>}
                {!holidayName && <th style={thStyle}>OT Hrs</th>}
                {holidayName && <th style={thStyle}>Basic Hrs (auto)</th>}
                {holidayName && <th style={thStyle}>Worked Hours (if any)</th>}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => {
                const entry = entries[emp.employeeCode] || {
                  status: 'present',
                  basicHours: '8',
                  otHours: '0',
                };
                return (
                  <tr
                    key={emp.id}
                    style={{ borderBottom: '1px solid #bfdbfe' }}
                  >
                    <td style={tdStyle}>{emp.employeeCode}</td>
                    <td style={tdStyle}>{emp.name}</td>

                    {!holidayName && (
                      <>
                        <td style={tdStyle}>
                          <select
                            value={entry.status}
                            onChange={(e) =>
                              updateEntry(
                                emp.employeeCode,
                                'status',
                                e.target.value
                              )
                            }
                            style={inputStyle}
                          >
                            <option value="present">Present</option>
                            <option value="absent">Absent</option>
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <input
                            type="number"
                            disabled={entry.status === 'absent'}
                            value={entry.basicHours}
                            onChange={(e) =>
                              updateEntry(
                                emp.employeeCode,
                                'basicHours',
                                e.target.value
                              )
                            }
                            style={{ ...inputStyle, width: '60px' }}
                          />
                        </td>
                        <td style={tdStyle}>
                          <input
                            type="number"
                            disabled={
                              entry.status === 'absent' ||
                              emp.payType !== 'basicOt'
                            }
                            value={entry.otHours}
                            onChange={(e) =>
                              updateEntry(
                                emp.employeeCode,
                                'otHours',
                                e.target.value
                              )
                            }
                            style={{ ...inputStyle, width: '60px' }}
                          />
                        </td>
                      </>
                    )}

                    {holidayName && (
                      <>
                        <td style={tdStyle}>8 (auto)</td>
                        <td style={tdStyle}>
                          <input
                            type="number"
                            placeholder="0"
                            value={workedOnHoliday[emp.employeeCode] || ''}
                            onChange={(e) =>
                              updateWorkedOnHoliday(
                                emp.employeeCode,
                                e.target.value
                              )
                            }
                            style={{ ...inputStyle, width: '80px' }}
                          />
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {employees.length > 0 && (
          <button
            onClick={handleSaveAll}
            style={{ ...sectionButtonStyle, maxWidth: '260px' }}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Attendance'}
          </button>
        )}

        {saveMsg && (
          <p
            style={{
              fontSize: '14px',
              color: saveMsg.startsWith('Error') ? '#dc2626' : '#16a34a',
              marginTop: '10px',
            }}
          >
            {saveMsg}
          </p>
        )}
      </div>
    </div>
  );
}

const companyBannerStyle: React.CSSProperties = {
  textAlign: 'center',
  fontFamily: "'Poppins', 'Segoe UI', sans-serif",
  fontSize: '46px',
  fontWeight: 900,
  color: '#0d9488',
  letterSpacing: '0.5px',
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
const labelStyle: React.CSSProperties = { fontSize: '14px', color: '#1e40af' };
const inputStyle: React.CSSProperties = {
  padding: '7px',
  borderRadius: '6px',
  border: '1px solid #93c5fd',
  fontSize: '15px',
  background: '#fff',
};
const sectionButtonStyle: React.CSSProperties = {
  marginTop: '20px',
  width: '100%',
  padding: '12px 18px',
  background: '#bfdbfe',
  color: '#1e3a8a',
  border: '1px solid #93c5fd',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '15px',
};
const thStyle: React.CSSProperties = {
  padding: '10px 8px',
  fontSize: '15px',
  color: '#1e3a8a',
};
const tdStyle: React.CSSProperties = { padding: '10px 8px', fontSize: '15px' };
const panelEmptyStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#1e40af',
  margin: 0,
};
const holidayBannerStyle: React.CSSProperties = {
  background: '#fef3c7',
  color: '#92400e',
  padding: '12px',
  borderRadius: '8px',
  marginTop: '15px',
  fontSize: '14px',
};
