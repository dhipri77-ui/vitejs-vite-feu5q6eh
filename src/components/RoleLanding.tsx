import { NavLink, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

interface RoleLandingItem {
  to: string;
  label: string;
}

interface RoleLandingProps {
  pageTitle: string;
  items: RoleLandingItem[];
  companyName?: string;
}

const FONT_STACK = "'Poppins', 'Segoe UI', Arial, sans-serif";

export default function RoleLanding({
  pageTitle,
  items,
  companyName = 'Airmech W.L.L',
}: RoleLandingProps) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/');
  };

  return (
    <div style={containerStyle}>
      <button onClick={handleLogout} style={logoutButtonStyle}>
        Log Out
      </button>
      <p style={companyNameStyle}>{companyName}</p>
      <h1 style={titleStyle}>{pageTitle}</h1>
      <div style={gridStyle}>
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} style={iconBoxStyle}>
            {item.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  paddingTop: '48px',
  fontFamily: FONT_STACK,
  position: 'relative',
  background: '#f8fafc',
};
const logoutButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: '20px',
  right: '20px',
  padding: '10px 16px',
  background: '#dc2626',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  fontSize: '14px',
  cursor: 'pointer',
};
const companyNameStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '32px',
  fontWeight: 800,
  color: '#0d9488',
  margin: '0 0 4px 0',
};
const titleStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '40px',
  fontWeight: 900,
  color: '#1e3a8a',
  marginBottom: '40px',
};
const gridStyle: React.CSSProperties = {
  display: 'flex',
  gap: '30px',
  flexWrap: 'wrap',
  justifyContent: 'center',
};
const iconBoxStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  width: '160px',
  height: '160px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#1e3a8a',
  color: '#fff',
  fontSize: '18px',
  fontWeight: 700,
  borderRadius: '16px',
  textDecoration: 'none',
  textAlign: 'center',
  padding: '10px',
  boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
};
