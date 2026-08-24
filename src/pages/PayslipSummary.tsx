import { useState, useEffect, Fragment } from 'react';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { useAccessGuard } from '../lib/useAccessGuard';

interface PayslipDoc {
  projectId: string;
  projectName: string;
  employeeCode: string;
  employeeName: string;
  periodStart: string;
  periodEnd: string;
  daysPresent: number;
  basicPay: number;
  otPay: number;
  totalPay: number;
  approvedAt: string;
  approvalHistory?: { approvedAt: string }[];
}

interface ProjectGroup {
  key: string; // projectId_periodStart_periodEnd
  projectId: string;
  projectName: string;
  periodStart: string;
  periodEnd: string;
  totalPay: number;
  employees: PayslipDoc[];
}

interface CycleSummary {
  code: string; // '001', '002', ...
  date: string; // YYYY-MM-DD
  totalAmount: number;
  projectGroups: ProjectGroup[];
}

// Converts a stored 'YYYY-MM-DD' date string to 'DD/MM/YYYY' for display.
const formatDate = (isoDate?: string): string => {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

const formatDateTime = (iso?: string): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
};

const FONT_STACK = "'Poppins', 'Segoe UI', Arial, sans-serif";

export default function PayslipSummary() {
  const { loading: accessLoading, allowed } = useAccessGuard([
    'master',
    'accountant',
  ]);

  const [loading, setLoading] = useState(true);
  const [cycles, setCycles] = useState<CycleSummary[]>([]);
  const [selectedCycleCode, setSelectedCycleCode] = useState<string | null>(
    null
  );
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [expandedTrailCode, setExpandedTrailCode] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (allowed) loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  const loadSummary = async () => {
    setLoading(true);
    const q = query(collection(db, 'payslips'), where('approved', '==', true));
    const snap = await getDocs(q);
    const docs: PayslipDoc[] = snap.docs.map((d) => d.data() as any);

    // Bucket by the date each payslip was FIRST EVER approved on - not
    // its most recent approvedAt. This keeps cycle codes/dates stable:
    // a later re-approval of one employee's payslip doesn't drag the
    // whole cycle's date forward and misrepresent every other genuinely
    // untouched project/employee that was approved on the original day.
    // Individually revised payslips get a "Rev-0X" tag instead (see
    // revisionCount below), rather than moving cycles around.
    const byDate: { [date: string]: PayslipDoc[] } = {};
    docs.forEach((d) => {
      const firstApprovedAt =
        d.approvalHistory && d.approvalHistory.length > 0
          ? d.approvalHistory[0].approvedAt
          : d.approvedAt;
      const dateKey = (firstApprovedAt || '').split('T')[0];
      if (!dateKey) return;
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push(d);
    });

    const sortedDates = Object.keys(byDate).sort((a, b) => a.localeCompare(b));

    const result: CycleSummary[] = sortedDates.map((date, idx) => {
      const dateDocs = byDate[date];
      const totalAmount = dateDocs.reduce((sum, d) => sum + d.totalPay, 0);

      const groupMap: { [key: string]: ProjectGroup } = {};
      dateDocs.forEach((d) => {
        const key = `${d.projectId}_${d.periodStart}_${d.periodEnd}`;
        if (!groupMap[key]) {
          groupMap[key] = {
            key,
            projectId: d.projectId,
            projectName: d.projectName,
            periodStart: d.periodStart,
            periodEnd: d.periodEnd,
            totalPay: 0,
            employees: [],
          };
        }
        groupMap[key].totalPay += d.totalPay;
        groupMap[key].employees.push(d);
      });

      const projectGroups = Object.values(groupMap).sort((a, b) =>
        a.projectName.localeCompare(b.projectName)
      );

      return {
        code: String(idx + 1).padStart(3, '0'),
        date,
        totalAmount,
        projectGroups,
      };
    });

    // Most recent cycle first.
    result.reverse();

    setCycles(result);
    setLoading(false);
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

  const selectedCycle = cycles.find((c) => c.code === selectedCycleCode);
  const selectedGroup = selectedCycle?.projectGroups.find(
    (g) => g.key === selectedGroupKey
  );

  return (
    <div
      style={{
        padding: '40px',
        fontFamily: FONT_STACK,
        maxWidth: '1000px',
      }}
    >
      <div style={{ paddingRight: '170px' }}>
        <h1 style={companyBannerStyle}>Airmech W.L.L</h1>
        <h1 style={pageTitleStyle}>Payslip Summary</h1>
      </div>

      {/* LEVEL 3: employee-level breakdown for one project+period */}
      {selectedGroup ? (
        <>
          <button
            onClick={() => setSelectedGroupKey(null)}
            style={backLinkStyle}
          >
            ← Back to {selectedCycleCode} project breakdown
          </button>
          <h3 style={sectionTitleStyle}>
            {selectedGroup.projectName}: {formatDate(selectedGroup.periodStart)}{' '}
            - {formatDate(selectedGroup.periodEnd)}
          </h3>
          <div style={bluePanelStyle}>
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
                  <th style={thStyle}>Days</th>
                  <th style={thStyle}>Basic Pay</th>
                  <th style={thStyle}>OT Pay</th>
                  <th style={thStyle}>Total Pay</th>
                  <th style={thStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {selectedGroup.employees.map((e) => {
                  const revisionCount = e.approvalHistory
                    ? Math.max(0, e.approvalHistory.length - 1)
                    : 0;
                  const isTrailExpanded = expandedTrailCode === e.employeeCode;
                  return (
                    <Fragment key={e.employeeCode}>
                      <tr style={{ borderBottom: '1px solid #bfdbfe' }}>
                        <td style={tdStyle}>{e.employeeCode}</td>
                        <td style={tdStyle}>
                          {e.employeeName}
                          {revisionCount > 0 && (
                            <button
                              onClick={() =>
                                setExpandedTrailCode(
                                  isTrailExpanded ? null : e.employeeCode
                                )
                              }
                              style={revTagButtonStyle}
                            >
                              Rev-{String(revisionCount).padStart(2, '0')}
                            </button>
                          )}
                        </td>
                        <td style={tdStyle}>{e.daysPresent}</td>
                        <td style={tdStyle}>{e.basicPay.toFixed(2)}</td>
                        <td style={tdStyle}>{e.otPay.toFixed(2)}</td>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>
                          {e.totalPay.toFixed(2)}
                        </td>
                        <td style={tdStyle}>
                          <Link
                            to={`/payslip/${e.projectId}/${e.employeeCode}/${e.periodStart}/${e.periodEnd}`}
                            style={viewLinkStyle}
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                      {isTrailExpanded && e.approvalHistory && (
                        <tr>
                          <td colSpan={7} style={{ padding: '0 8px 12px' }}>
                            <div style={trailPanelStyle}>
                              <p
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  margin: '0 0 6px',
                                  color: '#374151',
                                }}
                              >
                                Revision history for {e.employeeName} (oldest to
                                newest):
                              </p>
                              <table style={{ width: '100%', fontSize: 12 }}>
                                <thead>
                                  <tr
                                    style={{
                                      textAlign: 'left',
                                      color: '#6b7280',
                                    }}
                                  >
                                    <th style={{ padding: '2px 6px' }}>
                                      Approved at
                                    </th>
                                    <th style={{ padding: '2px 6px' }}>Days</th>
                                    <th style={{ padding: '2px 6px' }}>
                                      Basic Pay
                                    </th>
                                    <th style={{ padding: '2px 6px' }}>
                                      OT Pay
                                    </th>
                                    <th style={{ padding: '2px 6px' }}>
                                      Total Pay
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {e.approvalHistory.map((h: any, i) => (
                                    <tr key={i}>
                                      <td style={{ padding: '2px 6px' }}>
                                        {formatDateTime(h.approvedAt)}
                                      </td>
                                      <td style={{ padding: '2px 6px' }}>
                                        {h.daysPresent}
                                      </td>
                                      <td style={{ padding: '2px 6px' }}>
                                        {h.basicPay.toFixed(2)}
                                      </td>
                                      <td style={{ padding: '2px 6px' }}>
                                        {h.otPay.toFixed(2)}
                                      </td>
                                      <td style={{ padding: '2px 6px' }}>
                                        {h.totalPay.toFixed(2)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <div style={totalLineStyle}>
              <span>Project Total</span>
              <strong style={{ fontSize: '18px' }}>
                {selectedGroup.totalPay.toFixed(2)}
              </strong>
            </div>
          </div>
        </>
      ) : selectedCycle ? (
        /* LEVEL 2: project breakdown for one cycle */
        <>
          <button
            onClick={() => setSelectedCycleCode(null)}
            style={backLinkStyle}
          >
            ← Back to Payslip Summary
          </button>
          <h3 style={sectionTitleStyle}>
            Cycle {selectedCycle.code} - {formatDate(selectedCycle.date)}
          </h3>
          <div style={bluePanelStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    textAlign: 'left',
                    borderBottom: '2px solid #93c5fd',
                  }}
                >
                  <th style={thStyle}>Project</th>
                  <th style={thStyle}>Period</th>
                  <th style={thStyle}>Amount Paid</th>
                  <th style={thStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {selectedCycle.projectGroups.map((g) => {
                  const revisedCount = g.employees.filter(
                    (e) => e.approvalHistory && e.approvalHistory.length > 1
                  ).length;
                  return (
                    <tr
                      key={g.key}
                      style={{ borderBottom: '1px solid #bfdbfe' }}
                    >
                      <td style={tdStyle}>
                        {g.projectName}
                        {revisedCount > 0 && (
                          <button
                            onClick={() => setSelectedGroupKey(g.key)}
                            style={revTagButtonStyle}
                          >
                            {revisedCount === 1
                              ? '1 Revised'
                              : `${revisedCount} Revised`}
                          </button>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {formatDate(g.periodStart)} - {formatDate(g.periodEnd)}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>
                        {g.totalPay.toFixed(2)}
                      </td>
                      <td style={tdStyle}>
                        <button
                          onClick={() => setSelectedGroupKey(g.key)}
                          style={viewButtonStyle}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={totalLineStyle}>
              <span>Cycle Total</span>
              <strong style={{ fontSize: '18px' }}>
                {selectedCycle.totalAmount.toFixed(2)}
              </strong>
            </div>
          </div>
        </>
      ) : (
        /* LEVEL 1: one line per approval-date cycle */
        <>
          <h3 style={{ ...sectionTitleStyle, marginTop: '35px' }}>
            All Payroll Cycles
          </h3>
          <div style={bluePanelStyle}>
            {cycles.length === 0 ? (
              <p style={panelEmptyStyle}>No approved payslips yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr
                    style={{
                      textAlign: 'left',
                      borderBottom: '2px solid #93c5fd',
                    }}
                  >
                    <th style={thStyle}>Payslip Code</th>
                    <th style={thStyle}>Date of Approval</th>
                    <th style={thStyle}>Total Amount</th>
                    <th style={thStyle}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {cycles.map((c) => (
                    <tr
                      key={c.code}
                      style={{ borderBottom: '1px solid #bfdbfe' }}
                    >
                      <td style={tdStyle}>{c.code}</td>
                      <td style={tdStyle}>{formatDate(c.date)}</td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>
                        {c.totalAmount.toFixed(2)}
                      </td>
                      <td style={tdStyle}>
                        <button
                          onClick={() => setSelectedCycleCode(c.code)}
                          style={viewButtonStyle}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const companyBannerStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '46px',
  fontWeight: 900,
  color: '#0d9488',
  margin: '0 0 16px',
};
const pageTitleStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '40px',
  fontWeight: 900,
  color: '#1e3a8a',
  letterSpacing: '0.4px',
  margin: '0 0 10px',
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
const backLinkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#1e3a8a',
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: '14px',
  padding: 0,
  marginTop: '20px',
};
const thStyle: React.CSSProperties = {
  padding: '10px 8px',
  fontSize: '14px',
  color: '#1e3a8a',
};
const tdStyle: React.CSSProperties = { padding: '10px 8px', fontSize: '14px' };
const viewButtonStyle: React.CSSProperties = {
  padding: '7px 14px',
  background: '#1e3a8a',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
};
const viewLinkStyle: React.CSSProperties = {
  padding: '7px 14px',
  background: '#1e3a8a',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  textDecoration: 'none',
  display: 'inline-flex',
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
const panelEmptyStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#1e40af',
};
const revTagButtonStyle: React.CSSProperties = {
  marginLeft: '8px',
  padding: '2px 8px',
  background: '#f59e0b',
  color: '#fff',
  border: 'none',
  borderRadius: '999px',
  fontSize: '11px',
  fontWeight: 700,
  cursor: 'pointer',
};
const trailPanelStyle: React.CSSProperties = {
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  padding: '10px 14px',
};
