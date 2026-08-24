import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';

const CLOUD_NAME = 'u19kvdoc';
const UPLOAD_PRESET = 'manpower unsigned';
const FONT_STACK = "'Poppins', 'Segoe UI', Arial, sans-serif";

interface Employee {
  code: string;
  name: string;
  position: string;
  department?: string;
  salary: number;
  payType: string;
  otMultiplier: number;
  joiningDate: string;
  mobile?: string;
  address?: string;
  phone?: string;
  email?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  emergencyRelation?: string;
  idFrontUrl?: string;
  idBackUrl?: string;
}

export default function EmployeeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [emp, setEmp] = useState<Employee | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Employee | null>(null);
  const [uploadingFront, setUploadingFront] = useState(false);
  const [uploadingBack, setUploadingBack] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchEmployee = async () => {
    if (!id) return;
    const snap = await getDoc(doc(db, 'employees', id));
    if (snap.exists()) {
      const data = snap.data() as Employee;
      setEmp(data);
      setForm(data);
    }
  };

  useEffect(() => {
    fetchEmployee();
  }, [id]);

  const uploadToCloudinary = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );
    if (!res.ok) throw new Error('Cloudinary upload failed');
    const data = await res.json();
    return data.secure_url;
  };

  const handlePhotoUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    side: 'front' | 'back'
  ) => {
    const file = e.target.files?.[0];
    if (!file || !form) return;
    side === 'front' ? setUploadingFront(true) : setUploadingBack(true);
    setSaveError('');
    try {
      const url = await uploadToCloudinary(file);
      setForm((prev) =>
        prev
          ? { ...prev, [side === 'front' ? 'idFrontUrl' : 'idBackUrl']: url }
          : prev
      );
    } catch (err) {
      setSaveError(
        'Photo upload failed. Please check your internet connection and try again.'
      );
    } finally {
      side === 'front' ? setUploadingFront(false) : setUploadingBack(false);
    }
  };

  const handleSave = async () => {
    if (!id || !form) return;
    setSaveError('');
    setSaving(true);
    try {
      // Strip out any undefined values — Firestore rejects the whole write if any field is undefined
      const clean: any = {};
      Object.entries(form).forEach(([key, value]) => {
        clean[key] = value === undefined ? '' : value;
      });
      await updateDoc(doc(db, 'employees', id), clean);
      setEmp(clean);
      setForm(clean);
      setEditing(false);
    } catch (err: any) {
      setSaveError(
        'Save failed: ' + (err.message || 'Unknown error. Please try again.')
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !emp) return;
    if (
      !confirm(
        'Remove this employee permanently? This should only be done when their service with the company has ended.'
      )
    )
      return;

    // Cascade: also remove any active project/Idle Pool assignment,
    // so a deleted HR record doesn't leave a ghost entry behind anywhere.
    const assignQ = query(
      collection(db, 'projectEmployees'),
      where('employeeCode', '==', emp.code)
    );
    const assignSnap = await getDocs(assignQ);
    await Promise.all(
      assignSnap.docs
        .filter((d) => d.data().status !== 'left')
        .map((d) => deleteDoc(doc(db, 'projectEmployees', d.id)))
    );

    await deleteDoc(doc(db, 'employees', id));
    navigate('/hr');
  };

  if (!emp || !form) {
    return (
      <div style={{ padding: '40px', fontFamily: FONT_STACK }}>Loading...</div>
    );
  }

  const uploadInProgress = uploadingFront || uploadingBack;

  return (
    <div
      style={{
        padding: '40px',
        paddingRight: '170px',
        fontFamily: FONT_STACK,
        maxWidth: '700px',
      }}
    >
      <button onClick={() => navigate('/hr')} style={backButtonStyle}>
        ← Back to HR
      </button>

      <p style={companyNameStyle}>Airmech W.L.L</p>
      <h1 style={employeeNameStyle}>{emp.name}</h1>
      <p style={employeeSubtitleStyle}>
        {emp.code} · {emp.position}
      </p>

      <div
        style={{
          display: 'flex',
          gap: '10px',
          margin: '15px 0',
          alignItems: 'center',
        }}
      >
        {!editing ? (
          <button onClick={() => setEditing(true)} style={editButtonStyle}>
            Edit
          </button>
        ) : (
          <>
            <button
              onClick={handleSave}
              style={saveButtonStyle}
              disabled={uploadInProgress || saving}
            >
              {saving
                ? 'Saving...'
                : uploadInProgress
                ? 'Waiting for upload...'
                : 'Save Changes'}
            </button>
            <button
              onClick={() => {
                setForm(emp);
                setEditing(false);
                setSaveError('');
              }}
              style={cancelButtonStyle}
            >
              Cancel
            </button>
          </>
        )}
        <button onClick={handleDelete} style={deleteButtonStyle}>
          Remove Employee
        </button>
      </div>

      {saveError && (
        <p
          style={{
            color: '#dc2626',
            fontSize: '13px',
            background: '#fee2e2',
            padding: '8px',
            borderRadius: '6px',
          }}
        >
          {saveError}
        </p>
      )}

      {/* WORKER LOGIN — always read-only, regardless of edit mode. Editing
          "mobile" here would only change the HR record, not the worker's
          actual Firebase Auth password, so it's never made editable on
          this page to avoid the two silently drifting out of sync. */}
      <h3 style={sectionTitleStyle}>Worker Login</h3>
      <div style={gridStyle}>
        <div>
          <p style={labelStyle}>Employee Code</p>
          <p style={valueStyle}>{emp.code || '—'}</p>
        </div>
        <div>
          <p style={labelStyle}>Mobile (login password)</p>
          <p style={valueStyle}>{emp.mobile || '—'}</p>
        </div>
      </div>
      <p style={loginHintStyle}>
        This is what the worker enters on the /worker check-in page — the
        Employee Code as their ID and this Mobile number as their password.
        It can't be changed from this page.
      </p>

      <h3 style={sectionTitleStyle}>Employment Details</h3>
      <div style={gridStyle}>
        <Field
          label="Department"
          value={form.department || ''}
          editing={editing}
          onChange={(v: string) => setForm({ ...form, department: v })}
        />
        <Field
          label="Salary (Basic)"
          value={form.salary}
          editing={editing}
          onChange={(v: string) => setForm({ ...form, salary: Number(v) })}
          type="number"
        />
        <div>
          <p style={labelStyle}>Pay Type</p>
          {editing ? (
            <select
              value={form.payType}
              onChange={(e) => setForm({ ...form, payType: e.target.value })}
              style={inputStyle}
            >
              <option value="basic">Basic Only</option>
              <option value="basicOt">Basic + OT</option>
            </select>
          ) : (
            <p style={valueStyle}>
              {form.payType === 'basicOt' ? 'Basic + OT' : 'Basic'}
            </p>
          )}
        </div>
        <Field
          label="Date of Joining"
          value={form.joiningDate}
          editing={editing}
          onChange={(v: string) => setForm({ ...form, joiningDate: v })}
          type="date"
        />
        {form.payType === 'basicOt' && (
          <Field
            label="OT Multiplier"
            value={form.otMultiplier}
            editing={editing}
            onChange={(v: string) =>
              setForm({ ...form, otMultiplier: Number(v) })
            }
            type="number"
          />
        )}
      </div>

      <h3 style={sectionTitleStyle}>Address & Communication</h3>
      <div style={gridStyle}>
        <Field
          label="Address"
          value={form.address || ''}
          editing={editing}
          onChange={(v: string) => setForm({ ...form, address: v })}
          full
        />
        <Field
          label="Phone"
          value={form.phone || ''}
          editing={editing}
          onChange={(v: string) => setForm({ ...form, phone: v })}
        />
        <Field
          label="Email"
          value={form.email || ''}
          editing={editing}
          onChange={(v: string) => setForm({ ...form, email: v })}
        />
      </div>

      <h3 style={sectionTitleStyle}>Emergency Contact</h3>
      <div style={gridStyle}>
        <Field
          label="Name"
          value={form.emergencyName || ''}
          editing={editing}
          onChange={(v: string) => setForm({ ...form, emergencyName: v })}
        />
        <Field
          label="Phone"
          value={form.emergencyPhone || ''}
          editing={editing}
          onChange={(v: string) => setForm({ ...form, emergencyPhone: v })}
        />
        <Field
          label="Relationship"
          value={form.emergencyRelation || ''}
          editing={editing}
          onChange={(v: string) => setForm({ ...form, emergencyRelation: v })}
        />
      </div>

      <h3 style={sectionTitleStyle}>ID Card Photos</h3>
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div>
          <p style={labelStyle}>Front</p>
          {form.idFrontUrl && <img src={form.idFrontUrl} style={photoStyle} />}
          {editing && (
            <div style={{ marginTop: '5px' }}>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handlePhotoUpload(e, 'front')}
              />
              {uploadingFront && (
                <p style={{ fontSize: '12px', color: '#1e3a8a' }}>
                  Uploading...
                </p>
              )}
            </div>
          )}
        </div>
        <div>
          <p style={labelStyle}>Back</p>
          {form.idBackUrl && <img src={form.idBackUrl} style={photoStyle} />}
          {editing && (
            <div style={{ marginTop: '5px' }}>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handlePhotoUpload(e, 'back')}
              />
              {uploadingBack && (
                <p style={{ fontSize: '12px', color: '#1e3a8a' }}>
                  Uploading...
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  editing,
  onChange,
  type = 'text',
  full = false,
}: any) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : undefined }}>
      <p style={labelStyle}>{label}</p>
      {editing ? (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      ) : (
        <p style={valueStyle}>{value || '—'}</p>
      )}
    </div>
  );
}

const companyNameStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '22px',
  fontWeight: 800,
  color: '#0d9488',
  margin: '10px 0 0 0',
};
const employeeNameStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '30px',
  fontWeight: 800,
  lineHeight: 1.25,
  color: '#1e3a8a',
  margin: '4px 0 6px',
};
const employeeSubtitleStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '14px',
  color: '#666',
  margin: 0,
};
const sectionTitleStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  background: '#1e3a8a',
  color: '#ffffff',
  padding: '10px 16px',
  borderRadius: '6px',
  fontSize: '15px',
  fontWeight: 700,
  marginTop: '30px',
  marginBottom: 0,
};
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '15px',
  marginTop: '10px',
};
const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#888',
  marginBottom: '3px',
};
const valueStyle: React.CSSProperties = { fontSize: '14px', margin: 0 };
const loginHintStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#888',
  marginTop: '8px',
  fontFamily: FONT_STACK,
};
const inputStyle: React.CSSProperties = {
  padding: '6px',
  borderRadius: '5px',
  border: '1px solid #ccc',
  fontSize: '14px',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: FONT_STACK,
};
const photoStyle: React.CSSProperties = {
  width: '220px',
  borderRadius: '8px',
  border: '1px solid #ddd',
};
const backButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#1e3a8a',
  cursor: 'pointer',
  fontSize: '14px',
  padding: 0,
  fontFamily: FONT_STACK,
};
const editButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: '#16a34a',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontFamily: FONT_STACK,
};
const saveButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: '#1e3a8a',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontFamily: FONT_STACK,
};
const cancelButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: '#9ca3af',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontFamily: FONT_STACK,
};
const deleteButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: '#dc2626',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontFamily: FONT_STACK,
};
