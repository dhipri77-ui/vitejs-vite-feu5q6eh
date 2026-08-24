import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { collection, addDoc, getDocs } from 'firebase/firestore';
import { createWorkerLogin } from '../lib/workerAuth';
import { useAccessGuard } from '../lib/useAccessGuard';

const FONT_STACK = "'Poppins', 'Segoe UI', Arial, sans-serif";

interface Employee {
  id: string;
  code: string;
  name: string;
  position: string;
  salary: number;
  payType: string;
  otMultiplier: number;
  joiningDate: string;
  mobile?: string;
  department?: string;
  address?: string;
  phone?: string;
  email?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  emergencyRelation?: string;
}

interface BulkRow {
  code: string;
  name: string;
  position: string;
  department: string;
  mobile: string;
  salary: string;
  payType: string;
  otMultiplier: string;
  joiningDate: string;
  address: string;
  phone: string;
  email: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelation: string;
}

const emptyBulkRow = (): BulkRow => ({
  code: '',
  name: '',
  position: '',
  department: '',
  mobile: '',
  salary: '',
  payType: 'basic',
  otMultiplier: '1.2',
  joiningDate: '',
  address: '',
  phone: '',
  email: '',
  emergencyName: '',
  emergencyPhone: '',
  emergencyRelation: '',
});

const isBlankRow = (row: BulkRow) =>
  !row.code &&
  !row.name &&
  !row.position &&
  !row.mobile &&
  !row.salary &&
  !row.joiningDate;

type ColDef = {
  key: keyof BulkRow;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  width?: string;
};

const COLUMNS: ColDef[] = [
  { key: 'code', label: 'Code *', type: 'text' },
  { key: 'name', label: 'Name *', type: 'text' },
  { key: 'position', label: 'Position *', type: 'text' },
  { key: 'department', label: 'Department', type: 'text' },
  { key: 'mobile', label: 'Mobile *', type: 'text' },
  { key: 'salary', label: 'Salary *', type: 'number', width: '80px' },
  { key: 'payType', label: 'Pay Type', type: 'select', width: '110px' },
  { key: 'otMultiplier', label: 'OT Mult.', type: 'number', width: '65px' },
  { key: 'joiningDate', label: 'Joining Date *', type: 'date', width: '135px' },
  { key: 'address', label: 'Address', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'emergencyName', label: 'Emergency Name', type: 'text' },
  { key: 'emergencyPhone', label: 'Emergency Phone', type: 'text' },
  { key: 'emergencyRelation', label: 'Emergency Relation', type: 'text' },
];

