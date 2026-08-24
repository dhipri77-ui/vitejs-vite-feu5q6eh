import type { ReactNode } from 'react';
import Sidebar from './Sidebar';

const cornerPhotoUrl =
  'https://res.cloudinary.com/u19kvdoc/image/upload/v1786886016/pic1.png';

const now = new Date();
const dateLabel = now.toLocaleDateString('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const dayLabel = now.toLocaleDateString('en-GB', { weekday: 'long' });

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <img
          src={cornerPhotoUrl}
          alt=""
          style={{
            position: 'absolute',
            top: '10px',
            right: '20px',
            height: '130px',
            width: 'auto',
            objectFit: 'contain',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '144px',
            right: '20px',
            textAlign: 'right',
            pointerEvents: 'none',
            userSelect: 'none',
            whiteSpace: 'nowrap',
            lineHeight: '1.3',
          }}
        >
          <div style={{ fontSize: '15px', fontWeight: 800, color: '#1e3a8a' }}>
            {dateLabel}
          </div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#1e3a8a' }}>
            {dayLabel}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
