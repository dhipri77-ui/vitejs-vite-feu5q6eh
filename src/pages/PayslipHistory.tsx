import { useEffect, useState, Fragment } from 'react';
import { useParams, Link } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';

interface ApprovalHistoryEntry {
  approvedAt: string;
  daysPresent: number;
  basicHours: number;
  otHours: number;
  basicPay: number;
  otPay: number;
  totalPay: number;
}

interface PayslipEntry {
  periodStart: string;
  periodEnd: string;
  approved: boolean;
  approvedAt: string | null;
  totalPay: number;
  daysPresent: number;
  approvalHistory: ApprovalHistoryEntry[];
}

// Converts a stored 'YYYY-MM-DD' date string to 'DD/MM/YYYY' for display.
const formatDate = (isoDate?: string | null): string => {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

const formatDateTime = (iso?: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
};

const FONT_STACK = "'Poppins', 'Segoe UI', Arial, sans-serif";

export default function PayslipHistory() {
  const { projectId, code } = useParams();
  const [employeeName, setEmployeeName] = useState('');
  const [entries, setEntries] = useState<PayslipEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [grandTotal, setGrandTotal] = useState(0);
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        loadHistory();
      }
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, code]);

  async function loadHistory() {
    setLoading(true);

    // Employee name lookup (HR master), unrelated to period logic.
    const empQuery = query(
      collection(db, 'employees'),
      where('code', '==', code)
    );
    const empSnap = await getDocs(empQuery);
    if (!empSnap.empty) {
      setEmployeeName(empSnap.docs[0].data().name || '');
    }

    // Query the ACTUAL payslip docs for this employee on this project,
    // whatever period each one covers - rather than assuming every
    // period is a full calendar month (the old approach silently
    // missed every custom-range payslip, e.g. from MasterSalaryPayslip.tsx).
    const payslipQ = query(
      collection(db, 'payslips'),
      where('projectId', '==', projectId),
      where('employeeCode', '==', code)
    );
    const payslipSnap = await getDocs(payslipQ);

    const results: PayslipEntry[] = payslipSnap.docs.map((d) => {
      const data = d.data() as any;
      return {
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        approved: data.approved || false,
        approvedAt: data.approvedAt || null,
        totalPay: data.totalPay || 0,
        daysPresent: data.daysPresent || 0,
        approvalHistory: data.approvalHistory || [],
      };
    });

    // Most recent period first.
    results.sort((a, b) => b.periodStart.localeCompare(a.periodStart));

    // Total Paid to Date only counts APPROVED payslips - matches the
    // rest of the app's approach of not letting draft/unapproved
    // figures count as real, paid amounts.
    const total = results
      .filter((r) => r.approved)
      .reduce((sum, r) => sum + r.totalPay, 0);

    setEntries(results);
    setGrandTotal(total);
    setLoading(false);
  }

  if (loading)
    return (
      <div style={{ padding: 24, fontFamily: FONT_STACK }}>
        Loading payslip history...
      </div>
    );

  return (
    <div
      style={{
        padding: 24,
        maxWidth: 800,
        margin: '0 auto',
        fontFamily: FONT_STACK,
      }}
    >
      <p style={companyNameStyle}>Airmech W.L.L</p>
      <h2 style={pageTitleStyle}>Payslip History</h2>
      <p style={{ color: '#555', fontSize: 15, marginTop: 0 }}>
        {employeeName} ({code})
      </p>

      <div style={summaryBannerStyle}>
        Total Approved &amp; Paid to Date: {grandTotal.toFixed(2)}
      </div>

      {entries.length === 0 ? (
        <p style={{ color: '#64748b' }}>
          No payslips found yet for this employee on this project.
        </p>
      ) : (
        <div style={panelStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{ borderBottom: '2px solid #93c5fd', textAlign: 'left' }}
              >
                <th style={thStyle}>Period</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Total Pay</th>
                <th style={thStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const key = `${e.periodStart}_${e.periodEnd}`;
                const isExpanded = expandedPeriod === key;
                return (
                  <Fragment key={key}>
                    <tr style={{ borderBottom: '1px solid #bfdbfe' }}>
                      <td style={tdStyle}>
                        {formatDate(e.periodStart)} - {formatDate(e.periodEnd)}
                      </td>
                      <td style={tdStyle}>
                        {e.approved ? (
                          <span style={statusApprovedStyle}>Approved</span>
                        ) : (
                          <span style={statusDraftStyle}>Draft</span>
                        )}
                      </td>
                      <td style={tdStyle}>{e.totalPay.toFixed(2)}</td>
                      <td
                        style={{
                          ...tdStyle,
                          display: 'flex',
                          gap: '10px',
                          alignItems: 'center',
                        }}
                      >
                        <Link
                          to={`/payslip/${projectId}/${code}/${e.periodStart}/${e.periodEnd}`}
                          style={viewLinkStyle}
                        >
                          View
                        </Link>
                        {e.approvalHistory.length > 0 && (
                          <button
                            onClick={() =>
                              setExpandedPeriod(isExpanded ? null : key)
                            }
                            style={trailButtonStyle}
                          >
                            {isExpanded ? 'Hide trail' : 'Approval trail'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={4} style={{ padding: '0 8px 12px' }}>
                          <div
                            style={{
                              background: '#f9fafb',
                              border: '1px solid #e5e7eb',
                              borderRadius: 6,
                              padding: '10px 14px',
                              fontFamily: FONT_STACK,
                            }}
                          >
                            <p
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                margin: '0 0 6px',
                                color: '#374151',
                              }}
                            >
                              Approval trail (oldest to newest):
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
                                    Total Pay
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {e.approvalHistory.map((h, i) => (
                                  <tr key={i}>
                                    <td style={{ padding: '2px 6px' }}>
                                      {formatDateTime(h.approvedAt)}
                                    </td>
                                    <td style={{ padding: '2px 6px' }}>
                                      {h.daysPresent}
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
        </div>
      )}
    </div>
  );
}

const companyNameStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '24px',
  fontWeight: 800,
  color: '#0d9488',
  margin: '0 0 2px',
};
const pageTitleStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '32px',
  fontWeight: 900,
  color: '#1e3a8a',
  margin: '0 0 4px',
};
const summaryBannerStyle: React.CSSProperties = {
  background: '#1e3a8a',
  color: '#fff',
  padding: '12px 18px',
  borderRadius: 8,
  marginBottom: 20,
  fontWeight: 700,
  fontSize: '15px',
};
const panelStyle: React.CSSProperties = {
  background: '#dbeafe',
  border: '1px solid #93c5fd',
  borderRadius: '10px',
  padding: '16px 20px',
};
const thStyle: React.CSSProperties = {
  padding: 8,
  fontSize: '15px',
  color: '#1e3a8a',
};
const tdStyle: React.CSSProperties = {
  padding: 8,
  fontSize: '15px',
};
const statusApprovedStyle: React.CSSProperties = {
  color: '#16a34a',
  background: '#dcfce7',
  padding: '3px 10px',
  borderRadius: '999px',
  fontSize: '13px',
  fontWeight: 700,
};
const statusDraftStyle: React.CSSProperties = {
  color: '#64748b',
  background: '#f1f5f9',
  padding: '3px 10px',
  borderRadius: '999px',
  fontSize: '13px',
  fontWeight: 600,
};
const viewLinkStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#2563eb',
  color: '#fff',
  borderRadius: '5px',
  fontSize: '13px',
  textDecoration: 'none',
  fontWeight: 600,
};
const trailButtonStyle: React.CSSProperties = {
  background: '#eff6ff',
  border: '1px solid #93c5fd',
  borderRadius: 4,
  padding: '3px 10px',
  cursor: 'pointer',
  fontSize: 12,
  color: '#1e3a8a',
  fontFamily: FONT_STACK,
};
