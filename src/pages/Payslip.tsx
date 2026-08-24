import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../firebase';

import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';

interface PayslipData {
  projectName: string;
  employeeCode: string;
  employeeName: string;
  employeeEmail: string;
  department: string;
  position: string;
  periodStart: string;
  periodEnd: string;
  daysPresent: number;
  basicHours: number;
  otHours: number;
  hourlyRate: number;
  basicPay: number;
  otPay: number;
  totalPay: number;
  companyName: string;
  generatedAt: string;
}

// Formats a Date using its LOCAL calendar date, not UTC - avoids the
// off-by-one-day bug .toISOString() causes in timezones ahead of UTC
// (e.g. local midnight 15/09 becomes 14/09 in UTC).
const toLocalDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

interface DailyEntry {
  date: string;
  basicHours: number;
  otHours: number;
  status: string; // 'present' | 'absent' | 'off'
  isHoliday: boolean;
  holidayName?: string;
  source: 'record' | 'holidayFill' | 'idle' | 'off';
  projectLabel: string; // project name, 'Idle', or '—' for unassigned days
}

interface ProjectSummaryRow {
  projectLabel: string;
  days: number;
  basicHours: number;
  otHours: number;
}

const FONT_STACK = "'Poppins', 'Segoe UI', Arial, sans-serif";

