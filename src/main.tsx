import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Hide the splash screen a moment after the app has mounted, fading it out
// smoothly rather than having it vanish abruptly.
window.setTimeout(() => {
  const splash = document.getElementById('splash-screen');
  if (splash) {
    splash.classList.add('fade-out');
    window.setTimeout(() => splash.remove(), 500);
  }
}, 1500);
