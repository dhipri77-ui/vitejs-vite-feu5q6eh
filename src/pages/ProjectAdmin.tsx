import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { db, auth } from '../firebase';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

interface Project {
  id: string;
  name: string;
  code: string;
  startDate: string;
  completionDate: string;
  assumedManHours: number;
  attendanceMode: string;
  managerEmail?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
}

interface Department {
  id: string;
  name: string;
  startDate: string;
  completionDate: string;
  assumedManHours: number;
}

interface ProjectEmployee {
  id: string;
  employeeCode: string;
  name: string;
  position: string;
  salary: number;
  payType: string;
  otMultiplier: number;
  departmentId?: string;
  departmentName?: string;
  status?: string;
  leavingDate?: string;
  leavingReason?: string;
  assignedDate?: string;
}
interface Holiday {
  id: string;
  date: string;
  name: string;
}

interface Subcontractor {
  id: string;
  companyName: string;
  departmentId?: string;
  departmentName?: string;
}

// Converts a stored 'YYYY-MM-DD' date string to 'DD/MM/YYYY' for display.
// Leaves anything else (empty, already-formatted, malformed) untouched.
const formatDate = (isoDate?: string): string => {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

// Sorts a list of projectEmployees by assignedDate ascending (earliest
// joiner first). Records with no assignedDate sort last rather than
// crashing the comparison.
const sortByAssignedDate = (list: ProjectEmployee[]): ProjectEmployee[] => {
  return [...list].sort((a, b) => {
    const aDate = a.assignedDate || '9999-99-99';
    const bDate = b.assignedDate || '9999-99-99';
    return aDate.localeCompare(bDate);
  });
};

const FONT_STACK = "'Poppins', 'Segoe UI', Arial, sans-serif";

// A single row in the "Bulk Add Employees" grid. Unlike the HR master bulk
// sheet, this never creates new employee data - it only carries the two
// things this page actually needs per assignment: which HR-master code to
// pull in, and which project department to file them under. Name/position
// below are a read-only preview fetched from HR master purely so the admin
// can visually confirm the right person before saving; the actual saved
// data always comes from a fresh HR master fetch at save time (never from
// this preview), so a stale/slow preview can never cause a wrong save.
interface BulkEmpRow {
  code: string;
  deptId: string;
  // True once the admin has manually picked a department for this row -
  // same "don't let auto-suggest clobber a deliberate choice" rule as the
  // single-entry form above.
  deptTouched: boolean;
  hrName: string;
  hrPosition: string;
  lookupStatus: 'idle' | 'loading' | 'found' | 'notfound';
}

const emptyBulkEmpRow = (): BulkEmpRow => ({
  code: '',
  deptId: '',
  deptTouched: false,
  hrName: '',
  hrPosition: '',
  lookupStatus: 'idle',
});

const isBlankBulkEmpRow = (row: BulkEmpRow): boolean => !row.code.trim();

export default function ProjectAdmin() {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptName, setDeptName] = useState('');
  const [deptStart, setDeptStart] = useState('');
  const [deptCompletion, setDeptCompletion] = useState('');
  const [deptHours, setDeptHours] = useState('');

  const [projectEmployees, setProjectEmployees] = useState<ProjectEmployee[]>(
    []
  );
  const [empCode, setEmpCode] = useState('');
  const [empDeptId, setEmpDeptId] = useState('');
  // True once the admin has manually touched the department dropdown for
  // the employee code currently in the box. While false, the final
  // department on Add is resolved fresh from HR master (see
  // handleAddEmployee) instead of trusting whatever the onBlur auto-suggest
  // managed to fill in - that lookup is async and can lose a race against a
  // fast Add click or an Enter-key submit that never blurs the field.
  const [empDeptTouched, setEmpDeptTouched] = useState(false);
  const [empMsg, setEmpMsg] = useState('');
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showPastEmployeeModal, setShowPastEmployeeModal] = useState(false);
  // HR master's department for the code currently typed above, fetched on
  // blur so the dropdown can suggest it — purely a suggestion, never
  // written back to the HR record.
  const [hrDeptHint, setHrDeptHint] = useState<string | null>(null);

  // Bulk "Add Employees to Project" modal - separate state from the
  // single-entry form above, which is left completely untouched.
  const [showBulkEmpModal, setShowBulkEmpModal] = useState(false);
  const [bulkEmpRows, setBulkEmpRows] = useState<BulkEmpRow[]>([
    emptyBulkEmpRow(),
    emptyBulkEmpRow(),
    emptyBulkEmpRow(),
  ]);
  const [bulkEmpSaving, setBulkEmpSaving] = useState(false);
  const [bulkEmpResults, setBulkEmpResults] = useState<string[]>([]);
  const bulkEmpCellRefs = useRef<
    Record<string, HTMLInputElement | HTMLSelectElement | null>
  >({});
  const bulkEmpPendingFocusRef = useRef<{ row: number; col: number } | null>(
    null
  );

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');

  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [subName, setSubName] = useState('');
  const [subDeptId, setSubDeptId] = useState('');

  const [latInput, setLatInput] = useState('');
  const [lngInput, setLngInput] = useState('');
  const [radiusInput, setRadiusInput] = useState('');
  const [locationMsg, setLocationMsg] = useState('');

  const [removeTarget, setRemoveTarget] = useState<ProjectEmployee | null>(
    null
  );
  const [leavingDateInput, setLeavingDateInput] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [leavingReasonInput, setLeavingReasonInput] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user?.email) {
        setUserEmail(user.email);
        const q = query(
          collection(db, 'projects'),
          where('managerEmail', '==', user.email)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const docSnap = snapshot.docs[0];
          const proj = { id: docSnap.id, ...docSnap.data() } as Project;
          setProject(proj);
          setLatInput(proj.latitude !== undefined ? String(proj.latitude) : '');
          setLngInput(
            proj.longitude !== undefined ? String(proj.longitude) : ''
          );
          setRadiusInput(
            proj.radiusMeters !== undefined ? String(proj.radiusMeters) : ''
          );
          fetchDepartments(proj.id);
          fetchProjectEmployees(proj.id);
          fetchHolidays(proj.id);
          fetchSubcontractors(proj.id);
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Focuses a just-added bulk-add row's cell synchronously after the DOM
  // commits it, so continuous Enter-to-add-row entry never flashes focus
  // away from the grid. Same pattern as the HR master bulk sheet.
  useLayoutEffect(() => {
    if (bulkEmpPendingFocusRef.current) {
      const { row, col } = bulkEmpPendingFocusRef.current;
      bulkEmpCellRefs.current[`${row}-${col}`]?.focus();
      bulkEmpPendingFocusRef.current = null;
    }
  });

  const fetchDepartments = async (projectId: string) => {
    const q = query(
      collection(db, 'departments'),
      where('projectId', '==', projectId)
    );
    const snapshot = await getDocs(q);
    setDepartments(
      snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Department[]
    );
  };

  const fetchProjectEmployees = async (projectId: string) => {
    const q = query(
      collection(db, 'projectEmployees'),
      where('projectId', '==', projectId)
    );
    const snapshot = await getDocs(q);
    const list = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as ProjectEmployee[];
    list.sort((a, b) =>
      a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true })
    );
    setProjectEmployees(list);
  };

  const fetchHolidays = async (projectId: string) => {
    const q = query(
      collection(db, 'projectHolidays'),
      where('projectId', '==', projectId)
    );
    const snapshot = await getDocs(q);
    setHolidays(
      snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Holiday[]
    );
  };

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

  const handleAddDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !deptName || !deptStart || !deptCompletion || !deptHours)
      return;
    await addDoc(collection(db, 'departments'), {
      projectId: project.id,
      name: deptName,
      startDate: deptStart,
      completionDate: deptCompletion,
      assumedManHours: Number(deptHours),
    });
    setDeptName('');
    setDeptStart('');
    setDeptCompletion('');
    setDeptHours('');
    fetchDepartments(project.id);
  };

  const handleDeleteDepartment = async (id: string) => {
    if (!confirm('Delete this department?')) return;
    await deleteDoc(doc(db, 'departments', id));
    if (project) fetchDepartments(project.id);
  };

  // Looks up the employee code just typed against HR master and, if it has
  // a department set there, pre-selects the matching project department
  // (by name) in the dropdown below. This is only a starting suggestion —
  // the admin can change it freely per project/assignment, and nothing here
  // ever writes back to the HR master record.
  const handleEmpCodeLookup = async () => {
    setHrDeptHint(null);
    if (!empCode) return;
    const q = query(collection(db, 'employees'), where('code', '==', empCode));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return;
    const hrData = snapshot.docs[0].data();
    const hrDept = (hrData.department || '').trim();
    if (!hrDept) return;
    setHrDeptHint(hrDept);
    const match = departments.find(
      (d) => d.name.trim().toLowerCase() === hrDept.toLowerCase()
    );
    if (match) {
      setEmpDeptId(match.id);
    }
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmpMsg('');
    if (!project || !empCode) return;

    const q = query(collection(db, 'employees'), where('code', '==', empCode));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      setEmpMsg('No employee found in HR master with that code.');
      return;
    }

    // Check if this employee is already actively assigned ANYWHERE
    // (this project or any other project/department) - an employee
    // can only be in one project and one department at a time.
    const allAssignQ = query(
      collection(db, 'projectEmployees'),
      where('employeeCode', '==', empCode)
    );
    const allAssignSnap = await getDocs(allAssignQ);
    const activeElsewhere = allAssignSnap.docs
      .map((d) => d.data())
      .find((pe: any) => pe.status !== 'left');

    if (activeElsewhere) {
      if (activeElsewhere.projectId === project.id) {
        setEmpMsg('This employee is already added to this project.');
        return;
      }
      const otherProjSnap = await getDoc(
        doc(db, 'projects', activeElsewhere.projectId)
      );
      const otherProjName = otherProjSnap.exists()
        ? (otherProjSnap.data() as any).name
        : 'another project';

      if (otherProjName === 'IDLE-AWAITING') {
        // Auto-transfer: pulling someone from the Idle pool is a
        // one-step pickup, not a poach - mark their Idle record left
        // and let the add below proceed normally.
        const oldDocId = allAssignSnap.docs.find(
          (d) => d.data().projectId === activeElsewhere.projectId
        )?.id;
        if (oldDocId) {
          await updateDoc(doc(db, 'projectEmployees', oldDocId), {
            status: 'left',
            leavingDate: new Date().toISOString().split('T')[0],
            leavingReason: 'Assigned to project',
          });
        }
        // fall through - do not return, let the add proceed below
      } else {
        setEmpMsg(
          `This employee is already assigned to ${otherProjName}${
            activeElsewhere.departmentName
              ? ' (' + activeElsewhere.departmentName + ')'
              : ''
          }. Remove them from there first before adding here.`
        );
        return;
      }
    }

    const hrData = snapshot.docs[0].data();

    // Resolve the department to save. If the admin has manually picked
    // something in the dropdown, that choice always wins. Otherwise,
    // resolve it fresh from the HR master record we just fetched above,
    // rather than trusting empDeptId - the onBlur auto-suggest is async
    // (a Firestore read) and can still be in flight when Add is clicked, and
    // pressing Enter to submit can skip the blur/lookup entirely. Doing the
    // match here guarantees the department is picked up every time,
    // regardless of timing.
    let finalDeptId = empDeptId;
    let finalDeptName = departments.find((d) => d.id === empDeptId)?.name || '';
    if (!empDeptTouched) {
      const hrDept = (hrData.department || '').trim();
      const match = hrDept
        ? departments.find(
            (d) => d.name.trim().toLowerCase() === hrDept.toLowerCase()
          )
        : undefined;
      if (match) {
        finalDeptId = match.id;
        finalDeptName = match.name;
      }
    }

    await addDoc(collection(db, 'projectEmployees'), {
      projectId: project.id,
      employeeCode: hrData.code,
      name: hrData.name,
      position: hrData.position,
      salary: hrData.salary,
      payType: hrData.payType,
      otMultiplier: hrData.otMultiplier,
      departmentId: finalDeptId || '',
      departmentName: finalDeptName || '',
      assignedDate: new Date().toISOString().split('T')[0],
    });

    setEmpCode('');
    setEmpDeptId('');
    setEmpDeptTouched(false);
    setHrDeptHint(null);
    setEmpMsg('Employee added successfully.');
    fetchProjectEmployees(project.id);
  };

  // ---- Bulk Add Employees to Project ----

  const openBulkEmpModal = () => {
    setBulkEmpRows([emptyBulkEmpRow(), emptyBulkEmpRow(), emptyBulkEmpRow()]);
    setBulkEmpResults([]);
    setShowBulkEmpModal(true);
  };

  const updateBulkEmpRow = (
    index: number,
    field: 'code' | 'deptId',
    value: string
  ) => {
    setBulkEmpRows((prev) => {
      const next = [...prev];
      const row = { ...next[index] };
      if (field === 'code') {
        row.code = value;
        // A changed code invalidates whatever was previewed/suggested for
        // the old code.
        row.lookupStatus = 'idle';
        row.hrName = '';
        row.hrPosition = '';
        row.deptTouched = false;
      } else {
        row.deptId = value;
        row.deptTouched = true;
      }
      next[index] = row;
      return next;
    });
  };

  // Fetches HR master for this row's code on blur, purely to show a
  // Name/Position preview and to pre-select a matching department. The
  // actual saved department is always re-resolved fresh in
  // handleBulkEmpSave, so this being slow/async can never cause a wrong
  // save - it only affects what the admin sees before clicking Save All.
  const handleBulkEmpCodeLookup = async (rowIndex: number) => {
    const code = bulkEmpRows[rowIndex]?.code.trim();
    if (!code) return;
    setBulkEmpRows((prev) => {
      const next = [...prev];
      if (next[rowIndex])
        next[rowIndex] = { ...next[rowIndex], lookupStatus: 'loading' };
      return next;
    });
    const q = query(collection(db, 'employees'), where('code', '==', code));
    const snapshot = await getDocs(q);
    setBulkEmpRows((prev) => {
      const next = [...prev];
      const row = next[rowIndex];
      // Row may have been removed, or its code changed again, while this
      // lookup was in flight - only apply the result if it's still relevant.
      if (!row || row.code.trim() !== code) return prev;
      if (snapshot.empty) {
        next[rowIndex] = {
          ...row,
          lookupStatus: 'notfound',
          hrName: '',
          hrPosition: '',
        };
        return next;
      }
      const hrData = snapshot.docs[0].data();
      const hrDept = (hrData.department || '').trim();
      const updated: BulkEmpRow = {
        ...row,
        lookupStatus: 'found',
        hrName: hrData.name || '',
        hrPosition: hrData.position || '',
      };
      if (!row.deptTouched && hrDept) {
        const match = departments.find(
          (d) => d.name.trim().toLowerCase() === hrDept.toLowerCase()
        );
        if (match) updated.deptId = match.id;
      }
      next[rowIndex] = updated;
      return next;
    });
  };

  const addBulkEmpRow = (focusColIndex?: number) => {
    setBulkEmpRows((prev) => {
      const next = [...prev, emptyBulkEmpRow()];
      if (focusColIndex !== undefined) {
        bulkEmpPendingFocusRef.current = {
          row: next.length - 1,
          col: focusColIndex,
        };
      }
      return next;
    });
  };

  const removeBulkEmpRow = (index: number) => {
    setBulkEmpRows((prev) => prev.filter((_, i) => i !== index));
  };

  const focusBulkEmpCell = (rowIndex: number, colIndex: number) => {
    bulkEmpCellRefs.current[`${rowIndex}-${colIndex}`]?.focus();
  };

  // Spreadsheet-style navigation across the grid's two editable columns
  // (0 = Employee Code, 1 = Department). Enter on the last row creates a
  // new row and moves into it, same continuous-entry behavior as the HR
  // master bulk sheet - no separate "Add Row" button.
  const handleBulkEmpCellKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    rowIndex: number,
    colIndex: number
  ) => {
    const lastRow = bulkEmpRows.length - 1;
    const lastCol = 1;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (rowIndex === lastRow) {
        addBulkEmpRow(colIndex);
      } else {
        focusBulkEmpCell(rowIndex + 1, colIndex);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rowIndex < lastRow) focusBulkEmpCell(rowIndex + 1, colIndex);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rowIndex > 0) focusBulkEmpCell(rowIndex - 1, colIndex);
      return;
    }

    if (colIndex === 0) {
      // Employee Code is a plain text input - only jump cells once the
      // caret is at the boundary, so normal left/right editing still works.
      const input = e.currentTarget as HTMLInputElement;
      const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
      const atEnd =
        input.selectionStart === input.value.length &&
        input.selectionEnd === input.value.length;
      if (e.key === 'ArrowRight' && atEnd) {
        e.preventDefault();
        focusBulkEmpCell(rowIndex, colIndex + 1);
      } else if (e.key === 'ArrowLeft' && atStart && colIndex > 0) {
        e.preventDefault();
        focusBulkEmpCell(rowIndex, colIndex - 1);
      }
    } else {
      // Department <select> - arrow keys always jump cells immediately
      // (a select has no caret/boundary concept).
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        focusBulkEmpCell(rowIndex, colIndex - 1);
      } else if (e.key === 'ArrowRight' && colIndex < lastCol) {
        e.preventDefault();
      }
    }
  };

  const handleBulkEmpSave = async () => {
    if (!project) return;
    setBulkEmpSaving(true);
    const results: string[] = [];
    const remainingRows: BulkEmpRow[] = [];

    for (const row of bulkEmpRows) {
      if (isBlankBulkEmpRow(row)) continue;
      const code = row.code.trim();

      const q = query(collection(db, 'employees'), where('code', '==', code));
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        results.push(`${code}: No employee found in HR master with that code.`);
        remainingRows.push(row);
        continue;
      }

      // Same one-active-assignment-at-a-time enforcement as the single-add
      // form, including the Idle-pool auto-pickup transfer. Rows are
      // processed one at a time (awaited in sequence) so a duplicate code
      // appearing twice in the same batch is caught here too, exactly like
      // it would be if added one by one.
      const allAssignQ = query(
        collection(db, 'projectEmployees'),
        where('employeeCode', '==', code)
      );
      const allAssignSnap = await getDocs(allAssignQ);
      const activeElsewhere = allAssignSnap.docs
        .map((d) => d.data())
        .find((pe: any) => pe.status !== 'left');

      let skip = false;
      if (activeElsewhere) {
        if (activeElsewhere.projectId === project.id) {
          results.push(`${code}: Already added to this project.`);
          remainingRows.push(row);
          skip = true;
        } else {
          const otherProjSnap = await getDoc(
            doc(db, 'projects', activeElsewhere.projectId)
          );
          const otherProjName = otherProjSnap.exists()
            ? (otherProjSnap.data() as any).name
            : 'another project';

          if (otherProjName === 'IDLE-AWAITING') {
            const oldDocId = allAssignSnap.docs.find(
              (d) => d.data().projectId === activeElsewhere.projectId
            )?.id;
            if (oldDocId) {
              await updateDoc(doc(db, 'projectEmployees', oldDocId), {
                status: 'left',
                leavingDate: new Date().toISOString().split('T')[0],
                leavingReason: 'Assigned to project',
              });
            }
            // fall through - proceed to add below
          } else {
            results.push(
              `${code}: Already assigned to ${otherProjName}${
                activeElsewhere.departmentName
                  ? ' (' + activeElsewhere.departmentName + ')'
                  : ''
              }. Remove from there first.`
            );
            remainingRows.push(row);
            skip = true;
          }
        }
      }
      if (skip) continue;

      const hrData = snapshot.docs[0].data();

      // Resolve the department fresh from this row's HR master fetch,
      // exactly like the single-add form - never trust an async preview
      // lookup that may not have finished in time.
      let finalDeptId = row.deptId;
      let finalDeptName =
        departments.find((d) => d.id === row.deptId)?.name || '';
      if (!row.deptTouched) {
        const hrDept = (hrData.department || '').trim();
        const match = hrDept
          ? departments.find(
              (d) => d.name.trim().toLowerCase() === hrDept.toLowerCase()
            )
          : undefined;
        if (match) {
          finalDeptId = match.id;
          finalDeptName = match.name;
        }
      }

      await addDoc(collection(db, 'projectEmployees'), {
        projectId: project.id,
        employeeCode: hrData.code,
        name: hrData.name,
        position: hrData.position,
        salary: hrData.salary,
        payType: hrData.payType,
        otMultiplier: hrData.otMultiplier,
        departmentId: finalDeptId || '',
        departmentName: finalDeptName || '',
        assignedDate: new Date().toISOString().split('T')[0],
      });
      results.push(`${code} (${hrData.name}): Added successfully.`);
    }

    setBulkEmpResults(results);
    setBulkEmpRows(
      remainingRows.length > 0
        ? remainingRows
        : [emptyBulkEmpRow(), emptyBulkEmpRow(), emptyBulkEmpRow()]
    );
    setBulkEmpSaving(false);
    fetchProjectEmployees(project.id);
  };

  const openRemoveDialog = (pe: ProjectEmployee) => {
    setRemoveTarget(pe);
    setLeavingDateInput(new Date().toISOString().split('T')[0]);
    setLeavingReasonInput('');
  };

  const handleConfirmRemove = async () => {
    if (!removeTarget || !project) return;
    await updateDoc(doc(db, 'projectEmployees', removeTarget.id), {
      status: 'left',
      leavingDate: leavingDateInput,
      leavingReason: leavingReasonInput,
    });

    // Auto-add to the Idle pool, unless this removal IS from the Idle
    // pool itself (e.g. they resigned entirely, not moving to another project)
    if (project.name !== 'IDLE-AWAITING') {
      const idleQ = query(
        collection(db, 'projects'),
        where('name', '==', 'IDLE-AWAITING')
      );
      const idleSnap = await getDocs(idleQ);
      if (!idleSnap.empty) {
        const idleProjectId = idleSnap.docs[0].id;
        await addDoc(collection(db, 'projectEmployees'), {
          projectId: idleProjectId,
          employeeCode: removeTarget.employeeCode,
          name: removeTarget.name,
          position: removeTarget.position,
          salary: removeTarget.salary,
          payType: removeTarget.payType,
          otMultiplier: removeTarget.otMultiplier,
          departmentId: '',
          departmentName: '',
          assignedDate: new Date().toISOString().split('T')[0],
        });
      }
    }

    setRemoveTarget(null);
    fetchProjectEmployees(project.id);
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !holidayDate || !holidayName) return;
    await addDoc(collection(db, 'projectHolidays'), {
      projectId: project.id,
      date: holidayDate,
      name: holidayName,
    });
    setHolidayDate('');
    setHolidayName('');
    fetchHolidays(project.id);
  };

  const handleDeleteHoliday = async (id: string) => {
    if (!confirm('Delete this holiday?')) return;
    await deleteDoc(doc(db, 'projectHolidays', id));
    if (project) fetchHolidays(project.id);
  };

  const handleSaveLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocationMsg('');
    if (!project || !latInput || !lngInput || !radiusInput) {
      setLocationMsg('Please fill in latitude, longitude, and radius.');
      return;
    }
    await updateDoc(doc(db, 'projects', project.id), {
      latitude: Number(latInput),
      longitude: Number(lngInput),
      radiusMeters: Number(radiusInput),
    });
    setProject({
      ...project,
      latitude: Number(latInput),
      longitude: Number(lngInput),
      radiusMeters: Number(radiusInput),
    });
    setLocationMsg('Location and radius saved successfully.');
  };

  const handleAddSubcontractor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !subName) return;
    if (!subDeptId) {
      alert('Please select a department for this subcontractor.');
      return;
    }
    const selectedDept = departments.find((d) => d.id === subDeptId);
    await addDoc(collection(db, 'subcontractors'), {
      projectId: project.id,
      companyName: subName,
      departmentId: subDeptId || '',
      departmentName: selectedDept?.name || '',
    });
    setSubName('');
    setSubDeptId('');
    fetchSubcontractors(project.id);
  };

  const handleDeleteSubcontractor = async (id: string) => {
    if (!confirm('Delete this subcontractor?')) return;
    await deleteDoc(doc(db, 'subcontractors', id));
    if (project) fetchSubcontractors(project.id);
  };

  const activeEmployees = projectEmployees.filter((pe) => pe.status !== 'left');
  const pastEmployees = projectEmployees.filter((pe) => pe.status === 'left');
  const activeEmployeesSorted = sortByAssignedDate(activeEmployees);
  const pastEmployeesSorted = sortByAssignedDate(pastEmployees);

  // Departments overview panel: employee count per department.
  const departmentCounts = departments.map((d) => ({
    ...d,
    count: activeEmployees.filter((pe) => pe.departmentId === d.id).length,
  }));

  // Position overview panel: count per position (names no longer shown).
  const positionGroups: { [position: string]: number } = {};
  activeEmployees.forEach((pe) => {
    const pos = pe.position || 'Unspecified';
    positionGroups[pos] = (positionGroups[pos] || 0) + 1;
  });

  const hrDeptHasMatch =
    hrDeptHint !== null &&
    departments.some(
      (d) => d.name.trim().toLowerCase() === hrDeptHint.toLowerCase()
    );

  if (loading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }

  if (!project) {
    return (
      <div style={{ padding: '40px', fontFamily: FONT_STACK }}>
        <h1>Project & Admin</h1>
        <p style={{ color: '#dc2626' }}>
          No project is assigned to your account ({userEmail}). Please contact
          the admin.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '40px',
        fontFamily: FONT_STACK,
        maxWidth: '1100px',
      }}
    >
      <div style={{ paddingRight: '170px' }}>
        <h1 style={companyBannerStyle}>Airmech W.L.L</h1>
        <h1 style={projectTitleStyle}>{project.name}</h1>
        <p style={pageSubtitleStyle}>Project & Admin</p>
      </div>

      <div style={greenBannerStyle}>
        Total Employees Today: {activeEmployees.length}
      </div>

      {/* ADD DEPARTMENT */}
      <h3 style={sectionTitleStyle}>Add Department</h3>
      <div style={rowFlexStyle}>
        <div style={formColStyle}>
          <form
            onSubmit={handleAddDepartment}
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            <input
              placeholder="Department Name"
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              style={inputStyle}
            />
            <label style={labelStyle}>Start Date</label>
            <input
              type="date"
              value={deptStart}
              onChange={(e) => setDeptStart(e.target.value)}
              style={inputStyle}
            />
            <label style={labelStyle}>Completion Date</label>
            <input
              type="date"
              value={deptCompletion}
              onChange={(e) => setDeptCompletion(e.target.value)}
              style={inputStyle}
            />
            <input
              placeholder="Assumed Man Hours"
              type="number"
              value={deptHours}
              onChange={(e) => setDeptHours(e.target.value)}
              style={inputStyle}
            />
            <button type="submit" style={sectionButtonStyle}>
              Add Department
            </button>
          </form>
        </div>
        <div style={panelColStyle}>
          <div style={bluePanelStyle}>
            <p style={panelTitleStyle}>Departments Overview</p>
            {departmentCounts.length === 0 ? (
              <p style={panelEmptyStyle}>No departments yet.</p>
            ) : (
              departmentCounts.map((d) => (
                <div key={d.id} style={panelRowStyle}>
                  <span>{d.name}</span>
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>{d.count}</span>
                    <button
                      onClick={() => handleDeleteDepartment(d.id)}
                      style={deleteIconButtonStyle}
                      title="Delete department"
                    >
                      ×
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ADD EMPLOYEE TO PROJECT */}
      <h3 style={sectionTitleStyle}>Add Employee to Project</h3>
      <div style={rowFlexStyle}>
        <div style={formColStyle}>
          <button
            type="button"
            onClick={openBulkEmpModal}
            style={{ ...bulkAddButtonStyle, marginBottom: '10px' }}
          >
            📋 Bulk Add Employees to Project
          </button>
          <form
            onSubmit={handleAddEmployee}
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            <input
              placeholder="Employee Code"
              value={empCode}
              onChange={(e) => {
                setEmpCode(e.target.value);
                setHrDeptHint(null);
                setEmpDeptTouched(false);
              }}
              onBlur={handleEmpCodeLookup}
              style={inputStyle}
            />
            <select
              value={empDeptId}
              onChange={(e) => {
                setEmpDeptId(e.target.value);
                setEmpDeptTouched(true);
              }}
              style={inputStyle}
            >
              <option value="">-- No Department --</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {hrDeptHint && (
              <p style={hintTextStyle}>
                HR master department: <strong>{hrDeptHint}</strong>
                {!hrDeptHasMatch &&
                  ' — no matching project department yet, select one manually or add it above.'}
              </p>
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" style={{ ...sectionButtonStyle, flex: 1 }}>
                Add
              </button>
              <button
                type="button"
                onClick={() => setShowEmployeeModal(true)}
                style={viewIconButtonStyle}
                title="View Employees"
              >
                👁 View
              </button>
            </div>
          </form>
          {empMsg && (
            <p
              style={{
                fontSize: '13px',
                color: empMsg.includes('success') ? '#16a34a' : '#dc2626',
                fontFamily: FONT_STACK,
              }}
            >
              {empMsg}
            </p>
          )}
        </div>
        <div style={panelColStyle}>
          <div style={bluePanelStyle}>
            <p style={panelTitleStyle}>Employees by Position</p>
            {Object.keys(positionGroups).length === 0 ? (
              <p style={panelEmptyStyle}>No employees yet.</p>
            ) : (
              Object.entries(positionGroups).map(([pos, count]) => (
                <div key={pos} style={panelRowStyle}>
                  <span>{pos}</span>
                  <span style={{ fontWeight: 700 }}>{count}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showBulkEmpModal && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalBoxStyle, width: '860px', overflowX: 'auto' }}>
            <div style={modalHeaderStyle}>
              <h3 style={{ margin: 0 }}>
                Bulk Add Employees to {project.name}
              </h3>
              <button
                onClick={() => setShowBulkEmpModal(false)}
                style={{ ...sectionButtonStyle, padding: '6px 12px' }}
              >
                Close
              </button>
            </div>
            <p style={{ fontSize: '13px', color: '#666', marginTop: 0 }}>
              Enter Employee Codes from HR master below - name, position, salary
              etc. are pulled in automatically, just like the single Add form.
              Department is optional and auto-suggested from HR master; change
              it per row if this employee is working under a different
              department for this project. Press Enter on the last row to add
              another.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}
                >
                  <th style={thStyle}>Employee Code</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Position</th>
                  <th style={thStyle}>Department</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {bulkEmpRows.map((row, rowIndex) => (
                  <tr key={rowIndex} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={tdStyle}>
                      <input
                        ref={(el) => {
                          bulkEmpCellRefs.current[`${rowIndex}-0`] = el;
                        }}
                        value={row.code}
                        onChange={(e) =>
                          updateBulkEmpRow(rowIndex, 'code', e.target.value)
                        }
                        onBlur={() => handleBulkEmpCodeLookup(rowIndex)}
                        onKeyDown={(e) =>
                          handleBulkEmpCellKeyDown(e, rowIndex, 0)
                        }
                        style={{ ...inputStyle, width: '110px' }}
                      />
                    </td>
                    <td style={tdStyle}>
                      {row.lookupStatus === 'loading' && (
                        <span style={{ color: '#999', fontSize: '13px' }}>
                          Looking up...
                        </span>
                      )}
                      {row.lookupStatus === 'notfound' && (
                        <span style={{ color: '#dc2626', fontSize: '13px' }}>
                          Not found in HR master
                        </span>
                      )}
                      {row.lookupStatus === 'found' && (
                        <span style={{ fontSize: '13px' }}>{row.hrName}</span>
                      )}
                      {row.lookupStatus === 'idle' && (
                        <span style={{ color: '#999', fontSize: '13px' }}>
                          —
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: '13px' }}>
                        {row.lookupStatus === 'found' ? row.hrPosition : '—'}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <select
                        ref={(el) => {
                          bulkEmpCellRefs.current[`${rowIndex}-1`] = el;
                        }}
                        value={row.deptId}
                        onChange={(e) =>
                          updateBulkEmpRow(rowIndex, 'deptId', e.target.value)
                        }
                        onKeyDown={(e) =>
                          handleBulkEmpCellKeyDown(e, rowIndex, 1)
                        }
                        style={{ ...inputStyle, width: '150px' }}
                      >
                        <option value="">-- No Department --</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <button
                        type="button"
                        onClick={() => removeBulkEmpRow(rowIndex)}
                        style={deleteIconButtonStyle}
                        title="Remove row"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
              <button
                type="button"
                onClick={handleBulkEmpSave}
                disabled={bulkEmpSaving}
                style={{ ...sectionButtonStyle, flex: 1 }}
              >
                {bulkEmpSaving ? 'Saving...' : 'Save All'}
              </button>
              <button
                type="button"
                onClick={() => setShowBulkEmpModal(false)}
                style={{
                  ...sectionButtonStyle,
                  flex: 1,
                  background: '#e0f2fe',
                  color: '#0c4a6e',
                }}
              >
                Close
              </button>
            </div>
            {bulkEmpResults.length > 0 && (
              <div style={{ marginTop: '15px' }}>
                {bulkEmpResults.map((r, i) => (
                  <p
                    key={i}
                    style={{
                      fontSize: '13px',
                      margin: '4px 0',
                      color: r.includes('successfully') ? '#16a34a' : '#dc2626',
                      fontFamily: FONT_STACK,
                    }}
                  >
                    {r}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showEmployeeModal && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalBoxStyle, width: '660px' }}>
            <div style={modalHeaderStyle}>
              <h3 style={{ margin: 0 }}>Active Employees on {project.name}</h3>
              <button
                onClick={() => setShowEmployeeModal(false)}
                style={{ ...sectionButtonStyle, padding: '6px 12px' }}
              >
                Close
              </button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}
                >
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Position</th>
                  <th style={thStyle}>Department</th>
                  <th style={thStyle}>Joining Date</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {activeEmployeesSorted.map((pe) => (
                  <tr key={pe.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={tdStyle}>{pe.employeeCode}</td>
                    <td style={tdStyle}>{pe.name}</td>
                    <td style={tdStyle}>{pe.position}</td>
                    <td style={tdStyle}>{pe.departmentName || '—'}</td>
                    <td style={tdStyle}>{formatDate(pe.assignedDate)}</td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => {
                          setShowEmployeeModal(false);
                          openRemoveDialog(pe);
                        }}
                        style={deleteButtonStyle}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {removeTarget && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalBoxStyle, width: '360px' }}>
            <h3 style={{ marginTop: 0 }}>
              Remove {removeTarget.name} ({removeTarget.employeeCode})?
            </h3>
            <p style={{ fontSize: '13px', color: '#666' }}>
              This does not remove them from HR master. Their attendance and
              payslip history will be preserved.
            </p>
            <label style={labelStyle}>Leaving Date</label>
            <input
              type="date"
              value={leavingDateInput}
              onChange={(e) => setLeavingDateInput(e.target.value)}
              style={{ ...inputStyle, width: '100%', marginBottom: '10px' }}
            />
            <label style={labelStyle}>Reason (optional)</label>
            <input
              placeholder="e.g. resigned, project transfer"
              value={leavingReasonInput}
              onChange={(e) => setLeavingReasonInput(e.target.value)}
              style={{ ...inputStyle, width: '100%', marginBottom: '15px' }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={handleConfirmRemove} style={deleteButtonStyle}>
                Confirm Remove
              </button>
              <button
                onClick={() => setRemoveTarget(null)}
                style={{
                  ...sectionButtonStyle,
                  background: '#e0f2fe',
                  color: '#0c4a6e',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pastEmployees.length > 0 && (
        <>
          <h3 style={sectionTitleStyle}>Past Employees</h3>
          <div style={{ marginTop: '15px' }}>
            <button
              type="button"
              onClick={() => setShowPastEmployeeModal(true)}
              style={viewIconButtonStyle}
              title="View Past Employees"
            >
              👁 View Past Employees ({pastEmployees.length})
            </button>
          </div>
        </>
      )}

      {showPastEmployeeModal && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalBoxStyle, width: '720px' }}>
            <div style={modalHeaderStyle}>
              <h3 style={{ margin: 0 }}>Past Employees on {project.name}</h3>
              <button
                onClick={() => setShowPastEmployeeModal(false)}
                style={{ ...sectionButtonStyle, padding: '6px 12px' }}
              >
                Close
              </button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}
                >
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Department</th>
                  <th style={thStyle}>Joining Date</th>
                  <th style={thStyle}>Leaving Date</th>
                  <th style={thStyle}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {pastEmployeesSorted.map((pe) => (
                  <tr key={pe.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={tdStyle}>{pe.employeeCode}</td>
                    <td style={tdStyle}>{pe.name}</td>
                    <td style={tdStyle}>{pe.departmentName || '—'}</td>
                    <td style={tdStyle}>{formatDate(pe.assignedDate)}</td>
                    <td style={tdStyle}>{formatDate(pe.leavingDate)}</td>
                    <td style={tdStyle}>{pe.leavingReason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* LOCATION & GEOFENCE */}
      <h3 style={sectionTitleStyle}>Location & Geofence</h3>
      <p style={{ fontSize: '13px', color: '#666', marginTop: '10px' }}>
        Used for geofence-based attendance. Get coordinates by opening Google
        Maps in a browser, right-clicking your project location, and copying the
        latitude/longitude shown.
      </p>
      <div style={rowFlexStyle}>
        <div style={formColStyle}>
          <form
            onSubmit={handleSaveLocation}
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            <label style={labelStyle}>Latitude</label>
            <input
              placeholder="e.g. 26.2172"
              type="number"
              step="any"
              value={latInput}
              onChange={(e) => setLatInput(e.target.value)}
              style={inputStyle}
            />
            <label style={labelStyle}>Longitude</label>
            <input
              placeholder="e.g. 50.5350"
              type="number"
              step="any"
              value={lngInput}
              onChange={(e) => setLngInput(e.target.value)}
              style={inputStyle}
            />
            <label style={labelStyle}>Radius (meters)</label>
            <input
              placeholder="e.g. 200"
              type="number"
              value={radiusInput}
              onChange={(e) => setRadiusInput(e.target.value)}
              style={inputStyle}
            />
            <button type="submit" style={sectionButtonStyle}>
              Save Location
            </button>
          </form>
          {locationMsg && (
            <p
              style={{
                fontSize: '13px',
                color: locationMsg.includes('success') ? '#16a34a' : '#dc2626',
                fontFamily: FONT_STACK,
              }}
            >
              {locationMsg}
            </p>
          )}
        </div>
        <div style={panelColStyle}>
          <div style={bluePanelStyle}>
            <p style={panelTitleStyle}>Current Saved Location</p>
            {project.latitude !== undefined &&
            project.longitude !== undefined &&
            project.radiusMeters !== undefined ? (
              <>
                <div style={panelRowStyle}>
                  <span>Latitude</span>
                  <span style={{ fontWeight: 700 }}>{project.latitude}</span>
                </div>
                <div style={panelRowStyle}>
                  <span>Longitude</span>
                  <span style={{ fontWeight: 700 }}>{project.longitude}</span>
                </div>
                <div style={panelRowStyle}>
                  <span>Radius (m)</span>
                  <span style={{ fontWeight: 700 }}>
                    {project.radiusMeters}
                  </span>
                </div>
              </>
            ) : (
              <p style={panelEmptyStyle}>No location saved yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* SUBCONTRACTORS */}
      <h3 style={sectionTitleStyle}>Subcontractors</h3>
      <div style={rowFlexStyle}>
        <div style={formColStyle}>
          <form
            onSubmit={handleAddSubcontractor}
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            <input
              placeholder="Subcontractor Company Name"
              value={subName}
              onChange={(e) => setSubName(e.target.value)}
              style={inputStyle}
            />
            <select
              value={subDeptId}
              onChange={(e) => setSubDeptId(e.target.value)}
              style={inputStyle}
            >
              <option value="">-- Select Department (required) --</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button type="submit" style={sectionButtonStyle}>
              Add Subcontractor
            </button>
          </form>
        </div>
        <div style={panelColStyle}>
          <div style={bluePanelStyle}>
            <p style={panelTitleStyle}>Subcontractors</p>
            {subcontractors.length === 0 ? (
              <p style={panelEmptyStyle}>None added yet.</p>
            ) : (
              subcontractors.map((s) => (
                <div key={s.id} style={panelRowStyle}>
                  <span>
                    {s.companyName}
                    {s.departmentName ? ` — ${s.departmentName}` : ''}
                  </span>
                  <button
                    onClick={() => handleDeleteSubcontractor(s.id)}
                    style={deleteIconButtonStyle}
                    title="Delete subcontractor"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* PROJECT-SPECIFIC HOLIDAYS */}
      <h3 style={sectionTitleStyle}>Project-Specific Holidays</h3>
      <div style={rowFlexStyle}>
        <div style={formColStyle}>
          <form
            onSubmit={handleAddHoliday}
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            <label style={labelStyle}>Date</label>
            <input
              type="date"
              value={holidayDate}
              onChange={(e) => setHolidayDate(e.target.value)}
              style={inputStyle}
            />
            <input
              placeholder="Holiday Name"
              value={holidayName}
              onChange={(e) => setHolidayName(e.target.value)}
              style={inputStyle}
            />
            <button type="submit" style={sectionButtonStyle}>
              Add Holiday
            </button>
          </form>
        </div>
        <div style={panelColStyle}>
          <div style={bluePanelStyle}>
            <p style={panelTitleStyle}>Project Holidays</p>
            {holidays.length === 0 ? (
              <p style={panelEmptyStyle}>None added yet.</p>
            ) : (
              holidays.map((h) => (
                <div key={h.id} style={panelRowStyle}>
                  <span>
                    {formatDate(h.date)} — {h.name}
                  </span>
                  <button
                    onClick={() => handleDeleteHoliday(h.id)}
                    style={deleteIconButtonStyle}
                    title="Delete holiday"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const companyBannerStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '46px',
  fontWeight: 900,
  color: '#0d9488',
  letterSpacing: '0.5px',
  margin: '0 0 16px',
};
const pageSubtitleStyle: React.CSSProperties = {
  margin: '0 0 10px',
  padding: 0,
  background: 'none',
  color: '#d4af37',
  fontFamily: FONT_STACK,
  fontSize: '16px',
  fontWeight: 600,
};
const projectTitleStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '32px',
  fontWeight: 800,
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
const greenBannerStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  marginTop: '30px',
  display: 'inline-block',
  background: '#dcfce7',
  border: '1px solid #86efac',
  borderRadius: '10px',
  padding: '12px 20px',
  color: '#166534',
  fontWeight: 700,
  fontSize: '16px',
};
const rowFlexStyle: React.CSSProperties = {
  display: 'flex',
  gap: '24px',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  marginTop: '15px',
};
const formColStyle: React.CSSProperties = {
  flex: '0 0 360px',
  minWidth: '300px',
};
const panelColStyle: React.CSSProperties = {
  flex: '1 1 260px',
  minWidth: '240px',
};
const bluePanelStyle: React.CSSProperties = {
  background: '#dbeafe',
  border: '1px solid #93c5fd',
  borderRadius: '10px',
  padding: '16px 18px',
};
const panelTitleStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  margin: '0 0 10px',
  fontSize: '16px',
  fontWeight: 700,
  color: '#1e3a8a',
};
const panelRowStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 0',
  borderBottom: '1px solid #93c5fd',
  fontSize: '13px',
  color: '#1e40af',
};
const panelEmptyStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '13px',
  color: '#1e40af',
  margin: 0,
};
const hintTextStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '12px',
  color: '#1e3a8a',
  margin: '-4px 0 0',
};
const deleteIconButtonStyle: React.CSSProperties = {
  width: '20px',
  height: '20px',
  borderRadius: '50%',
  background: '#dc2626',
  color: '#ffffff',
  border: 'none',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 700,
  lineHeight: '20px',
  textAlign: 'center',
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const bulkAddButtonStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  width: '100%',
  padding: '12px 16px',
  background: '#1e3a8a',
  color: '#ffffff',
  border: '1px solid #1e3a8a',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '14px',
};
const viewIconButtonStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  padding: '14px 16px',
  background: '#dbeafe',
  color: '#1e3a8a',
  border: '1px solid #93c5fd',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};
const sectionButtonStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  width: '100%',
  padding: '14px 18px',
  background: '#bfdbfe',
  color: '#1e3a8a',
  border: '1px solid #93c5fd',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '16px',
};
const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const modalBoxStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  background: '#fff',
  padding: '24px',
  borderRadius: '10px',
  maxHeight: '80vh',
  overflowY: 'auto',
};
const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '15px',
};
const labelStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '14px',
};
const inputStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  padding: '8px',
  borderRadius: '6px',
  border: '1px solid #ccc',
  fontSize: '14px',
};
const deleteButtonStyle: React.CSSProperties = {
  fontFamily: FONT_STACK,
  padding: '5px 10px',
  background: '#dc2626',
  color: '#fff',
  border: 'none',
  borderRadius: '5px',
  cursor: 'pointer',
  fontSize: '12px',
};
const thStyle: React.CSSProperties = { fontFamily: FONT_STACK, padding: '8px' };
const tdStyle: React.CSSProperties = { fontFamily: FONT_STACK, padding: '8px' };
