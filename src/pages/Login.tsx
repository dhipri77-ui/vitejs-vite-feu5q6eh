import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { resolveUserRole } from '../lib/userRole';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
      const role = await resolveUserRole(email);
      if (role.type === 'master') {
        navigate('/master-landing');
      } else if (role.type === 'hr') {
        navigate('/hr-landing');
      } else if (role.type === 'accountant') {
        navigate('/accountant-landing');
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError('Invalid email or password. Please try again.');
    }
  };

  return (
    <div style={styles.container}>
      <form onSubmit={handleLogin} style={styles.form}>
        <p style={styles.companyName}>Airmech W.L.L</p>
        <h1 style={styles.title}>Manpower Management</h1>
        <p style={styles.subtitle}>Sign in to continue</p>
        {error && <div style={styles.error}>{error}</div>}
        <label style={styles.label}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
          required
        />
        <label style={styles.label}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          required
        />
        <button type="submit" style={styles.button}>
          Login
        </button>
      </form>
    </div>
  );
}

const FONT_STACK = "'Poppins', 'Segoe UI', Arial, sans-serif";

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    background: '#f4f6f8',
    fontFamily: FONT_STACK,
  },
  form: {
    background: '#fff',
    padding: '40px',
    borderRadius: '10px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    width: '360px',
  },
  companyName: {
    margin: '0 0 4px 0',
    fontSize: '28px',
    fontWeight: 800,
    color: '#0d9488',
    textAlign: 'center',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 700,
    textAlign: 'center',
    color: '#1e3a8a',
  },
  subtitle: {
    textAlign: 'center',
    color: '#777',
    marginBottom: '20px',
    fontSize: '14px',
  },
  label: {
    display: 'block',
    marginTop: '12px',
    marginBottom: '4px',
    fontSize: '13px',
    color: '#333',
  },
  input: {
    width: '100%',
    padding: '10px',
    borderRadius: '6px',
    border: '1px solid #ccc',
    boxSizing: 'border-box',
    fontSize: '14px',
    fontFamily: FONT_STACK,
  },
  button: {
    width: '100%',
    marginTop: '20px',
    padding: '10px',
    background: '#1e3a8a',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '15px',
    fontFamily: FONT_STACK,
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: {
    background: '#fee2e2',
    color: '#b91c1c',
    padding: '8px',
    borderRadius: '6px',
    fontSize: '13px',
    marginBottom: '10px',
    textAlign: 'center',
  },
};
