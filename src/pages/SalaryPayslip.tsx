import { useState, useEffect, useMemo } from 'react';
import { db, auth } from '../firebase';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import emailjs from '@emailjs/browser';
import {
  EMAILJS_SERVICE_ID,
  EMAILJS_TEMPLATE_ID,
  EMAILJS_PUBLIC_KEY,
} from '../emailConfig';
import { Link } from 'react-router-dom';
import { useAccessGuard } from '../lib/useAccessGuard';

interface Project {
  id: string;
  name: string;
}

interface ProjectEmployee {
  employeeCode: string;
  name: string;
  salary: number;
  payType: string;
  otMultiplier: number;
  departmentName?: string;
  status?: string;
}

interface PayslipRow {
  code: string;
  name: string;
  email: string;
  department: string;
  position: string;
  daysPresent: number;
  basicHours: number;
  otHours: number;
  hourlyRate: number;
  basicPay: number;
  otPay: number;
  totalPay: number;
}

// Converts a stored 'YYYY-MM-DD' date string to 'DD/MM/YYYY' for display.
const formatDate = (isoDate?: string): string => {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

// Converts a decimal hours value (e.g. 2.82) to a "Xh Ym" display string
// (e.g. "2h 49m"). Rounds to the nearest minute. Shows just "Ym" for
// anything under an hour, and "0m" for exactly zero.
const formatHoursMinutes = (hours: number): string => {
  const totalMinutes = Math.round((hours || 0) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
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

const FONT_STACK = "'Poppins', 'Segoe UI', Arial, sans-serif";

export default function SalaryPayslip() {
  const { loading: accessLoading, allowed } = useAccessGuard([
    'master',
    'accountant',
  ]);

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<ProjectEmployee[]>([]);
  const [companyName] = useState('Airmech');
  const [rangeStart, setRangeStart] = useState(getMonthRange().start);
  const [rangeEnd, setRangeEnd] = useState(getMonthRange().end);
  const [rows, setRows] = useState<PayslipRow[]>([]);
  const [fetching, setFetching] = useState(false);
  const [sendingCode, setSendingCode] = useState<string | null>(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [positionFilter, setPositionFilter] = useState('All');

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
          const empQ = query(
            collection(db, 'projectEmployees'),
            where('projectId', '==', proj.id)
          );
          const empSnap = await getDocs(empQ);
          const allEmp = empSnap.docs.map((d) => d.data()) as ProjectEmployee[];
          const dedupMap: { [code: string]: ProjectEmployee } = {};
          allEmp.forEach((e: any) => {
            if (e.status === 'left') return;
            dedupMap[e.employeeCode] = e;
          });
          setEmployees(Object.values(dedupMap));
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Combined payslip generation: for every currently active employee on
  // this project, reconstruct their FULL assignment timeline across ALL
  // projects (using assignedDate/leavingDate on projectEmployees) and
  // split the selected period into segments by which project they were
  // on each day. Real-project segments use actual attendance-based pay
  // (with holiday-fill); Idle segments use flat prorated basic salary.
  // This means a payslip is always complete, even if the employee moved
  // between a real project and the Idle pool mid-period.
  const generatePayslips = async () => {
    if (!project) return;
    setFetching(true);

    const codes = employees.map((e) => e.employeeCode);
    if (codes.length === 0) {
      setRows([]);
      setFetching(false);
      return;
    }

    // 1. Every projectEmployees record (any project, any status) for
    //    these employees - reconstructs each person's full timeline.
    const allRecords: any[] = [];
    for (let i = 0; i < codes.length; i += 30) {
      const batch = codes.slice(i, i + 30);
      const histQ = query(
        collection(db, 'projectEmployees'),
        where('employeeCode', 'in', batch)
      );
      const histSnap = await getDocs(histQ);
      histSnap.docs.forEach((d) => allRecords.push(d.data()));
    }

    // 2. All projects, to map projectId -> name (identifies IDLE-AWAITING)
    const allProjSnap = await getDocs(collection(db, 'projects'));
    const projectNameById: { [id: string]: string } = {};
    allProjSnap.docs.forEach((d) => {
      projectNameById[d.id] = (d.data() as any).name;
    });

    // 3. Build each employee's sorted timeline of assignments
    const timelines: {
      [code: string]: { projectId: string; start: string; end: string }[];
    } = {};
    codes.forEach((code) => {
      const recs = allRecords
        .filter((r) => r.employeeCode === code)
        .map((r) => ({ ...r, assignedDate: r.assignedDate || '2000-01-01' }))
        .sort((a, b) => a.assignedDate.localeCompare(b.assignedDate));
      timelines[code] = recs.map((r) => ({
        projectId: r.projectId,
        start: r.assignedDate,
        end: r.leavingDate || rangeEnd,
      }));
    });

    // 4. Clip each timeline entry to the selected period -> segments
    const employeeSegments: {
      [code: string]: { projectId: string; segStart: string; segEnd: string }[];
    } = {};
    codes.forEach((code) => {
      const segs: { projectId: string; segStart: string; segEnd: string }[] =
        [];
      timelines[code].forEach((entry) => {
        const segStart = entry.start > rangeStart ? entry.start : rangeStart;
        const segEnd = entry.end < rangeEnd ? entry.end : rangeEnd;
        if (segStart <= segEnd) {
          segs.push({ projectId: entry.projectId, segStart, segEnd });
        }
      });
      employeeSegments[code] = segs;
    });

    // 5. Fetch attendance + holidays once per distinct REAL project touched
    const realProjectIds = Array.from(
      new Set(
        Object.values(employeeSegments)
          .flat()
          .map((s) => s.projectId)
          .filter((pid) => projectNameById[pid] !== 'IDLE-AWAITING')
      )
    );

    const attendanceByProject: { [pid: string]: any[] } = {};
    const holidayDatesByProject: { [pid: string]: Set<string> } = {};

    for (const pid of realProjectIds) {
      const attQ = query(
        collection(db, 'attendance'),
        where('projectId', '==', pid),
        where('date', '>=', rangeStart),
        where('date', '<=', rangeEnd)
      );
      const attSnap = await getDocs(attQ);
      attendanceByProject[pid] = attSnap.docs.map((d) => d.data());

      const holSet = new Set<string>();
      const companyHolQ = query(
        collection(db, 'companyHolidays'),
        where('date', '>=', rangeStart),
        where('date', '<=', rangeEnd)
      );
      const companyHolSnap = await getDocs(companyHolQ);
      companyHolSnap.docs.forEach((d) => holSet.add((d.data() as any).date));

      const projHolQ = query(
        collection(db, 'projectHolidays'),
        where('projectId', '==', pid),
        where('date', '>=', rangeStart),
        where('date', '<=', rangeEnd)
      );
      const projHolSnap = await getDocs(projHolQ);
      projHolSnap.docs.forEach((d) => holSet.add((d.data() as any).date));

      holidayDatesByProject[pid] = holSet;
    }

    // 6. HR lookup (email/position)
    const hrMap: { [code: string]: { email: string; position: string } } = {};
    await Promise.all(
      employees.map(async (emp) => {
        const hrQ = query(
          collection(db, 'employees'),
          where('code', '==', emp.employeeCode)
        );
        const hrSnap = await getDocs(hrQ);
        if (!hrSnap.empty) {
          const hrData = hrSnap.docs[0].data();
          hrMap[emp.employeeCode] = {
            email: hrData.email || '',
            position: hrData.position || 'Unspecified',
          };
        }
      })
    );

    // 7. Combine every segment into one row per employee
    const result: PayslipRow[] = employees.map((emp) => {
      const code = emp.employeeCode;
      const hourlyRate = emp.salary / 30 / 8;
      const otMultiplier =
        emp.payType === 'basicOt' ? emp.otMultiplier || 1 : 1;

      let daysPresent = 0;
      let basicHours = 0;
      let otHours = 0;
      let basicPay = 0;
      let otPay = 0;

      const segs = employeeSegments[code] || [];
      segs.forEach((seg) => {
        const isIdle = projectNameById[seg.projectId] === 'IDLE-AWAITING';
        if (isIdle) {
          const days =
            Math.round(
              (new Date(seg.segEnd).getTime() -
                new Date(seg.segStart).getTime()) /
                (1000 * 60 * 60 * 24)
            ) + 1;
          daysPresent += days;
          basicHours += days * 8;
          basicPay += (emp.salary / 30) * days;
        } else {
          const dayRecords = (attendanceByProject[seg.projectId] || []).filter(
            (r) =>
              r.employeeCode === code &&
              r.date >= seg.segStart &&
              r.date <= seg.segEnd
          );
          const recordedDates = new Set(dayRecords.map((r) => r.date));
          dayRecords.forEach((r) => {
            if (r.status !== 'present') return;
            daysPresent += 1;
            basicHours += r.basicHours || 0;
            otHours += r.otHours || 0;
            basicPay += (r.basicHours || 0) * hourlyRate;
            otPay += (r.otHours || 0) * hourlyRate * otMultiplier;
          });
          const holSet =
            holidayDatesByProject[seg.projectId] || new Set<string>();
          holSet.forEach((hDate) => {
            if (
              hDate >= seg.segStart &&
              hDate <= seg.segEnd &&
              !recordedDates.has(hDate)
            ) {
              daysPresent += 1;
              basicHours += 8;
              basicPay += 8 * hourlyRate;
            }
          });
        }
      });

      const hr = hrMap[code] || { email: '', position: 'Unspecified' };
      return {
        code,
        name: emp.name,
        email: hr.email,
        department:
          emp.departmentName ||
          (projectNameById[project.id] === 'IDLE-AWAITING'
            ? 'Idle'
            : 'Unassigned'),
        position: hr.position,
        daysPresent,
        basicHours,
        otHours,
        hourlyRate,
        basicPay,
        otPay,
        totalPay: basicPay + otPay,
      };
    });

    setRows(result);
    await Promise.all(result.map((row) => savePayslipSnapshot(row)));
    setFetching(false);
  };

  useEffect(() => {
    if (project) generatePayslips();
    // eslint-disable-next-line
  }, [project]);

  const departments = useMemo(
    () => ['All', ...Array.from(new Set(rows.map((r) => r.department)))],
    [rows]
  );
  const positions = useMemo(
    () => ['All', ...Array.from(new Set(rows.map((r) => r.position)))],
    [rows]
  );

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const deptOk =
        departmentFilter === 'All' || r.department === departmentFilter;
      const posOk = positionFilter === 'All' || r.position === positionFilter;
      return deptOk && posOk;
    });
  }, [rows, departmentFilter, positionFilter]);

  const sendOnePayslip = async (row: PayslipRow) => {
    await emailjs.send(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      {
        to_email: row.email,
        employee_name: row.name,
        employee_code: row.code,
        month: `${rangeStart} to ${rangeEnd}`,
        days_present: row.daysPresent,
        basic_hours: row.basicHours,
        ot_hours: row.otHours,
        basic_pay: row.basicPay.toFixed(2),
        ot_pay: row.otPay.toFixed(2),
        total_pay: row.totalPay.toFixed(2),
        company_name: companyName,
      },
      EMAILJS_PUBLIC_KEY
    );
  };

  const savePayslipSnapshot = async (row: PayslipRow) => {
    const payslipId = `${project!.id}_${row.code}_${rangeStart}_${rangeEnd}`;
    const existingSnap = await getDoc(doc(db, 'payslips', payslipId));
    const existingApproved = existingSnap.exists()
      ? (existingSnap.data() as any).approved || false
      : false;
    const existingApprovedAt = existingSnap.exists()
      ? (existingSnap.data() as any).approvedAt || null
      : null;
    await setDoc(doc(db, 'payslips', payslipId), {
      projectId: project!.id,
      projectName: project!.name,
      employeeCode: row.code,
      employeeName: row.name,
      employeeEmail: row.email,
      department: row.department,
      position: row.position,
      periodStart: rangeStart,
      periodEnd: rangeEnd,
      daysPresent: row.daysPresent,
      basicHours: row.basicHours,
      otHours: row.otHours,
      hourlyRate: row.hourlyRate,
      basicPay: row.basicPay,
      otPay: row.otPay,
      totalPay: row.totalPay,
      companyName: companyName,
      generatedAt: new Date().toISOString(),
      approved: existingApproved,
      approvedAt: existingApprovedAt,
    });
  };

  const handleSendPayslip = async (row: PayslipRow) => {
    if (!row.email) {
      alert(
        `No email on file for ${row.name} (${row.code}). Please add one in HR.`
      );
      return;
    }
    setSendingCode(row.code);
    try {
      await sendOnePayslip(row);
      alert(`Payslip sent to ${row.email}`);
    } catch (error) {
      console.error('Failed to send payslip:', error);
      alert('Failed to send payslip. Please try again.');
    } finally {
      setSendingCode(null);
    }
  };

  const handleSendAllPayslips = async () => {
    const eligible = filteredRows.filter((r) => r.email);
    const skipped = filteredRows.filter((r) => !r.email);

    if (eligible.length === 0) {
      alert('No employees with an email on file for this filter/period.');
      return;
    }

    setSendingAll(true);
    let successCount = 0;
    let failCount = 0;

    for (const row of eligible) {
      try {
        await sendOnePayslip(row);
        successCount++;
      } catch (error) {
        console.error(`Failed to send payslip to ${row.name}:`, error);
        failCount++;
      }
    }

    setSendingAll(false);

    let summary = `Sent ${successCount} of ${eligible.length} payslips successfully.`;
    if (failCount > 0) summary += ` ${failCount} failed.`;
    if (skipped.length > 0)
      summary += ` ${skipped.length} skipped (no email on file).`;
    alert(summary);
  };

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

  if (loading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }

  if (!project) {
    return (
      <div style={{ padding: '40px', fontFamily: FONT_STACK }}>
        <h1 style={companyBannerStyle}>Airmech W.L.L</h1>
        <h1 style={projectTitleStyle}>Salary & Pay Slip</h1>
        <p style={{ color: '#dc2626' }}>
          No project is assigned to your account.
        </p>
      </div>
    );
  }

  const grandTotal = filteredRows.reduce((sum, r) => sum + r.totalPay, 0);

  return (
    <div
      style={{
        padding: '40px',
        fontFamily: FONT_STACK,
        maxWidth: '1100px',
      }}
    >
      <div style={{ paddingRight: '170px' }}>
        <h1 style={companyBannerStyle}>Airmech W.L.L</h1>
        <h1 style={projectTitleStyle}>{project.name}</h1>
        <p style={pageSubtitleStyle}>Salary & Pay Slip</p>
      </div>

      <h3 style={{ ...sectionTitleStyle, marginTop: '90px' }}>
        {formatDate(rangeStart)} → {formatDate(rangeEnd)}
      </h3>
      <div style={bluePanelStyle}>
        <div
          style={{
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
            marginBottom: '15px',
            flexWrap: 'wrap',
          }}
        >
          <label style={labelStyle}>From</label>
          <input
            type="date"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
            style={inputStyle}
          />
          <label style={labelStyle}>To</label>
          <input
            type="date"
            value={rangeEnd}
            onChange={(e) => setRangeEnd(e.target.value)}
            style={inputStyle}
          />
          <button onClick={generatePayslips} style={sectionButtonStyle}>
            Generate
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
            marginBottom: '20px',
            flexWrap: 'wrap',
          }}
        >
          <label style={labelStyle}>Department</label>
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            style={inputStyle}
          >
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <label style={labelStyle}>Position</label>
          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            style={inputStyle}
          >
            {positions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <button
            onClick={handleSendAllPayslips}
            disabled={sendingAll || filteredRows.length === 0}
            style={sendAllButtonStyle}
          >
            {sendingAll
              ? 'Sending All...'
              : `Send All Payslips (${filteredRows.length})`}
          </button>
        </div>

        {fetching ? (
          <p style={panelEmptyStyle}>Calculating...</p>
        ) : filteredRows.length === 0 ? (
          <p style={panelEmptyStyle}>
            No employees match this filter for the selected period.
          </p>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    textAlign: 'left',
                    borderBottom: '2px solid #93c5fd',
                  }}
                >
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Dept</th>
                  <th style={thStyle}>Position</th>
                  <th style={thStyle}>Days</th>
                  <th style={thStyle}>Basic Hrs</th>
                  <th style={thStyle}>OT Hrs</th>
                  <th style={thStyle}>Basic Pay</th>
                  <th style={thStyle}>OT Pay</th>
                  <th style={thStyle}>Total Pay</th>
                  <th style={thStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr
                    key={r.code}
                    style={{ borderBottom: '1px solid #bfdbfe' }}
                  >
                    <td style={tdStyle}>{r.code}</td>
                    <td style={tdStyle}>{r.name}</td>
                    <td style={tdStyle}>{r.department}</td>
                    <td style={tdStyle}>{r.position}</td>
                    <td style={tdStyle}>{r.daysPresent}</td>
                    <td style={tdStyle}>{formatHoursMinutes(r.basicHours)}</td>
                    <td style={tdStyle}>{formatHoursMinutes(r.otHours)}</td>
                    <td style={tdStyle}>{r.basicPay.toFixed(2)}</td>
                    <td style={tdStyle}>{r.otPay.toFixed(2)}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>
                      {r.totalPay.toFixed(2)}
                    </td>
                    <td style={{ ...tdStyle, display: 'flex', gap: '6px' }}>
                      <Link
                        to={`/payslip/${project.id}/${r.code}/${rangeStart}/${rangeEnd}`}
                        style={viewLinkStyle}
                      >
                        View
                      </Link>
                      <Link
                        to={`/payslip-history/${project.id}/${r.code}`}
                        style={historyLinkStyle}
                      >
                        History
                      </Link>
                      <button
                        onClick={() => handleSendPayslip(r)}
                        disabled={sendingCode === r.code || sendingAll}
                        style={sendButtonStyle}
                      >
                        {sendingCode === r.code ? 'Sending...' : 'Send Payslip'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={totalLineStyle}>
              <span>
                Grand Total for Period ({filteredRows.length} employees)
              </span>
              <strong style={{ fontSize: '18px' }}>
                {grandTotal.toFixed(2)}
              </strong>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const companyBannerStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '46px',
  fontWeight: 900,
  color: '#0d9488',
  textAlign: 'center',
  margin: '0 0 16px',
};
const projectTitleStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
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
  fontFamily: FONT_STACK,
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
  padding: '8px',
  borderRadius: '6px',
  border: '1px solid #93c5fd',
  fontSize: '15px',
  background: '#fff',
};
const sectionButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  background: '#1e3a8a',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '15px',
};
const sendButtonStyle: React.CSSProperties = {
  padding: '7px 12px',
  background: '#16a34a',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
};
const sendAllButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  background: '#7c3aed',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '15px',
};
const viewLinkStyle: React.CSSProperties = {
  padding: '7px 12px',
  background: '#1e3a8a',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};
const historyLinkStyle: React.CSSProperties = {
  padding: '7px 12px',
  background: '#d97706',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};
const totalLineStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: '20px',
  paddingTop: '15px',
  borderTop: '1px solid #93c5fd',
  fontSize: '15px',
  color: '#1e40af',
};
const thStyle: React.CSSProperties = {
  padding: '10px 8px',
  fontSize: '14px',
  color: '#1e3a8a',
};
const tdStyle: React.CSSProperties = { padding: '10px 8px', fontSize: '14px' };
const panelEmptyStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#1e40af',
};
