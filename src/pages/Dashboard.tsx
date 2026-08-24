import { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

const FONT_STACK = "'Poppins', 'Segoe UI', Arial, sans-serif";

interface Project {
  id: string;
  name: string;
  code: string;
  startDate: string;
  completionDate: string;
  assumedManHours: number;
  budget?: number;
}

interface Subcontractor {
  id: string;
  companyName: string;
}

interface SubTotal {
  companyName: string;
  manHours: number;
  invoiced: number;
}

// Converts a stored 'YYYY-MM-DD' date string to 'DD/MM/YYYY' for display.
const formatDate = (isoDate?: string): string => {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

export default function Dashboard() {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const [ownManHours, setOwnManHours] = useState(0);
  const [ownSpend, setOwnSpend] = useState(0);
  const [subTotals, setSubTotals] = useState<SubTotal[]>([]);

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
          await loadAll(proj.id);
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const loadAll = async (projectId: string) => {
    const attQ = query(
      collection(db, 'attendance'),
      where('projectId', '==', projectId)
    );
    const attSnap = await getDocs(attQ);
    let hours = 0;
    attSnap.docs.forEach((d) => {
      const data = d.data();
      if (data.status === 'present') hours += data.totalHours || 0;
    });
    setOwnManHours(hours);

    // Only APPROVED payslips count toward real spend - draft/unapproved
    // generations (and any leftover orphaned test-data drafts from
    // before the no-draft-persistence fix) should never inflate this
    // figure.
    const paySlipQ = query(
      collection(db, 'payslips'),
      where('projectId', '==', projectId),
      where('approved', '==', true)
    );
    const paySlipSnap = await getDocs(paySlipQ);
    let spend = 0;
    paySlipSnap.docs.forEach((d) => {
      spend += d.data().totalPay || 0;
    });
    setOwnSpend(spend);

    const subQ = query(
      collection(db, 'subcontractors'),
      where('projectId', '==', projectId)
    );
    const subSnap = await getDocs(subQ);
    const subs = subSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as Subcontractor[];

    const subAttQ = query(
      collection(db, 'subcontractorAttendance'),
      where('projectId', '==', projectId)
    );
    const subAttSnap = await getDocs(subAttQ);
    const hoursBySub: { [id: string]: number } = {};
    subAttSnap.docs.forEach((d) => {
      const data = d.data();
      hoursBySub[data.subcontractorId] =
        (hoursBySub[data.subcontractorId] || 0) + (data.manHours || 0);
    });

    const subInvQ = query(
      collection(db, 'subcontractorInvoices'),
      where('projectId', '==', projectId)
    );
    const subInvSnap = await getDocs(subInvQ);
    const invoicedBySub: { [id: string]: number } = {};
    subInvSnap.docs.forEach((d) => {
      const data = d.data();
      invoicedBySub[data.subcontractorId] =
        (invoicedBySub[data.subcontractorId] || 0) + (data.amount || 0);
    });

    setSubTotals(
      subs.map((s) => ({
        companyName: s.companyName,
        manHours: hoursBySub[s.id] || 0,
        invoiced: invoicedBySub[s.id] || 0,
      }))
    );
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', fontFamily: FONT_STACK }}>Loading...</div>
    );
  }

  if (!project) {
    return (
      <div style={{ padding: '40px', fontFamily: FONT_STACK }}>
        <p style={{ color: '#dc2626' }}>
          No project is assigned to your account.
        </p>
      </div>
    );
  }

  const subManHoursTotal = subTotals.reduce((sum, s) => sum + s.manHours, 0);
  const subInvoicedTotal = subTotals.reduce((sum, s) => sum + s.invoiced, 0);
  const totalManHours = ownManHours + subManHoursTotal;
  const totalSpent = ownSpend + subInvoicedTotal;

  return (
    <div
      style={{
        padding: '40px',
        paddingRight: '170px',
        paddingBottom: '190px',
        fontFamily: FONT_STACK,
        maxWidth: '600px',
        position: 'relative',
      }}
    >
      <img
        src="https://res.cloudinary.com/u19kvdoc/image/upload/v1786613159/mfftkx5dgozunpbnwwsy.jpg"
        alt=""
        style={{
          position: 'absolute',
          bottom: '20px',
          left: '20px',
          width: '130px',
          opacity: 0.12,
          pointerEvents: 'none',
          userSelect: 'none',
          zIndex: 0,
        }}
      />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <h1 style={companyBannerStyle}>Airmech W.L.L</h1>
        <h1 style={projectNameStyle}>{project.name}</h1>

        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>Project Info</h3>
          <div style={rowStyle}>
            <span>Project Code</span>
            <strong>{project.code}</strong>
          </div>
          <div style={rowStyle}>
            <span>Start Date</span>
            <strong>{formatDate(project.startDate)}</strong>
          </div>
          <div style={rowStyle}>
            <span>Completion Date</span>
            <strong>{formatDate(project.completionDate)}</strong>
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>Man Hours</h3>
          <div style={rowStyle}>
            <span>Assumed Man Hours</span>
            <strong style={figureStyle}>{project.assumedManHours}</strong>
          </div>
          <div style={rowStyle}>
            <span>Airmech (Own) Man Hours</span>
            <strong>{ownManHours}</strong>
          </div>
          {subTotals.map((s) => (
            <div style={rowStyle} key={s.companyName}>
              <span>{s.companyName} Man Hours</span>
              <strong>{s.manHours}</strong>
            </div>
          ))}
          <div style={totalRowStyle}>
            <span>Total Man Hours</span>
            <strong style={figureStyle}>{totalManHours}</strong>
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>Expense</h3>
          <div style={rowStyle}>
            <span>Budget</span>
            <strong style={figureStyle}>
              {project.budget !== undefined
                ? project.budget.toFixed(2)
                : 'Not set'}
            </strong>
          </div>
          <div style={rowStyle}>
            <span>Airmech (Own) Payroll Spend</span>
            <strong>{ownSpend.toFixed(2)}</strong>
          </div>
          {subTotals.map((s) => (
            <div style={rowStyle} key={s.companyName}>
              <span>{s.companyName} Invoiced</span>
              <strong>{s.invoiced.toFixed(2)}</strong>
            </div>
          ))}
          <div style={totalRowStyle}>
            <span>Total Spent (as of today)</span>
            <strong style={figureStyle}>{totalSpent.toFixed(2)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
const companyBannerStyle: React.CSSProperties = {
  textAlign: 'center',
  fontFamily: FONT_STACK,
  fontSize: '46px',
  fontWeight: 900,
  color: '#0d9488',
  letterSpacing: '0.5px',
  margin: '0 0 4px',
};

const projectNameStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '38px',
  fontWeight: 800,
  marginBottom: '20px',
  color: '#1e3a8a',
};
const cardStyle: React.CSSProperties = {
  background:
    'linear-gradient(135deg, rgba(240,249,255,0.7) 0%, rgba(224,242,254,0.7) 100%)',
  padding: '20px 24px',
  borderRadius: '12px',
  marginTop: '18px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};
const cardTitleStyle: React.CSSProperties = {
  marginTop: 0,
  color: '#0f4c5c',
  fontWeight: 700,
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '7px 0',
  fontSize: '14.5px',
};
const totalRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  borderTop: '1px solid #b0d4e3',
  paddingTop: '10px',
  marginTop: '10px',
  fontSize: '16px',
};
const figureStyle: React.CSSProperties = {
  color: '#0891b2',
  fontSize: '20px',
  fontWeight: 800,
};
