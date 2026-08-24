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
  addDoc,
  deleteDoc,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

interface Project {
  id: string;
  name: string;
}

interface Subcontractor {
  id: string;
  companyName: string;
  departmentName?: string;
}

interface DailyEntry {
  workers: string;
  manHours: string;
}

interface Invoice {
  id: string;
  subcontractorId: string;
  date: string;
  amount: number;
  note: string;
}

interface SubDailyRecord {
  subcontractorId: string;
  companyName: string;
  date: string;
  workers: number;
  manHours: number;
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
const monthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
};

export default function SubcontractorLog() {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);

  const [date, setDate] = useState(today());
  const [entries, setEntries] = useState<{ [id: string]: DailyEntry }>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceSubId, setInvoiceSubId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceNote, setInvoiceNote] = useState('');

  const [rangeStart, setRangeStart] = useState(monthRange().start);
  const [rangeEnd, setRangeEnd] = useState(monthRange().end);
  const [summaryRows, setSummaryRows] = useState<SubDailyRecord[]>([]);

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
          fetchSubcontractors(proj.id);
          fetchInvoices(proj.id);
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const fetchSubcontractors = async (projectId: string) => {
    const q = query(
      collection(db, 'subcontractors'),
      where('projectId', '==', projectId)
    );
    const snapshot = await getDocs(q);
    setSubcontractors(
      snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Subcontractor[]
    );
  };

  const fetchInvoices = async (projectId: string) => {
    const q = query(
      collection(db, 'subcontractorInvoices'),
      where('projectId', '==', projectId)
    );
    const snapshot = await getDocs(q);
    setInvoices(
      snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Invoice[]
    );
  };

  const loadEntriesForDate = async (selectedDate: string) => {
    if (!project) return;
    const newEntries: { [id: string]: DailyEntry } = {};
    for (const sub of subcontractors) {
      const docId = `${project.id}_${sub.id}_${selectedDate}`;
      const snap = await getDoc(doc(db, 'subcontractorAttendance', docId));
      if (snap.exists()) {
        const data = snap.data();
        newEntries[sub.id] = {
          workers: String(data.workers ?? ''),
          manHours: String(data.manHours ?? ''),
        };
      } else {
        newEntries[sub.id] = { workers: '', manHours: '' };
      }
    }
    setEntries(newEntries);
  };

  useEffect(() => {
    if (project && subcontractors.length > 0) loadEntriesForDate(date);
    // eslint-disable-next-line
  }, [subcontractors, date]);

  const updateEntry = (id: string, field: keyof DailyEntry, value: string) => {
    setEntries((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const handleSaveAll = async () => {
    if (!project) return;
    setSaving(true);
    setSaveMsg('');
    try {
      for (const sub of subcontractors) {
        const entry = entries[sub.id];
        if (!entry || (!entry.workers && !entry.manHours)) continue;
        const docId = `${project.id}_${sub.id}_${date}`;
        await setDoc(doc(db, 'subcontractorAttendance', docId), {
          projectId: project.id,
          subcontractorId: sub.id,
          companyName: sub.companyName,
          date,
          workers: Number(entry.workers || 0),
          manHours: Number(entry.manHours || 0),
        });
      }
      setSaveMsg('Saved successfully for ' + formatDate(date));
      loadSummary();
    } catch (err: any) {
      setSaveMsg('Error saving: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !invoiceSubId || !invoiceAmount) return;
    await addDoc(collection(db, 'subcontractorInvoices'), {
      projectId: project.id,
      subcontractorId: invoiceSubId,
      date: invoiceDate,
      amount: Number(invoiceAmount),
      note: invoiceNote,
    });
    setInvoiceAmount('');
    setInvoiceNote('');
    fetchInvoices(project.id);
  };

  const handleDeleteInvoice = async (id: string) => {
    if (!confirm('Delete this invoice entry?')) return;
    await deleteDoc(doc(db, 'subcontractorInvoices', id));
    if (project) fetchInvoices(project.id);
  };

  const [summaryError, setSummaryError] = useState('');

  const loadSummary = async () => {
    if (!project) return;
    setSummaryError('');
    try {
      const q = query(
        collection(db, 'subcontractorAttendance'),
        where('projectId', '==', project.id),
        where('date', '>=', rangeStart),
        where('date', '<=', rangeEnd)
      );
      const snapshot = await getDocs(q);
      setSummaryRows(snapshot.docs.map((d) => d.data()) as SubDailyRecord[]);
    } catch (err: any) {
      setSummaryError(err.message);
      console.error('Summary load error:', err);
    }
  };

  useEffect(() => {
    if (project) loadSummary();
    // eslint-disable-next-line
  }, [project, rangeStart, rangeEnd]);

  const summaryBySubcontractor = subcontractors.map((sub) => {
    const rows = summaryRows.filter((r) => r.subcontractorId === sub.id);
    const totalWorkers = rows.reduce((sum, r) => sum + (r.workers || 0), 0);
    const totalManHours = rows.reduce((sum, r) => sum + (r.manHours || 0), 0);
    return { sub, totalWorkers, totalManHours, days: rows.length };
  });

  const invoiceTotalBySub = (subId: string) =>
    invoices
      .filter((inv) => inv.subcontractorId === subId)
      .reduce((sum, inv) => sum + inv.amount, 0);

  const grandInvoiceTotal = invoices.reduce((sum, inv) => sum + inv.amount, 0);
  const grandManHours = summaryBySubcontractor.reduce(
    (sum, s) => sum + s.totalManHours,
    0
  );

  if (loading) return <div style={{ padding: '40px' }}>Loading...</div>;

  if (!project) {
    return (
      <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
        <h1>Subcontractor Log</h1>
        <p style={{ color: '#dc2626' }}>
          No project is assigned to your account.
        </p>
      </div>
    );
  }

  if (subcontractors.length === 0) {
    return (
      <div
        style={{
          padding: '40px',
          fontFamily: 'Arial, sans-serif',
          maxWidth: '900px',
        }}
      >
        <h1 style={companyBannerStyle}>Airmech W.L.L</h1>
        <h1 style={projectTitleStyle}>{project.name}</h1>
        <p style={pageSubtitleStyle}>Subcontractor Log</p>
        <p style={{ color: '#999', marginTop: '90px' }}>
          No subcontractors added yet. Add one in Project & Admin first.
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
        <p style={pageSubtitleStyle}>Subcontractor Log</p>
      </div>

      {/* DAILY MANPOWER & MAN HOURS */}
      <h3 style={{ ...sectionTitleStyle, marginTop: '90px' }}>
        Daily Manpower & Man Hours
      </h3>
      <div style={bluePanelStyle}>
        <label style={labelStyle}>Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ ...inputStyle, display: 'block', marginBottom: '15px' }}
        />

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr
              style={{ textAlign: 'left', borderBottom: '2px solid #93c5fd' }}
            >
              <th style={thStyle}>Subcontractor</th>
              <th style={thStyle}>Department</th>
              <th style={thStyle}>No. of Workers</th>
              <th style={thStyle}>Man Hours</th>
            </tr>
          </thead>
          <tbody>
            {subcontractors.map((sub) => {
              const entry = entries[sub.id] || { workers: '', manHours: '' };
              return (
                <tr key={sub.id} style={{ borderBottom: '1px solid #bfdbfe' }}>
                  <td style={tdStyle}>{sub.companyName}</td>
                  <td style={tdStyle}>{sub.departmentName || '—'}</td>
                  <td style={tdStyle}>
                    <input
                      type="number"
                      value={entry.workers}
                      onChange={(e) =>
                        updateEntry(sub.id, 'workers', e.target.value)
                      }
                      style={{ ...inputStyle, width: '80px' }}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="number"
                      value={entry.manHours}
                      onChange={(e) =>
                        updateEntry(sub.id, 'manHours', e.target.value)
                      }
                      style={{ ...inputStyle, width: '80px' }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button
          onClick={handleSaveAll}
          style={{
            ...sectionButtonStyle,
            marginTop: '18px',
            maxWidth: '260px',
          }}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Entries'}
        </button>
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

      {/* INVOICE / CERTIFIED PAYMENTS */}
      <h3 style={sectionTitleStyle}>Invoice / Certified Payments</h3>
      <div style={bluePanelStyle}>
        <form
          onSubmit={handleAddInvoice}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            maxWidth: '400px',
          }}
        >
          <select
            value={invoiceSubId}
            onChange={(e) => setInvoiceSubId(e.target.value)}
            style={inputStyle}
          >
            <option value="">-- Select Subcontractor --</option>
            {subcontractors.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.companyName}
              </option>
            ))}
          </select>
          <label style={labelStyle}>Date</label>
          <input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Amount"
            type="number"
            value={invoiceAmount}
            onChange={(e) => setInvoiceAmount(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Invoice # / Note (optional)"
            value={invoiceNote}
            onChange={(e) => setInvoiceNote(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" style={sectionButtonStyle}>
            Add Invoice Entry
          </button>
        </form>

        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: '20px',
          }}
        >
          <thead>
            <tr
              style={{ textAlign: 'left', borderBottom: '2px solid #93c5fd' }}
            >
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Subcontractor</th>
              <th style={thStyle}>Amount</th>
              <th style={thStyle}>Note</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const sub = subcontractors.find(
                (s) => s.id === inv.subcontractorId
              );
              return (
                <tr key={inv.id} style={{ borderBottom: '1px solid #bfdbfe' }}>
                  <td style={tdStyle}>{formatDate(inv.date)}</td>
                  <td style={tdStyle}>{sub?.companyName || '—'}</td>
                  <td style={tdStyle}>{inv.amount.toFixed(2)}</td>
                  <td style={tdStyle}>{inv.note || '—'}</td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => handleDeleteInvoice(inv.id)}
                      style={deleteButtonStyle}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={totalLineStyle}>
          <span>Total Invoiced (All Subcontractors)</span>
          <strong style={{ fontSize: '18px' }}>
            {grandInvoiceTotal.toFixed(2)}
          </strong>
        </div>
      </div>

      {/* MAN HOURS SUMMARY BY PERIOD */}
      <h3 style={sectionTitleStyle}>Man Hours Summary (by Period)</h3>
      <div style={bluePanelStyle}>
        {summaryError && (
          <p style={{ color: '#dc2626', fontSize: '14px' }}>
            Error: {summaryError}
          </p>
        )}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
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
        </div>

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
              <th style={thStyle}>Subcontractor</th>
              <th style={thStyle}>Days Logged</th>
              <th style={thStyle}>Total Workers (sum)</th>
              <th style={thStyle}>Total Man Hours</th>
              <th style={thStyle}>Invoiced (all-time)</th>
            </tr>
          </thead>
          <tbody>
            {summaryBySubcontractor.map(
              ({ sub, totalWorkers, totalManHours, days }) => (
                <tr key={sub.id} style={{ borderBottom: '1px solid #bfdbfe' }}>
                  <td style={tdStyle}>{sub.companyName}</td>
                  <td style={tdStyle}>{days}</td>
                  <td style={tdStyle}>{totalWorkers}</td>
                  <td style={tdStyle}>{totalManHours}</td>
                  <td style={tdStyle}>
                    {invoiceTotalBySub(sub.id).toFixed(2)}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
        <div style={totalLineStyle}>
          <span>Combined Man Hours (all subcontractors, this period)</span>
          <strong style={{ fontSize: '18px' }}>{grandManHours}</strong>
        </div>
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
  padding: '9px',
  borderRadius: '6px',
  border: '1px solid #93c5fd',
  fontSize: '15px',
  background: '#fff',
};
const sectionButtonStyle: React.CSSProperties = {
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
const totalLineStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: '18px',
  paddingTop: '14px',
  borderTop: '1px solid #93c5fd',
  fontSize: '15px',
  color: '#1e40af',
};
