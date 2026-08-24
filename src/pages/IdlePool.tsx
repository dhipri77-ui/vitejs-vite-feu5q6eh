import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

interface IdleEmployee {
  id: string;
  employeeCode: string;
  name: string;
  position: string;
}

export default function IdlePool() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<IdleEmployee[]>([]);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const load = async () => {
      const projQ = query(
        collection(db, 'projects'),
        where('name', '==', 'IDLE-AWAITING')
      );
      const projSnap = await getDocs(projQ);
      if (projSnap.empty) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const idleProjectId = projSnap.docs[0].id;
      const empQ = query(
        collection(db, 'projectEmployees'),
        where('projectId', '==', idleProjectId)
      );
      const empSnap = await getDocs(empQ);
      const all = empSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as any[];
      setEmployees(all.filter((e) => e.status !== 'left'));
      setLoading(false);
    };
    load();
  }, []);

  if (loading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }

  if (notFound) {
    return (
      <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
        <h1 style={companyBannerStyle}>Airmech W.L.L</h1>
        <h1 style={pageTitleStyle}>Idle - Awaiting Assignment</h1>
        <p style={{ color: '#dc2626' }}>
          No "IDLE-AWAITING" project found. Please create it in Settings.
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
        <h1 style={pageTitleStyle}>Idle - Awaiting Assignment</h1>
      </div>

      <h3 style={{ ...sectionTitleStyle, marginTop: '140px' }}>
        Idle Employees
      </h3>
      <div style={bluePanelStyle}>
        {employees.length === 0 ? (
          <p style={panelEmptyStyle}>No one is currently idle.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{ textAlign: 'left', borderBottom: '2px solid #93c5fd' }}
              >
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Position</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid #bfdbfe' }}>
                  <td style={tdStyle}>{e.employeeCode}</td>
                  <td style={tdStyle}>{e.name}</td>
                  <td style={tdStyle}>{e.position}</td>
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
const pageTitleStyle: React.CSSProperties = {
  fontFamily: "'Poppins', 'Segoe UI', sans-serif",
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
const panelEmptyStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#1e40af',
  margin: 0,
};
const thStyle: React.CSSProperties = {
  padding: '10px 8px',
  fontSize: '15px',
  color: '#1e3a8a',
};
const tdStyle: React.CSSProperties = { padding: '10px 8px', fontSize: '15px' };