export default function Payslip() {
  const { projectId, code, periodStart, periodEnd } = useParams();
  const [data, setData] = useState<PayslipData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);

  useEffect(() => {
    const fetchPayslip = async () => {
      if (!projectId || !code || !periodStart || !periodEnd) {
        setLoading(false);
        return;
      }
      const payslipId = `${projectId}_${code}_${periodStart}_${periodEnd}`;
      const snap = await getDoc(doc(db, 'payslips', payslipId));
      if (!snap.exists()) {
        setLoading(false);
        return;
      }
      setData(snap.data() as PayslipData);

      // ---- Cross-project timeline reconstruction ----
      // This employee may have moved between projects (or Idle Pool)
      // during the period, so the daily breakdown can't just look at
      // THIS project's attendance - it has to reconstruct the same
      // combined timeline that SalaryPayslip.tsx/MasterSalaryPayslip.tsx
      // use for the header totals, then walk it day-by-day.

      // 1. Every projectEmployees record (any project) for this employee.
      const histQ = query(
        collection(db, 'projectEmployees'),
        where('employeeCode', '==', code)
      );
      const histSnap = await getDocs(histQ);
      const records = histSnap.docs
        .map((d) => d.data() as any)
        .map((r) => ({ ...r, assignedDate: r.assignedDate || '2000-01-01' }))
        .sort((a, b) => a.assignedDate.localeCompare(b.assignedDate));

      // 2. All projects, to map projectId -> name (identifies Idle Pool).
      const allProjSnap = await getDocs(collection(db, 'projects'));
      const projectNameById: { [id: string]: string } = {};
      allProjSnap.docs.forEach((d) => {
        projectNameById[d.id] = (d.data() as any).name;
      });

      // 3. Clip each assignment to the selected period -> segments.
      const segments = records
        .map((r) => {
          const segStart =
            r.assignedDate > periodStart ? r.assignedDate : periodStart;
          const segEnd =
            (r.leavingDate || periodEnd) < periodEnd
              ? r.leavingDate || periodEnd
              : periodEnd;
          return { projectId: r.projectId, segStart, segEnd };
        })
        .filter((s) => s.segStart <= s.segEnd);

      // 4. Fetch attendance + holidays once per distinct REAL project
      //    segment touched during this period.
      const realProjectIds = Array.from(
        new Set(
          segments
            .map((s) => s.projectId)
            .filter((pid) => projectNameById[pid] !== 'IDLE-AWAITING')
        )
      );

      const attendanceByProject: { [pid: string]: any[] } = {};
      const holidayDatesByProject: {
        [pid: string]: { [date: string]: string };
      } = {};

      for (const pid of realProjectIds) {
        const attQ = query(
          collection(db, 'attendance'),
          where('projectId', '==', pid),
          where('employeeCode', '==', code),
          where('date', '>=', periodStart),
          where('date', '<=', periodEnd)
        );
        const attSnap = await getDocs(attQ);
        attendanceByProject[pid] = attSnap.docs.map((d) => d.data());

        const holMap: { [date: string]: string } = {};
        const companyHolQ = query(
          collection(db, 'companyHolidays'),
          where('date', '>=', periodStart),
          where('date', '<=', periodEnd)
        );
        const companyHolSnap = await getDocs(companyHolQ);
        companyHolSnap.docs.forEach((d) => {
          const h = d.data() as any;
          holMap[h.date] = h.name;
        });

        const projHolQ = query(
          collection(db, 'projectHolidays'),
          where('projectId', '==', pid),
          where('date', '>=', periodStart),
          where('date', '<=', periodEnd)
        );
        const projHolSnap = await getDocs(projHolQ);
        projHolSnap.docs.forEach((d) => {
          const h = d.data() as any;
          holMap[h.date] = h.name;
        });

        holidayDatesByProject[pid] = holMap;
      }

      // 5. Walk every date in the period, attributing each day to
      //    whichever segment (project or Idle) actually covers it.
      const entries: DailyEntry[] = [];
      let cursor = new Date(periodStart + 'T00:00:00');
      const end = new Date(periodEnd + 'T00:00:00');

      while (cursor <= end) {
        const dateStr = toLocalDateStr(cursor);
        const seg = segments.find(
          (s) => dateStr >= s.segStart && dateStr <= s.segEnd
        );

        if (!seg) {
          entries.push({
            date: dateStr,
            basicHours: 0,
            otHours: 0,
            status: 'off',
            isHoliday: false,
            source: 'off',
            projectLabel: '—',
          });
        } else if (projectNameById[seg.projectId] === 'IDLE-AWAITING') {
          entries.push({
            date: dateStr,
            basicHours: 8,
            otHours: 0,
            status: 'present',
            isHoliday: false,
            source: 'idle',
            projectLabel: 'Idle',
          });
        } else {
          const rec = (attendanceByProject[seg.projectId] || []).find(
            (r: any) => r.date === dateStr
          );
          const holName = holidayDatesByProject[seg.projectId]?.[dateStr];
          const projLabel = projectNameById[seg.projectId] || 'Unknown';

          if (rec) {
            entries.push({
              date: dateStr,
              basicHours: rec.basicHours || 0,
              otHours: rec.otHours || 0,
              status: rec.status,
              isHoliday: rec.isHoliday || false,
              holidayName: rec.holidayName || '',
              source: 'record',
              projectLabel: projLabel,
            });
          } else if (holName) {
            entries.push({
              date: dateStr,
              basicHours: 8,
              otHours: 0,
              status: 'present',
              isHoliday: true,
              holidayName: holName,
              source: 'holidayFill',
              projectLabel: projLabel,
            });
          } else {
            entries.push({
              date: dateStr,
              basicHours: 0,
              otHours: 0,
              status: 'off',
              isHoliday: false,
              source: 'off',
              projectLabel: projLabel,
            });
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }

      setDailyEntries(entries);
      setLoading(false);
    };
    fetchPayslip();
  }, [projectId, code, periodStart, periodEnd]);

  if (loading) return <div style={{ padding: 40 }}>Loading...</div>;
  if (!data) return <div style={{ padding: 40 }}>Payslip not found.</div>;

  // Per-project day-count summary (header) and hour totals (footer) -
  // only counts days that actually count as present (record-present,
  // holiday-fill, or idle), matching the same "days present" definition
  // used everywhere else in the app.
  const projectSummary: { [label: string]: ProjectSummaryRow } = {};
  dailyEntries.forEach((e) => {
    if (e.status !== 'present') return;
    if (!projectSummary[e.projectLabel]) {
      projectSummary[e.projectLabel] = {
        projectLabel: e.projectLabel,
        days: 0,
        basicHours: 0,
        otHours: 0,
      };
    }
    projectSummary[e.projectLabel].days += 1;
    projectSummary[e.projectLabel].basicHours += e.basicHours;
    projectSummary[e.projectLabel].otHours += e.otHours;
  });
  const summaryRows = Object.values(projectSummary).sort((a, b) =>
    a.projectLabel.localeCompare(b.projectLabel)
  );

  return (
    <div>
      <div className="no-print" style={{ padding: '20px 40px 0' }}>
        <button onClick={() => window.print()} style={printButtonStyle}>
          Print / Save as PDF
        </button>
      </div>

      <div style={sheetStyle}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <h1 style={companyNameHeaderStyle}>{data.companyName}</h1>
          <p style={projectNameHeaderStyle}>{data.projectName}</p>
          <h2 style={payslipLabelStyle}>Payslip</h2>
          <p style={{ margin: '4px 0', color: '#666', fontSize: 13 }}>
            Period: {data.periodStart} to {data.periodEnd}
          </p>
        </div>

        <table style={{ width: '100%', marginBottom: 20 }}>
          <tbody>
            <tr>
              <td style={labelCell}>Employee Name</td>
              <td style={valueCell}>{data.employeeName}</td>
              <td style={labelCell}>Employee Code</td>
              <td style={valueCell}>{data.employeeCode}</td>
            </tr>
            <tr>
              <td style={labelCell}>Department</td>
              <td style={valueCell}>{data.department}</td>
              <td style={labelCell}>Position</td>
              <td style={valueCell}>{data.position}</td>
            </tr>
            <tr>
              <td style={labelCell}>Email</td>
              <td style={valueCell} colSpan={3}>
                {data.employeeEmail}
              </td>
            </tr>
          </tbody>
        </table>

        {summaryRows.length > 1 && (
          <div style={summaryBoxStyle}>
            <p style={{ margin: '0 0 6px', fontWeight: 'bold', fontSize: 13 }}>
              Days by project this period:
            </p>
            {summaryRows.map((r) => (
              <span key={r.projectLabel} style={summaryChipStyle}>
                {r.projectLabel}: {r.days} day{r.days === 1 ? '' : 's'}
              </span>
            ))}
          </div>
        )}

        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginBottom: 20,
          }}
        >
          <thead>
            <tr style={{ borderBottom: '2px solid #333' }}>
              <th style={thStyle}>Description</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Hours</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Rate</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #ddd' }}>
              <td style={tdStyle}>Days Present</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                {data.daysPresent}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>-</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>-</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #ddd' }}>
              <td style={tdStyle}>Basic Pay</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                {data.basicHours}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                {data.hourlyRate.toFixed(2)}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                {data.basicPay.toFixed(2)}
              </td>
            </tr>
            <tr style={{ borderBottom: '1px solid #ddd' }}>
              <td style={tdStyle}>Overtime Pay</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{data.otHours}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                {data.hourlyRate.toFixed(2)}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                {data.otPay.toFixed(2)}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #333', fontWeight: 'bold' }}>
              <td style={tdStyle} colSpan={3}>
                Total Pay
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                {data.totalPay.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>

        {dailyEntries.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Daily Breakdown</h3>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                marginBottom: 10,
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Project</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Basic Hrs</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>OT Hrs</th>
                  <th style={thStyle}>Note</th>
                </tr>
              </thead>
              <tbody>
                {dailyEntries.map((e) => (
                  <tr key={e.date} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={tdStyle}>{e.date}</td>
                    <td style={tdStyle}>{e.projectLabel}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {e.status === 'absent' ? '-' : e.basicHours}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {e.status === 'absent' ? '-' : e.otHours}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        color:
                          e.status === 'absent'
                            ? '#dc2626'
                            : e.source === 'off'
                            ? '#999'
                            : 'inherit',
                        fontWeight: e.status === 'absent' ? 'bold' : 'normal',
                      }}
                    >
                      {e.status === 'absent'
                        ? 'Absent'
                        : e.source === 'idle'
                        ? 'Idle Pool'
                        : e.source === 'holidayFill' || e.isHoliday
                        ? `Holiday - ${e.holidayName}`
                        : e.source === 'off'
                        ? '—'
                        : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {summaryRows.length > 1 && (
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  marginBottom: 20,
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ borderBottom: '1px solid #333' }}>
                    <th style={thStyle}>Project Hour Totals</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Days</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>
                      Basic Hrs
                    </th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>OT Hrs</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((r) => (
                    <tr key={r.projectLabel}>
                      <td style={tdStyle}>{r.projectLabel}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {r.days}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {r.basicHours}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {r.otHours}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        <p style={{ fontSize: 12, color: '#999', marginTop: 40 }}>
          Generated on {new Date(data.generatedAt).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

const sheetStyle: React.CSSProperties = {
  maxWidth: 700,
  margin: '20px auto',
  padding: 40,
  fontFamily: FONT_STACK,
  border: '1px solid #ddd',
  borderRadius: 8,
};
const printButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  background: '#1e3a8a',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: FONT_STACK,
  fontWeight: 600,
};
const companyNameHeaderStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 34,
  fontWeight: 900,
  color: '#0d9488',
  lineHeight: 1.2,
};
const projectNameHeaderStyle: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 20,
  fontWeight: 700,
  color: '#1e3a8a',
};
const payslipLabelStyle: React.CSSProperties = {
  margin: '0 0 4px',
  fontSize: 16,
  fontWeight: 700,
  color: '#374151',
  textTransform: 'uppercase',
  letterSpacing: '0.6px',
};
const labelCell: React.CSSProperties = {
  padding: '6px 10px',
  fontWeight: 'bold',
  color: '#555',
  width: '20%',
};
const valueCell: React.CSSProperties = { padding: '6px 10px', width: '30%' };
const thStyle: React.CSSProperties = { padding: '8px', textAlign: 'left' };
const tdStyle: React.CSSProperties = { padding: '8px' };
const summaryBoxStyle: React.CSSProperties = {
  background: '#f3f4f6',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  padding: '10px 14px',
  marginBottom: 20,
};
const summaryChipStyle: React.CSSProperties = {
  display: 'inline-block',
  background: '#e0f2fe',
  color: '#0369a1',
  borderRadius: 999,
  padding: '3px 10px',
  fontSize: 12,
  fontWeight: 600,
  marginRight: 8,
  marginBottom: 4,
};