export default function HR() {
  const { loading: accessLoading, allowed } = useAccessGuard(['master', 'hr']);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>(() =>
    Array.from({ length: 5 }, emptyBulkRow)
  );
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResults, setBulkResults] = useState<string[]>([]);
  // Rows whose Joining Date the user has edited directly — these stop
  // following Row 1's date once touched individually.
  const [dateOverrides, setDateOverrides] = useState<Set<number>>(new Set());
  const cellRefs = useRef<
    Record<string, HTMLInputElement | HTMLSelectElement | null>
  >({});
  // Set right before a new row is added via Enter-at-last-row, so we know
  // which cell to focus once that row actually exists in the DOM.
  const pendingFocusRef = useRef<{ row: number; col: number } | null>(null);

  useLayoutEffect(() => {
    if (pendingFocusRef.current) {
      const { row, col } = pendingFocusRef.current;
      pendingFocusRef.current = null;
      const key = `${row}-${COLUMNS[col].key}`;
      cellRefs.current[key]?.focus();
    }
  });

  const fetchEmployees = async () => {
    const snapshot = await getDocs(collection(db, 'employees'));
    const list = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as Employee[];
    list.sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true })
    );
    setEmployees(list);
  };

  useEffect(() => {
    fetchEmployees();
  }, []);
  if (accessLoading) {
    return (
      <div style={{ padding: '40px', fontFamily: FONT_STACK }}>Loading...</div>
    );
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

  const updateBulkRow = (
    index: number,
    field: keyof BulkRow,
    value: string
  ) => {
    // Joining Date on Row 1 broadcasts to every row that hasn't been
    // individually edited yet. Editing any other row's date directly
    // marks that row as overridden, so it stops following Row 1.
    if (field === 'joiningDate') {
      if (index === 0) {
        setBulkRows((prev) =>
          prev.map((row, i) => {
            if (i === 0) return { ...row, joiningDate: value };
            if (dateOverrides.has(i)) return row;
            return { ...row, joiningDate: value };
          })
        );
        return;
      }
      setDateOverrides((prev) => new Set(prev).add(index));
      setBulkRows((prev) =>
        prev.map((row, i) =>
          i === index ? { ...row, joiningDate: value } : row
        )
      );
      return;
    }

    setBulkRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  };

  const addBulkRow = (focusColIndex?: number) => {
    setBulkRows((prev) => {
      const next = [
        ...prev,
        { ...emptyBulkRow(), joiningDate: prev[0]?.joiningDate || '' },
      ];
      if (focusColIndex !== undefined) {
        pendingFocusRef.current = { row: next.length - 1, col: focusColIndex };
      }
      return next;
    });
  };

  const removeBulkRow = (index: number) => {
    setBulkRows((prev) => prev.filter((_, i) => i !== index));
    setDateOverrides((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      });
      return next;
    });
  };

  const openBulkModal = () => {
    setBulkResults([]);
    setShowBulkModal(true);
  };

  const focusCell = (rowIndex: number, colIndex: number) => {
    if (rowIndex < 0 || rowIndex >= bulkRows.length) return;
    if (colIndex < 0 || colIndex >= COLUMNS.length) return;
    const key = `${rowIndex}-${COLUMNS[colIndex].key}`;
    cellRefs.current[key]?.focus();
  };

  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    rowIndex: number,
    colIndex: number
  ) => {
    const target = e.target as HTMLInputElement;
    // Caret-aware left/right only applies to plain text cells — number,
    // date, and select cells always jump on arrow keys (selectionStart
    // isn't reliably readable on those input types across browsers).
    const isPlainText = target.tagName === 'INPUT' && target.type === 'text';

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusCell(rowIndex + 1, colIndex);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusCell(rowIndex - 1, colIndex);
        break;
      case 'Enter':
        e.preventDefault();
        if (rowIndex === bulkRows.length - 1) {
          addBulkRow(colIndex);
        } else {
          focusCell(rowIndex + 1, colIndex);
        }
        break;
      case 'ArrowLeft':
        if (
          !isPlainText ||
          (target.selectionStart === 0 && target.selectionEnd === 0)
        ) {
          e.preventDefault();
          focusCell(rowIndex, colIndex - 1);
        }
        break;
      case 'ArrowRight':
        if (
          !isPlainText ||
          (target.selectionStart === target.value.length &&
            target.selectionEnd === target.value.length)
        ) {
          e.preventDefault();
          focusCell(rowIndex, colIndex + 1);
        }
        break;
      default:
        break;
    }
  };

  const handleBulkSave = async () => {
    setBulkSaving(true);
    const results: string[] = [];
    const remainingRows: BulkRow[] = [];
    const remainingOverrides = new Set<number>();

    // A row that didn't save keeps its place in the grid — track where it
    // lands in the new (shorter) row list so date-override tracking stays
    // aligned with the rows that are actually still there.
    const keepRow = (row: BulkRow, originalIndex: number) => {
      const newIndex = remainingRows.length;
      remainingRows.push(row);
      if (dateOverrides.has(originalIndex)) remainingOverrides.add(newIndex);
    };

    // Track codes/mobiles used so far, including ones added earlier in this
    // same batch, so two rows in one sheet can't create duplicate accounts.
    const usedCodes = new Set(employees.map((e) => e.code.toLowerCase()));
    const usedMobiles = new Set(employees.map((e) => e.mobile).filter(Boolean));

    for (let i = 0; i < bulkRows.length; i++) {
      const row = bulkRows[i];

      if (isBlankRow(row)) {
        keepRow(row, i);
        continue;
      }

      if (
        !row.code ||
        !row.name ||
        !row.position ||
        !row.salary ||
        !row.joiningDate ||
        !row.mobile
      ) {
        results.push(
          `Row ${i + 1} (${
            row.name || row.code || 'unnamed'
          }): missing required field — Code, Name, Position, Mobile, Salary, and Joining Date are all required.`
        );
        keepRow(row, i);
        continue;
      }

      if (usedCodes.has(row.code.toLowerCase())) {
        results.push(
          `Row ${i + 1}: employee code "${row.code}" already exists.`
        );
        keepRow(row, i);
        continue;
      }

      if (usedMobiles.has(row.mobile)) {
        results.push(
          `Row ${i + 1}: mobile number "${row.mobile}" already exists.`
        );
        keepRow(row, i);
        continue;
      }

      try {
        await createWorkerLogin(row.code, row.mobile);
      } catch (err: any) {
        results.push(
          `Row ${i + 1} (${row.code}): error creating worker login — ${
            err.message
          }`
        );
        keepRow(row, i);
        continue;
      }

      try {
        await addDoc(collection(db, 'employees'), {
          code: row.code,
          name: row.name,
          position: row.position,
          department: row.department,
          salary: Number(row.salary),
          payType: row.payType,
          otMultiplier: Number(row.otMultiplier || '1.2'),
          joiningDate: row.joiningDate,
          mobile: row.mobile,
          address: row.address,
          phone: row.phone,
          email: row.email,
          emergencyName: row.emergencyName,
          emergencyPhone: row.emergencyPhone,
          emergencyRelation: row.emergencyRelation,
        });
        usedCodes.add(row.code.toLowerCase());
        usedMobiles.add(row.mobile);
        results.push(`Row ${i + 1} (${row.name}): added successfully.`);
      } catch (err: any) {
        results.push(
          `Row ${i + 1} (${
            row.code
          }): worker login was created but saving the employee record failed — ${
            err.message
          }`
        );
        keepRow(row, i);
      }
    }

    setBulkResults(results);
    if (remainingRows.length > 0) {
      setBulkRows(remainingRows);
      setDateOverrides(remainingOverrides);
    } else {
      setBulkRows(Array.from({ length: 5 }, emptyBulkRow));
      setDateOverrides(new Set());
    }
    setBulkSaving(false);
    fetchEmployees();
  };

  const filtered = employees.filter(
    (emp) =>
      emp.code.toLowerCase().includes(search.toLowerCase()) ||
      emp.name.toLowerCase().includes(search.toLowerCase()) ||
      emp.position.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      style={{
        padding: '40px',
        fontFamily: FONT_STACK,
        maxWidth: '1100px',
      }}
    >
      <div style={{ paddingRight: '170px' }}>
        <p style={companyNameStyle}>Airmech W.L.L</p>
        <h1 style={pageTitleStyle}>Employee Master</h1>
        <p style={{ color: '#666', fontSize: '15px', margin: '0 0 10px' }}>
          Master employee database for the company.
        </p>
      </div>

      {/* ADD NEW EMPLOYEE — collapsed; opens the bulk-entry sheet */}
      <div
        role="button"
        onClick={openBulkModal}
        style={{ ...sectionTitleStyle, marginTop: '90px', cursor: 'pointer' }}
      >
        + Add New Employee
      </div>

      {/* SEARCH EMPLOYEES */}
      <h3 style={sectionTitleStyle}>Search Employees</h3>
      <div style={bluePanelStyle}>
        <input
          placeholder="Search by code or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, maxWidth: '400px', marginBottom: '15px' }}
        />

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr
              style={{ textAlign: 'left', borderBottom: '2px solid #93c5fd' }}
            >
              <th style={thStyle}>Code</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Position</th>
              <th style={thStyle}>Department</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp) => (
              <tr key={emp.id} style={{ borderBottom: '1px solid #bfdbfe' }}>
                <td style={tdStyle}>{emp.code}</td>
                <td style={tdStyle}>{emp.name}</td>
                <td style={tdStyle}>{emp.position}</td>
                <td style={tdStyle}>{emp.department || '—'}</td>
                <td style={tdStyle}>
                  <button
                    onClick={() => navigate(`/hr/${emp.id}`)}
                    style={viewButtonStyle}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
            {search && filtered.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '10px', color: '#1e40af' }}>
                  No employees found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* BULK ADD MODAL — Excel-style multi-row entry sheet */}
      {showBulkModal && (
        <div style={modalOverlayStyle}>
          <div style={modalPanelStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '10px',
              }}
            >
              <h2
                style={{ margin: 0, color: '#1e3a8a', fontFamily: FONT_STACK }}
              >
                Add New Employees
              </h2>
              <button
                onClick={() => setShowBulkModal(false)}
                style={closeButtonStyle}
              >
                ✕
              </button>
            </div>
            <p style={{ fontSize: '13px', color: '#666', marginTop: 0 }}>
              Fill in as many rows as you need — blank rows are ignored. Code,
              Name, Position, Mobile, Salary, and Joining Date are required per
              employee. ID card photos aren't set here — add those from each
              employee's individual page after saving. Set the Joining Date on
              Row 1 and it fills every other row automatically — edit any
              individual row's date afterward to override just that one. Use the
              arrow keys or Enter to move between cells like a spreadsheet —
              press Enter on the last row to add a new one and keep going.
            </p>

            <div style={gridScrollStyle}>
              <table style={gridTableStyle}>
                <thead>
                  <tr>
                    <th style={gridThStyle}>#</th>
                    {COLUMNS.map((col) => (
                      <th key={col.key} style={gridThStyle}>
                        {col.label}
                      </th>
                    ))}
                    <th style={gridThStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {bulkRows.map((row, i) => (
                    <tr key={i}>
                      <td style={gridTdNumStyle}>{i + 1}</td>
                      {COLUMNS.map((col, colIndex) => (
                        <td style={gridTdStyle} key={col.key}>
                          {col.type === 'select' ? (
                            <select
                              ref={(el) => {
                                cellRefs.current[`${i}-${col.key}`] = el;
                              }}
                              value={row[col.key]}
                              onChange={(e) =>
                                updateBulkRow(i, col.key, e.target.value)
                              }
                              onKeyDown={(e) =>
                                handleCellKeyDown(e, i, colIndex)
                              }
                              style={{
                                ...cellInputStyle,
                                width: col.width || cellInputStyle.width,
                              }}
                            >
                              <option value="basic">Basic Only</option>
                              <option value="basicOt">Basic + OT</option>
                            </select>
                          ) : (
                            <input
                              ref={(el) => {
                                cellRefs.current[`${i}-${col.key}`] = el;
                              }}
                              type={col.type}
                              step={
                                col.key === 'otMultiplier' ? '0.1' : undefined
                              }
                              value={row[col.key]}
                              onChange={(e) =>
                                updateBulkRow(i, col.key, e.target.value)
                              }
                              onKeyDown={(e) =>
                                handleCellKeyDown(e, i, colIndex)
                              }
                              style={{
                                ...cellInputStyle,
                                width: col.width || cellInputStyle.width,
                              }}
                            />
                          )}
                        </td>
                      ))}
                      <td style={gridTdStyle}>
                        <button
                          onClick={() => removeBulkRow(i)}
                          style={removeRowButtonStyle}
                          title="Remove row"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {bulkResults.length > 0 && (
              <div style={resultsBoxStyle}>
                {bulkResults.map((r, i) => (
                  <p
                    key={i}
                    style={{
                      margin: '4px 0',
                      fontSize: '13px',
                      color: r.includes('successfully') ? '#16a34a' : '#dc2626',
                    }}
                  >
                    {r}
                  </p>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button
                onClick={handleBulkSave}
                disabled={bulkSaving}
                style={sectionButtonStyle}
              >
                {bulkSaving ? 'Saving...' : 'Save All'}
              </button>
              <button
                onClick={() => setShowBulkModal(false)}
                style={cancelModalButtonStyle}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const companyNameStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '28px',
  fontWeight: 800,
  color: '#0d9488',
  margin: '0 0 4px 0',
};
const pageTitleStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '40px',
  fontWeight: 900,
  color: '#1e3a8a',
  letterSpacing: '0.4px',
  margin: '0 0 6px',
};
const sectionTitleStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
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
const inputStyle: React.CSSProperties = {
  padding: '9px',
  borderRadius: '6px',
  border: '1px solid #93c5fd',
  fontSize: '15px',
  background: '#fff',
  fontFamily: FONT_STACK,
};
const sectionButtonStyle: React.CSSProperties = {
  marginTop: '5px',
  padding: '12px 18px',
  background: '#1e3a8a',
  color: '#fff',
  border: '1px solid #1e3a8a',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '15px',
  fontFamily: FONT_STACK,
};
const viewButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#1e3a8a',
  color: '#fff',
  border: 'none',
  borderRadius: '5px',
  cursor: 'pointer',
  fontSize: '13px',
  fontFamily: FONT_STACK,
};
const thStyle: React.CSSProperties = {
  padding: '10px 8px',
  fontSize: '15px',
  color: '#1e3a8a',
};
const tdStyle: React.CSSProperties = { padding: '10px 8px', fontSize: '15px' };

// --- Bulk-add modal styles ---
const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(15, 23, 42, 0.55)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '40px 20px',
  zIndex: 1000,
  overflowY: 'auto',
};
const modalPanelStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: '10px',
  padding: '24px',
  width: '100%',
  maxWidth: '1400px',
  boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
  fontFamily: FONT_STACK,
};
const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: '18px',
  cursor: 'pointer',
  color: '#64748b',
};
const gridScrollStyle: React.CSSProperties = {
  overflowX: 'auto',
  border: '1px solid #93c5fd',
  borderRadius: '8px',
};
const gridTableStyle: React.CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  minWidth: '1500px',
};
const gridThStyle: React.CSSProperties = {
  background: '#1e3a8a',
  color: '#fff',
  fontSize: '12px',
  padding: '8px 6px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
};
const gridTdStyle: React.CSSProperties = {
  padding: '3px',
  borderBottom: '1px solid #dbeafe',
  borderRight: '1px solid #eff6ff',
};
const gridTdNumStyle: React.CSSProperties = {
  ...gridTdStyle,
  textAlign: 'center',
  color: '#94a3b8',
  fontSize: '12px',
  width: '30px',
};
const cellInputStyle: React.CSSProperties = {
  border: '1px solid transparent',
  padding: '6px',
  fontSize: '13px',
  width: '140px',
  borderRadius: '4px',
  fontFamily: FONT_STACK,
};
const removeRowButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#dc2626',
  cursor: 'pointer',
  fontSize: '13px',
  padding: '4px 8px',
};
const cancelModalButtonStyle: React.CSSProperties = {
  padding: '12px 18px',
  background: '#9ca3af',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '15px',
  fontFamily: FONT_STACK,
};
const resultsBoxStyle: React.CSSProperties = {
  marginTop: '14px',
  padding: '10px 14px',
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  maxHeight: '150px',
  overflowY: 'auto',
};
