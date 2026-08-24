import { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  arrayUnion,
} from 'firebase/firestore';
import emailjs from '@emailjs/browser';
import {
  EMAILJS_SERVICE_ID,
  EMAILJS_TEMPLATE_ID,
  EMAILJS_PUBLIC_KEY,
} from '../emailConfig';
import { Link } from 'react-router-dom';
import { useAccessGuard } from '../lib/useAccessGuard';

interface Project {
  id: string;
  name: string;
}

interface ProjectEmployee {
  employeeCode: string;
  name: string;
  salary: number;
  payType: string;
  otMultiplier: number;
  departmentName?: string;
  status?: string;
}

interface PayslipRow {
  code: string;
  name: string;
  email: string;
  department: string;
  position: string;
  daysPresent: number;
  basicHours: number;
  otHours: number;
  hourlyRate: number;
  basicPay: number;
  otPay: number;
  totalPay: number;
  approved: boolean;
  dataChangedSinceApproval: boolean;
}

interface VerifyResult {
  warnings: string[];
  blockingIssues: string[];
  checkedAt: string;
}

// Converts a stored 'YYYY-MM-DD' date string to 'DD/MM/YYYY' for display.
const formatDate = (isoDate?: string): string => {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

const getMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
};

export default function MasterSalaryPayslip() {
  const { loading: accessLoading, allowed } = useAccessGuard([
    'master',
    'accountant',
  ]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyName] = useState('Airmech');
  const [rangeStart, setRangeStart] = useState(getMonthRange().start);
  const [rangeEnd, setRangeEnd] = useState(getMonthRange().end);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(
    null
  );
  const [rowsByProject, setRowsByProject] = useState<{
    [pid: string]: PayslipRow[];
  }>({});
  const [fetchingProjectId, setFetchingProjectId] = useState<string | null>(
    null
  );
  const [sendingCode, setSendingCode] = useState<string | null>(null);
  const [sendingAllProjectId, setSendingAllProjectId] = useState<string | null>(
    null
  );
  const [approvingProjectId, setApprovingProjectId] = useState<string | null>(
    null
  );
  const [verifyResults, setVerifyResults] = useState<{
    [pid: string]: VerifyResult;
  }>({});
  const [verifyingProjectId, setVerifyingProjectId] = useState<string | null>(
    null
  );

  useEffect(() => {
    const loadProjects = async () => {
      const snap = await getDocs(collection(db, 'projects'));
      const all = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Project))
        .sort((a, b) => {
          // Keep Idle Pool pinned to the end of the list, real projects
          // sorted alphabetically above it.
          if (a.name === 'IDLE-AWAITING') return 1;
          if (b.name === 'IDLE-AWAITING') return -1;
          return a.name.localeCompare(b.name);
        });
      setProjects(all);
      setLoading(false);
    };
    loadProjects();
  }, []);

  // Same combined-timeline logic as SalaryPayslip.tsx (cross-project
  // assignment history, holiday-fill, prorated Idle Pool pay) - just
  // parameterized by an explicit projectId instead of one derived from
  // managerEmail, so it can run once per project block.
  const generatePayslipsForProject = async (projectId: string) => {
    setFetchingProjectId(projectId);

    const empQ = query(
      collection(db, 'projectEmployees'),
      where('projectId', '==', projectId)
    );
    const empSnap = await getDocs(empQ);
    const allEmp = empSnap.docs.map((d) => d.data()) as ProjectEmployee[];
    const dedupMap: { [code: string]: ProjectEmployee } = {};
    allEmp.forEach((e: any) => {
      if (e.status === 'left') return;
      dedupMap[e.employeeCode] = e;
    });
    const employees = Object.values(dedupMap);
    const codes = employees.map((e) => e.employeeCode);

    if (codes.length === 0) {
      setRowsByProject((prev) => ({ ...prev, [projectId]: [] }));
      setFetchingProjectId(null);
      return;
    }

    const allRecords: any[] = [];
    for (let i = 0; i < codes.length; i += 30) {
      const batch = codes.slice(i, i + 30);
      const histQ = query(
        collection(db, 'projectEmployees'),
        where('employeeCode', 'in', batch)
      );
      const histSnap = await getDocs(histQ);
      histSnap.docs.forEach((d) => allRecords.push(d.data()));
    }

    const allProjSnap = await getDocs(collection(db, 'projects'));
    const projectNameById: { [id: string]: string } = {};
    allProjSnap.docs.forEach((d) => {
      projectNameById[d.id] = (d.data() as any).name;
    });

    const timelines: {
      [code: string]: { projectId: string; start: string; end: string }[];
    } = {};
    codes.forEach((code) => {
      const recs = allRecords
        .filter((r) => r.employeeCode === code)
        .map((r) => ({ ...r, assignedDate: r.assignedDate || '2000-01-01' }))
        .sort((a, b) => a.assignedDate.localeCompare(b.assignedDate));
      timelines[code] = recs.map((r) => ({
        projectId: r.projectId,
        start: r.assignedDate,
        end: r.leavingDate || rangeEnd,
      }));
    });

    const employeeSegments: {
      [code: string]: { projectId: string; segStart: string; segEnd: string }[];
    } = {};
    codes.forEach((code) => {
      const segs: { projectId: string; segStart: string; segEnd: string }[] =
        [];
      timelines[code].forEach((entry) => {
        const segStart = entry.start > rangeStart ? entry.start : rangeStart;
        const segEnd = entry.end < rangeEnd ? entry.end : rangeEnd;
        if (segStart <= segEnd) {
          segs.push({ projectId: entry.projectId, segStart, segEnd });
        }
      });
      employeeSegments[code] = segs;
    });

    const realProjectIds = Array.from(
      new Set(
        Object.values(employeeSegments)
          .flat()
          .map((s) => s.projectId)
          .filter((pid) => projectNameById[pid] !== 'IDLE-AWAITING')
      )
    );

    const attendanceByProject: { [pid: string]: any[] } = {};
    const holidayDatesByProject: { [pid: string]: Set<string> } = {};

    for (const pid of realProjectIds) {
      const attQ = query(
        collection(db, 'attendance'),
        where('projectId', '==', pid),
        where('date', '>=', rangeStart),
        where('date', '<=', rangeEnd)
      );
      const attSnap = await getDocs(attQ);
      attendanceByProject[pid] = attSnap.docs.map((d) => d.data());

      const holSet = new Set<string>();
      const companyHolQ = query(
        collection(db, 'companyHolidays'),
        where('date', '>=', rangeStart),
        where('date', '<=', rangeEnd)
      );
      const companyHolSnap = await getDocs(companyHolQ);
      companyHolSnap.docs.forEach((d) => holSet.add((d.data() as any).date));

      const projHolQ = query(
        collection(db, 'projectHolidays'),
        where('projectId', '==', pid),
        where('date', '>=', rangeStart),
        where('date', '<=', rangeEnd)
      );
      const projHolSnap = await getDocs(projHolQ);
      projHolSnap.docs.forEach((d) => holSet.add((d.data() as any).date));

      holidayDatesByProject[pid] = holSet;
    }

    const hrMap: { [code: string]: { email: string; position: string } } = {};
    await Promise.all(
      employees.map(async (emp) => {
        const hrQ = query(
          collection(db, 'employees'),
          where('code', '==', emp.employeeCode)
        );
        const hrSnap = await getDocs(hrQ);
        if (!hrSnap.empty) {
          const hrData = hrSnap.docs[0].data();
          hrMap[emp.employeeCode] = {
            email: hrData.email || '',
            position: hrData.position || 'Unspecified',
          };
        }
      })
    );

    const result: PayslipRow[] = [];
    for (const emp of employees) {
      const code = emp.employeeCode;
      const hourlyRate = emp.salary / 30 / 8;
      const otMultiplier =
        emp.payType === 'basicOt' ? emp.otMultiplier || 1 : 1;

      let daysPresent = 0;
      let basicHours = 0;
      let otHours = 0;
      let basicPay = 0;
      let otPay = 0;

      const segs = employeeSegments[code] || [];
      segs.forEach((seg) => {
        const isIdle = projectNameById[seg.projectId] === 'IDLE-AWAITING';
        if (isIdle) {
          const days =
            Math.round(
              (new Date(seg.segEnd).getTime() -
                new Date(seg.segStart).getTime()) /
                (1000 * 60 * 60 * 24)
            ) + 1;
          daysPresent += days;
          basicHours += days * 8;
          basicPay += (emp.salary / 30) * days;
        } else {
          const dayRecords = (attendanceByProject[seg.projectId] || []).filter(
            (r) =>
              r.employeeCode === code &&
              r.date >= seg.segStart &&
              r.date <= seg.segEnd
          );
          const recordedDates = new Set(dayRecords.map((r) => r.date));
          dayRecords.forEach((r) => {
            if (r.status !== 'present') return;
            daysPresent += 1;
            basicHours += r.basicHours || 0;
            otHours += r.otHours || 0;
            basicPay += (r.basicHours || 0) * hourlyRate;
            otPay += (r.otHours || 0) * hourlyRate * otMultiplier;
          });
          const holSet =
            holidayDatesByProject[seg.projectId] || new Set<string>();
          holSet.forEach((hDate) => {
            if (
              hDate >= seg.segStart &&
              hDate <= seg.segEnd &&
              !recordedDates.has(hDate)
            ) {
              daysPresent += 1;
              basicHours += 8;
              basicPay += 8 * hourlyRate;
            }
          });
        }
      });

      const hr = hrMap[code] || { email: '', position: 'Unspecified' };
      const freshTotal = basicPay + otPay;

      // If this payslip is already approved, the approved figures are
      // frozen: show/keep the values that were actually approved, not
      // whatever the live recalculation now produces. Only flag that
      // live data has drifted, rather than silently overwriting.
      const payslipId = `${projectId}_${code}_${rangeStart}_${rangeEnd}`;
      const existingSnap = await getDoc(doc(db, 'payslips', payslipId));
      const existingData = existingSnap.exists()
        ? (existingSnap.data() as any)
        : null;
      const isApproved = existingData ? existingData.approved || false : false;

      if (isApproved && existingData) {
        const changed =
          Math.abs((existingData.totalPay || 0) - freshTotal) > 0.01 ||
          existingData.daysPresent !== daysPresent;
        result.push({
          code,
          name: emp.name,
          email: existingData.employeeEmail || hr.email,
          department: existingData.department || 'Unassigned',
          position: existingData.position || hr.position,
          daysPresent: existingData.daysPresent,
          basicHours: existingData.basicHours,
          otHours: existingData.otHours,
          hourlyRate: existingData.hourlyRate,
          basicPay: existingData.basicPay,
          otPay: existingData.otPay,
          totalPay: existingData.totalPay,
          approved: true,
          dataChangedSinceApproval: changed,
        });
      } else {
        result.push({
          code,
          name: emp.name,
          email: hr.email,
          department:
            emp.departmentName ||
            (projectNameById[projectId] === 'IDLE-AWAITING'
              ? 'Idle'
              : 'Unassigned'),
          position: hr.position,
          daysPresent,
          basicHours,
          otHours,
          hourlyRate,
          basicPay,
          otPay,
          totalPay: freshTotal,
          approved: false,
          dataChangedSinceApproval: false,
        });
      }
    }

    setRowsByProject((prev) => ({ ...prev, [projectId]: result }));

    // Unapproved generations are NOT persisted to Firestore anymore -
    // they only live in local component state for display/Send/Verify.
    // A payslip only becomes a real stored record once it's actually
    // approved (see handleApproveBatch / handleReapproveWithChanges).
    // This avoids leaving permanent "Draft" clutter in History every
    // time someone opens a project block or tries a different period.

    setFetchingProjectId(null);
  };

  // Runs a real verification pass before approval: recomputes everything
  // fresh from raw Firestore data (not the already-rendered rows) and
  // checks it against the checklist agreed with the user, rather than
  // just flipping the approved flag.
  const handleVerifyBatch = async (projectId: string) => {
    setVerifyingProjectId(projectId);
    const warnings: string[] = [];
    const blockingIssues: string[] = [];
    const displayedRows = rowsByProject[projectId] || [];

    const empQ = query(
      collection(db, 'projectEmployees'),
      where('projectId', '==', projectId)
    );
    const empSnap = await getDocs(empQ);
    const allEmp = empSnap.docs.map((d) => d.data()) as ProjectEmployee[];
    const dedupMap: { [code: string]: ProjectEmployee } = {};
    allEmp.forEach((e: any) => {
      if (e.status === 'left') return;
      dedupMap[e.employeeCode] = e;
    });
    const employees = Object.values(dedupMap);
    const codes = employees.map((e) => e.employeeCode);

    if (codes.length === 0) {
      setVerifyResults((prev) => ({
        ...prev,
        [projectId]: {
          warnings: [],
          blockingIssues: [],
          checkedAt: new Date().toISOString(),
        },
      }));
      setVerifyingProjectId(null);
      return;
    }

    const allRecords: any[] = [];
    for (let i = 0; i < codes.length; i += 30) {
      const batch = codes.slice(i, i + 30);
      const histQ = query(
        collection(db, 'projectEmployees'),
        where('employeeCode', 'in', batch)
      );
      const histSnap = await getDocs(histQ);
      histSnap.docs.forEach((d) => allRecords.push(d.data()));
    }

    const allProjSnap = await getDocs(collection(db, 'projects'));
    const projectNameById: { [id: string]: string } = {};
    allProjSnap.docs.forEach((d) => {
      projectNameById[d.id] = (d.data() as any).name;
    });

    const timelines: {
      [code: string]: { projectId: string; start: string; end: string }[];
    } = {};
    codes.forEach((code) => {
      const recs = allRecords
        .filter((r) => r.employeeCode === code)
        .map((r) => ({ ...r, assignedDate: r.assignedDate || '2000-01-01' }))
        .sort((a, b) => a.assignedDate.localeCompare(b.assignedDate));
      timelines[code] = recs.map((r) => ({
        projectId: r.projectId,
        start: r.assignedDate,
        end: r.leavingDate || rangeEnd,
      }));
    });

    const employeeSegments: {
      [code: string]: { projectId: string; segStart: string; segEnd: string }[];
    } = {};
    codes.forEach((code) => {
      const segs: { projectId: string; segStart: string; segEnd: string }[] =
        [];
      timelines[code].forEach((entry) => {
        const segStart = entry.start > rangeStart ? entry.start : rangeStart;
        const segEnd = entry.end < rangeEnd ? entry.end : rangeEnd;
        if (segStart <= segEnd) {
          segs.push({ projectId: entry.projectId, segStart, segEnd });
        }
      });
      employeeSegments[code] = segs;
    });

    const realProjectIds = Array.from(
      new Set(
        Object.values(employeeSegments)
          .flat()
          .map((s) => s.projectId)
          .filter((pid) => projectNameById[pid] !== 'IDLE-AWAITING')
      )
    );

    const attendanceByProject: { [pid: string]: any[] } = {};
    const holidayDatesByProject: { [pid: string]: Set<string> } = {};

    for (const pid of realProjectIds) {
      const attQ = query(
        collection(db, 'attendance'),
        where('projectId', '==', pid),
        where('date', '>=', rangeStart),
        where('date', '<=', rangeEnd)
      );
      const attSnap = await getDocs(attQ);
      attendanceByProject[pid] = attSnap.docs.map((d) => d.data());

      const holSet = new Set<string>();
      const companyHolQ = query(
        collection(db, 'companyHolidays'),
        where('date', '>=', rangeStart),
        where('date', '<=', rangeEnd)
      );
      const companyHolSnap = await getDocs(companyHolQ);
      companyHolSnap.docs.forEach((d) => holSet.add((d.data() as any).date));

      const projHolQ = query(
        collection(db, 'projectHolidays'),
        where('projectId', '==', pid),
        where('date', '>=', rangeStart),
        where('date', '<=', rangeEnd)
      );
      const projHolSnap = await getDocs(projHolQ);
      projHolSnap.docs.forEach((d) => holSet.add((d.data() as any).date));

      holidayDatesByProject[pid] = holSet;
    }

    const hrMap: {
      [code: string]: {
        email: string;
        position: string;
        salary?: number;
        otMultiplier?: number;
      };
    } = {};
    await Promise.all(
      employees.map(async (emp) => {
        const hrQ = query(
          collection(db, 'employees'),
          where('code', '==', emp.employeeCode)
        );
        const hrSnap = await getDocs(hrQ);
        if (!hrSnap.empty) {
          const hrData = hrSnap.docs[0].data() as any;
          hrMap[emp.employeeCode] = {
            email: hrData.email || '',
            position: hrData.position || 'Unspecified',
            salary: hrData.salary,
            otMultiplier: hrData.otMultiplier,
          };
        }
      })
    );

    const periodDays =
      Math.round(
        (new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) /
          (1000 * 60 * 60 * 24)
      ) + 1;

    for (const emp of employees) {
      const code = emp.employeeCode;
      const hourlyRate = emp.salary / 30 / 8;
      const otMultiplier =
        emp.payType === 'basicOt' ? emp.otMultiplier || 1 : 1;

      let daysPresent = 0;
      let basicHours = 0;
      let otHours = 0;
      let basicPay = 0;
      let otPay = 0;
      let coverageDays = 0;

      const segs = employeeSegments[code] || [];
      segs.forEach((seg) => {
        const segLen =
          Math.round(
            (new Date(seg.segEnd).getTime() -
              new Date(seg.segStart).getTime()) /
              (1000 * 60 * 60 * 24)
          ) + 1;
        coverageDays += segLen;

        const isIdle = projectNameById[seg.projectId] === 'IDLE-AWAITING';
        if (isIdle) {
          daysPresent += segLen;
          basicHours += segLen * 8;
          basicPay += (emp.salary / 30) * segLen;
        } else {
          const dayRecords = (attendanceByProject[seg.projectId] || []).filter(
            (r) =>
              r.employeeCode === code &&
              r.date >= seg.segStart &&
              r.date <= seg.segEnd
          );
          const recordedDates = new Set(dayRecords.map((r) => r.date));
          dayRecords.forEach((r) => {
            if (r.status !== 'present') return;
            daysPresent += 1;
            basicHours += r.basicHours || 0;
            otHours += r.otHours || 0;
            basicPay += (r.basicHours || 0) * hourlyRate;
            otPay += (r.otHours || 0) * hourlyRate * otMultiplier;
          });
          const holSet =
            holidayDatesByProject[seg.projectId] || new Set<string>();
          holSet.forEach((hDate) => {
            if (
              hDate >= seg.segStart &&
              hDate <= seg.segEnd &&
              !recordedDates.has(hDate)
            ) {
              daysPresent += 1;
              basicHours += 8;
              basicPay += 8 * hourlyRate;
            }
          });
        }
      });

      const freshTotal = basicPay + otPay;
      const hr = hrMap[code] || { email: '' };
      const displayedRow = displayedRows.find((r) => r.code === code);

      // 1. Recompute vs displayed
      if (displayedRow && Math.abs(displayedRow.totalPay - freshTotal) > 0.01) {
        warnings.push(
          `${code} (${
            emp.name
          }): total changed since last generated (was ${displayedRow.totalPay.toFixed(
            2
          )}, now ${freshTotal.toFixed(
            2
          )}) - data may have been edited. Re-generate before approving.`
        );
      }

      // 2. Timeline coverage gap
      if (coverageDays < periodDays) {
        warnings.push(
          `${code} (${emp.name}): only covered for ${coverageDays} of ${periodDays} day(s) in this period - check assignment history for a gap.`
        );
      }

      // 3. Stale HR data
      if (hr.salary !== undefined && Math.abs(hr.salary - emp.salary) > 0.01) {
        warnings.push(
          `${code} (${emp.name}): salary on this project record (${emp.salary}) differs from current HR master (${hr.salary}) - payslip used the project record's older value.`
        );
      }
      if (
        hr.otMultiplier !== undefined &&
        Math.abs((hr.otMultiplier || 1) - (emp.otMultiplier || 1)) > 0.01
      ) {
        warnings.push(
          `${code} (${emp.name}): OT multiplier on this project record differs from current HR master - payslip used the project record's older value.`
        );
      }

      // 4. Sanity bounds
      if (daysPresent > periodDays) {
        warnings.push(
          `${code} (${emp.name}): days present (${daysPresent}) exceeds the number of days in the selected period (${periodDays}).`
        );
      }
      if (daysPresent > 0 && freshTotal === 0) {
        warnings.push(
          `${code} (${emp.name}): has recorded attendance but total pay is 0.00 - check salary/rate setup.`
        );
      }

      // 6. Missing email
      if (!hr.email) {
        warnings.push(
          `${code} (${emp.name}): no email on file - will be skipped by Send All.`
        );
      }
    }

    // 5. Duplicate attendance across projects on the same date
    const dateProjectsByCode: {
      [code: string]: { [date: string]: Set<string> };
    } = {};
    for (const pid of realProjectIds) {
      (attendanceByProject[pid] || []).forEach((r: any) => {
        if (!codes.includes(r.employeeCode)) return;
        if (!dateProjectsByCode[r.employeeCode]) {
          dateProjectsByCode[r.employeeCode] = {};
        }
        if (!dateProjectsByCode[r.employeeCode][r.date]) {
          dateProjectsByCode[r.employeeCode][r.date] = new Set();
        }
        dateProjectsByCode[r.employeeCode][r.date].add(pid);
      });
    }
    Object.entries(dateProjectsByCode).forEach(([code, byDate]) => {
      Object.entries(byDate).forEach(([date, pids]) => {
        if (pids.size > 1) {
          const emp = employees.find((e) => e.employeeCode === code);
          warnings.push(
            `${code} (${
              emp?.name || ''
            }): attendance recorded on ${date} across more than one project - possible duplicate entry.`
          );
        }
      });
    });

    // 7. BLOCKING: overlapping approved period on any project - catches
    // re-paying days that were already covered by an earlier approved
    // payslip (e.g. accountant accidentally selects a period that
    // overlaps into an already-paid month). This is the one check that
    // blocks approval outright rather than just warning, since it risks
    // an actual double payment.
    const approvedDocsByCode: { [code: string]: any[] } = {};
    for (let i = 0; i < codes.length; i += 30) {
      const batch = codes.slice(i, i + 30);
      const overlapQ = query(
        collection(db, 'payslips'),
        where('employeeCode', 'in', batch),
        where('approved', '==', true)
      );
      const overlapSnap = await getDocs(overlapQ);
      overlapSnap.docs.forEach((d) => {
        const data = d.data() as any;
        if (!approvedDocsByCode[data.employeeCode]) {
          approvedDocsByCode[data.employeeCode] = [];
        }
        approvedDocsByCode[data.employeeCode].push(data);
      });
    }
    employees.forEach((emp) => {
      const code = emp.employeeCode;
      const approvedDocs = approvedDocsByCode[code] || [];
      approvedDocs.forEach((docData) => {
        // Skip the payslip for this exact period - that's the normal
        // freeze/re-approve case, not an overlap mistake.
        if (
          docData.periodStart === rangeStart &&
          docData.periodEnd === rangeEnd
        ) {
          return;
        }
        const overlaps = !(
          docData.periodEnd < rangeStart || docData.periodStart > rangeEnd
        );
        if (overlaps) {
          blockingIssues.push(
            `${code} (${emp.name}): the selected period (${formatDate(
              rangeStart
            )} - ${formatDate(
              rangeEnd
            )}) overlaps with an already-approved payslip for ${formatDate(
              docData.periodStart
            )} - ${formatDate(docData.periodEnd)} on ${
              docData.projectName || 'another project'
            } - resolve this before approving, or those overlapping days may be paid twice.`
          );
        }
      });
    });

    setVerifyResults((prev) => ({
      ...prev,
      [projectId]: {
        warnings,
        blockingIssues,
        checkedAt: new Date().toISOString(),
      },
    }));
    setVerifyingProjectId(null);
  };

  const toggleProject = (projectId: string) => {
    if (expandedProjectId === projectId) {
      setExpandedProjectId(null);
      return;
    }
    setExpandedProjectId(projectId);
    if (!rowsByProject[projectId]) {
      generatePayslipsForProject(projectId);
    }
  };

  const sendOnePayslip = async (row: PayslipRow) => {
    await emailjs.send(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      {
        to_email: row.email,
        employee_name: row.name,
        employee_code: row.code,
        month: `${rangeStart} to ${rangeEnd}`,
        days_present: row.daysPresent,
        basic_hours: row.basicHours,
        ot_hours: row.otHours,
        basic_pay: row.basicPay.toFixed(2),
        ot_pay: row.otPay.toFixed(2),
        total_pay: row.totalPay.toFixed(2),
        company_name: companyName,
      },
      EMAILJS_PUBLIC_KEY
    );
  };

  const handleSendPayslip = async (row: PayslipRow) => {
    if (!row.email) {
      alert(
        `No email on file for ${row.name} (${row.code}). Please add one in HR.`
      );
      return;
    }
    setSendingCode(row.code);
    try {
      await sendOnePayslip(row);
      alert(`Payslip sent to ${row.email}`);
    } catch (error) {
      console.error('Failed to send payslip:', error);
      alert('Failed to send payslip. Please try again.');
    } finally {
      setSendingCode(null);
    }
  };

  const handleSendAllPayslips = async (projectId: string) => {
    const rows = rowsByProject[projectId] || [];
    const eligible = rows.filter((r) => r.email);
    const skipped = rows.filter((r) => !r.email);

    if (eligible.length === 0) {
      alert('No employees with an email on file for this project/period.');
      return;
    }

    setSendingAllProjectId(projectId);
    let successCount = 0;
    let failCount = 0;

    for (const row of eligible) {
      try {
        await sendOnePayslip(row);
        successCount++;
      } catch (error) {
        console.error(`Failed to send payslip to ${row.name}:`, error);
        failCount++;
      }
    }

    setSendingAllProjectId(null);

    let summary = `Sent ${successCount} of ${eligible.length} payslips successfully.`;
    if (failCount > 0) summary += ` ${failCount} failed.`;
    if (skipped.length > 0)
      summary += ` ${skipped.length} skipped (no email on file).`;
    alert(summary);
  };

  // Marks every payslip doc in this project's current period batch as
  // approved, so Dashboard/Project totals can start counting it.
  const handleApproveBatch = async (projectId: string) => {
    const rows = rowsByProject[projectId] || [];
    if (rows.length === 0) return;
    setApprovingProjectId(projectId);
    const approvedAt = new Date().toISOString();
    const projName = projects.find((p) => p.id === projectId)?.name || '';
    try {
      await Promise.all(
        rows.map(async (row) => {
          const payslipId = `${projectId}_${row.code}_${rangeStart}_${rangeEnd}`;
          await setDoc(
            doc(db, 'payslips', payslipId),
            {
              projectId,
              projectName: projName,
              employeeCode: row.code,
              employeeName: row.name,
              employeeEmail: row.email,
              department: row.department,
              position: row.position,
              periodStart: rangeStart,
              periodEnd: rangeEnd,
              daysPresent: row.daysPresent,
              basicHours: row.basicHours,
              otHours: row.otHours,
              hourlyRate: row.hourlyRate,
              basicPay: row.basicPay,
              otPay: row.otPay,
              totalPay: row.totalPay,
              companyName,
              generatedAt: new Date().toISOString(),
              approved: true,
              approvedAt,
              approvalHistory: arrayUnion({
                approvedAt,
                daysPresent: row.daysPresent,
                basicHours: row.basicHours,
                otHours: row.otHours,
                basicPay: row.basicPay,
                otPay: row.otPay,
                totalPay: row.totalPay,
              }),
            },
            { merge: true }
          );
        })
      );
      setRowsByProject((prev) => ({
        ...prev,
        [projectId]: rows.map((r) => ({ ...r, approved: true })),
      }));
      setVerifyResults((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      alert('Batch approved. These totals will now count in dashboards.');
    } catch (error) {
      console.error('Failed to approve batch:', error);
      alert('Failed to approve. Please try again.');
    } finally {
      setApprovingProjectId(null);
    }
  };

  // The ONLY path that may overwrite an already-approved payslip.
  // Recomputes fresh from raw data (bypassing the freeze) and writes
  // the new figures with a fresh approvedAt - a deliberate re-approval,
  // never a silent one.
  const handleReapproveWithChanges = async (projectId: string) => {
    setApprovingProjectId(projectId);
    try {
      const empQ = query(
        collection(db, 'projectEmployees'),
        where('projectId', '==', projectId)
      );
      const empSnap = await getDocs(empQ);
      const allEmp = empSnap.docs.map((d) => d.data()) as ProjectEmployee[];
      const dedupMap: { [code: string]: ProjectEmployee } = {};
      allEmp.forEach((e: any) => {
        if (e.status === 'left') return;
        dedupMap[e.employeeCode] = e;
      });
      const employees = Object.values(dedupMap);
      const codes = employees.map((e) => e.employeeCode);

      const allRecords: any[] = [];
      for (let i = 0; i < codes.length; i += 30) {
        const batch = codes.slice(i, i + 30);
        const histQ = query(
          collection(db, 'projectEmployees'),
          where('employeeCode', 'in', batch)
        );
        const histSnap = await getDocs(histQ);
        histSnap.docs.forEach((d) => allRecords.push(d.data()));
      }

      const allProjSnap = await getDocs(collection(db, 'projects'));
      const projectNameById: { [id: string]: string } = {};
      allProjSnap.docs.forEach((d) => {
        projectNameById[d.id] = (d.data() as any).name;
      });

      const timelines: {
        [code: string]: { projectId: string; start: string; end: string }[];
      } = {};
      codes.forEach((code) => {
        const recs = allRecords
          .filter((r) => r.employeeCode === code)
          .map((r) => ({
            ...r,
            assignedDate: r.assignedDate || '2000-01-01',
          }))
          .sort((a, b) => a.assignedDate.localeCompare(b.assignedDate));
        timelines[code] = recs.map((r) => ({
          projectId: r.projectId,
          start: r.assignedDate,
          end: r.leavingDate || rangeEnd,
        }));
      });

      const employeeSegments: {
        [code: string]: {
          projectId: string;
          segStart: string;
          segEnd: string;
        }[];
      } = {};
      codes.forEach((code) => {
        const segs: {
          projectId: string;
          segStart: string;
          segEnd: string;
        }[] = [];
        timelines[code].forEach((entry) => {
          const segStart = entry.start > rangeStart ? entry.start : rangeStart;
          const segEnd = entry.end < rangeEnd ? entry.end : rangeEnd;
          if (segStart <= segEnd) {
            segs.push({ projectId: entry.projectId, segStart, segEnd });
          }
        });
        employeeSegments[code] = segs;
      });

      const realProjectIds = Array.from(
        new Set(
          Object.values(employeeSegments)
            .flat()
            .map((s) => s.projectId)
            .filter((pid) => projectNameById[pid] !== 'IDLE-AWAITING')
        )
      );

      const attendanceByProject: { [pid: string]: any[] } = {};
      const holidayDatesByProject: { [pid: string]: Set<string> } = {};

      for (const pid of realProjectIds) {
        const attQ = query(
          collection(db, 'attendance'),
          where('projectId', '==', pid),
          where('date', '>=', rangeStart),
          where('date', '<=', rangeEnd)
        );
        const attSnap = await getDocs(attQ);
        attendanceByProject[pid] = attSnap.docs.map((d) => d.data());

        const holSet = new Set<string>();
        const companyHolQ = query(
          collection(db, 'companyHolidays'),
          where('date', '>=', rangeStart),
          where('date', '<=', rangeEnd)
        );
        const companyHolSnap = await getDocs(companyHolQ);
        companyHolSnap.docs.forEach((d) => holSet.add((d.data() as any).date));

        const projHolQ = query(
          collection(db, 'projectHolidays'),
          where('projectId', '==', pid),
          where('date', '>=', rangeStart),
          where('date', '<=', rangeEnd)
        );
        const projHolSnap = await getDocs(projHolQ);
        projHolSnap.docs.forEach((d) => holSet.add((d.data() as any).date));

        holidayDatesByProject[pid] = holSet;
      }

      const hrMap: { [code: string]: { email: string; position: string } } = {};
      await Promise.all(
        employees.map(async (emp) => {
          const hrQ = query(
            collection(db, 'employees'),
            where('code', '==', emp.employeeCode)
          );
          const hrSnap = await getDocs(hrQ);
          if (!hrSnap.empty) {
            const hrData = hrSnap.docs[0].data();
            hrMap[emp.employeeCode] = {
              email: hrData.email || '',
              position: hrData.position || 'Unspecified',
            };
          }
        })
      );

      const approvedAt = new Date().toISOString();
      const freshRows: PayslipRow[] = [];

      for (const emp of employees) {
        const code = emp.employeeCode;
        const hourlyRate = emp.salary / 30 / 8;
        const otMultiplier =
          emp.payType === 'basicOt' ? emp.otMultiplier || 1 : 1;

        let daysPresent = 0;
        let basicHours = 0;
        let otHours = 0;
        let basicPay = 0;
        let otPay = 0;

        const segs = employeeSegments[code] || [];
        segs.forEach((seg) => {
          const isIdle = projectNameById[seg.projectId] === 'IDLE-AWAITING';
          if (isIdle) {
            const days =
              Math.round(
                (new Date(seg.segEnd).getTime() -
                  new Date(seg.segStart).getTime()) /
                  (1000 * 60 * 60 * 24)
              ) + 1;
            daysPresent += days;
            basicHours += days * 8;
            basicPay += (emp.salary / 30) * days;
          } else {
            const dayRecords = (
              attendanceByProject[seg.projectId] || []
            ).filter(
              (r) =>
                r.employeeCode === code &&
                r.date >= seg.segStart &&
                r.date <= seg.segEnd
            );
            const recordedDates = new Set(dayRecords.map((r) => r.date));
            dayRecords.forEach((r) => {
              if (r.status !== 'present') return;
              daysPresent += 1;
              basicHours += r.basicHours || 0;
              otHours += r.otHours || 0;
              basicPay += (r.basicHours || 0) * hourlyRate;
              otPay += (r.otHours || 0) * hourlyRate * otMultiplier;
            });
            const holSet =
              holidayDatesByProject[seg.projectId] || new Set<string>();
            holSet.forEach((hDate) => {
              if (
                hDate >= seg.segStart &&
                hDate <= seg.segEnd &&
                !recordedDates.has(hDate)
              ) {
                daysPresent += 1;
                basicHours += 8;
                basicPay += 8 * hourlyRate;
              }
            });
          }
        });

        const hr = hrMap[code] || { email: '', position: 'Unspecified' };
        freshRows.push({
          code,
          name: emp.name,
          email: hr.email,
          department:
            emp.departmentName ||
            (projectNameById[projectId] === 'IDLE-AWAITING'
              ? 'Idle'
              : 'Unassigned'),
          position: hr.position,
          daysPresent,
          basicHours,
          otHours,
          hourlyRate,
          basicPay,
          otPay,
          totalPay: basicPay + otPay,
          approved: true,
          dataChangedSinceApproval: false,
        });
      }

      const projName = projectNameById[projectId] || '';
      await Promise.all(
        freshRows.map(async (row) => {
          const payslipId = `${projectId}_${row.code}_${rangeStart}_${rangeEnd}`;

          // Only actually write (and log a new approval-trail entry)
          // for an employee whose figures genuinely changed since the
          // last stored approval. Re-approving the whole batch should
          // not silently stamp untouched employees as "revised" too -
          // that would make the Rev-0X tag meaningless.
          const existingSnap = await getDoc(doc(db, 'payslips', payslipId));
          if (existingSnap.exists()) {
            const existing = existingSnap.data() as any;
            const unchanged =
              existing.daysPresent === row.daysPresent &&
              Math.abs((existing.basicHours || 0) - row.basicHours) < 0.01 &&
              Math.abs((existing.otHours || 0) - row.otHours) < 0.01 &&
              Math.abs((existing.basicPay || 0) - row.basicPay) < 0.01 &&
              Math.abs((existing.otPay || 0) - row.otPay) < 0.01 &&
              Math.abs((existing.totalPay || 0) - row.totalPay) < 0.01;
            if (unchanged) return;
          }

          await setDoc(
            doc(db, 'payslips', payslipId),
            {
              projectId,
              projectName: projName,
              employeeCode: row.code,
              employeeName: row.name,
              employeeEmail: row.email,
              department: row.department,
              position: row.position,
              periodStart: rangeStart,
              periodEnd: rangeEnd,
              daysPresent: row.daysPresent,
              basicHours: row.basicHours,
              otHours: row.otHours,
              hourlyRate: row.hourlyRate,
              basicPay: row.basicPay,
              otPay: row.otPay,
              totalPay: row.totalPay,
              companyName,
              generatedAt: new Date().toISOString(),
              approved: true,
              approvedAt,
              approvalHistory: arrayUnion({
                approvedAt,
                daysPresent: row.daysPresent,
                basicHours: row.basicHours,
                otHours: row.otHours,
                basicPay: row.basicPay,
                otPay: row.otPay,
                totalPay: row.totalPay,
              }),
            },
            { merge: true }
          );
        })
      );

      setRowsByProject((prev) => ({ ...prev, [projectId]: freshRows }));
      setVerifyResults((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      alert('Re-approved with updated values.');
    } catch (error) {
      console.error('Failed to re-approve:', error);
      alert('Failed to re-approve. Please try again.');
    } finally {
      setApprovingProjectId(null);
    }
  };

  if (accessLoading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }
  if (!allowed) {
    return (
      <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
        <h1 style={{ color: '#dc2626' }}>Access Restricted</h1>
        <p style={{ color: '#666' }}>
          You don't have permission to view this page.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }

  return (
    <div
      style={{
        padding: '40px',
        fontFamily: 'Arial, sans-serif',
        maxWidth: '1100px',
      }}
    >
      <div style={{ paddingRight: '170px' }}>
        <h1 style={companyBannerStyle}>Airmech W.L.L</h1>
        <h1 style={pageTitleStyle}>Salary & Pay Slip - All Projects</h1>
      </div>

      <h3 style={{ ...sectionTitleStyle, marginTop: '140px' }}>
        Period: {formatDate(rangeStart)} → {formatDate(rangeEnd)}
      </h3>
      <div style={bluePanelStyle}>
        <div
          style={{
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <label style={labelStyle}>From</label>
          <input
            type="date"
            value={rangeStart}
            onChange={(e) => {
              setRangeStart(e.target.value);
              setRowsByProject({});
              setVerifyResults({});
            }}
            style={inputStyle}
          />
          <label style={labelStyle}>To</label>
          <input
            type="date"
            value={rangeEnd}
            onChange={(e) => {
              setRangeEnd(e.target.value);
              setRowsByProject({});
              setVerifyResults({});
            }}
            style={inputStyle}
          />
        </div>
        <p style={{ ...panelEmptyStyle, marginTop: '10px' }}>
          Changing the period clears already-generated blocks below - open a
          project again to regenerate for the new period.
        </p>
      </div>

      {projects.length === 0 ? (
        <p style={{ ...panelEmptyStyle, marginTop: '20px' }}>
          No projects found.
        </p>
      ) : (
        projects.map((proj) => {
          const rows = rowsByProject[proj.id];
          const isExpanded = expandedProjectId === proj.id;
          const isFetching = fetchingProjectId === proj.id;
          const batchApproved =
            rows && rows.length > 0 && rows.every((r) => r.approved);
          const anyChangedSinceApproval =
            batchApproved && rows!.some((r) => r.dataChangedSinceApproval);
          const grandTotal = (rows || []).reduce(
            (sum, r) => sum + r.totalPay,
            0
          );
          const displayName =
            proj.name === 'IDLE-AWAITING'
              ? 'Idle Pool (Awaiting Assignment)'
              : proj.name;
          const verifyResult = verifyResults[proj.id];
          const isVerifying = verifyingProjectId === proj.id;

          return (
            <div key={proj.id} style={{ marginTop: '20px' }}>
              <button
                onClick={() => toggleProject(proj.id)}
                style={projectHeaderButtonStyle}
              >
                <span>{displayName}</span>
                <span
                  style={{
                    ...statusPillStyle,
                    background: anyChangedSinceApproval
                      ? '#f59e0b'
                      : batchApproved
                      ? '#16a34a'
                      : '#94a3b8',
                  }}
                >
                  {rows
                    ? anyChangedSinceApproval
                      ? 'Approved (data changed)'
                      : batchApproved
                      ? 'Approved'
                      : 'Draft'
                    : 'Not generated'}
                </span>
              </button>

              {isExpanded && (
                <div style={bluePanelStyle}>
                  {isFetching ? (
                    <p style={panelEmptyStyle}>Calculating...</p>
                  ) : !rows || rows.length === 0 ? (
                    <p style={panelEmptyStyle}>
                      No employees found on this project for the selected
                      period.
                    </p>
                  ) : (
                    <>
                      {anyChangedSinceApproval && (
                        <div style={verifyWarningPanelStyle}>
                          <p style={{ fontWeight: 700, margin: 0 }}>
                            Live data has changed for{' '}
                            {
                              rows!.filter((r) => r.dataChangedSinceApproval)
                                .length
                            }{' '}
                            employee(s) since this batch was approved. The
                            figures below and in Dashboard totals are still the
                            originally approved ones - they will not change
                            unless you re-approve.
                          </p>
                        </div>
                      )}
                      <div
                        style={{
                          display: 'flex',
                          gap: '10px',
                          marginBottom: '15px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <button
                          onClick={() => handleSendAllPayslips(proj.id)}
                          disabled={sendingAllProjectId === proj.id}
                          style={sendAllButtonStyle}
                        >
                          {sendingAllProjectId === proj.id
                            ? 'Sending All...'
                            : `Send All Payslips (${rows.length})`}
                        </button>
                        {anyChangedSinceApproval ? (
                          <button
                            onClick={() => handleReapproveWithChanges(proj.id)}
                            disabled={approvingProjectId === proj.id}
                            style={approveButtonStyle}
                          >
                            {approvingProjectId === proj.id
                              ? 'Re-approving...'
                              : 'Re-Approve with Updated Values'}
                          </button>
                        ) : batchApproved ? (
                          <button disabled style={approveButtonStyle}>
                            Approved
                          </button>
                        ) : !verifyResult ? (
                          <button
                            onClick={() => handleVerifyBatch(proj.id)}
                            disabled={isVerifying}
                            style={approveButtonStyle}
                          >
                            {isVerifying
                              ? 'Verifying...'
                              : 'Verify & Approve Batch'}
                          </button>
                        ) : verifyResult.blockingIssues.length > 0 ? (
                          <button
                            onClick={() => handleVerifyBatch(proj.id)}
                            disabled={isVerifying}
                            style={reVerifyButtonStyle}
                          >
                            {isVerifying ? 'Re-checking...' : 'Re-check'}
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => handleVerifyBatch(proj.id)}
                              disabled={isVerifying}
                              style={reVerifyButtonStyle}
                            >
                              {isVerifying ? 'Re-checking...' : 'Re-check'}
                            </button>
                            <button
                              onClick={() => handleApproveBatch(proj.id)}
                              disabled={approvingProjectId === proj.id}
                              style={approveButtonStyle}
                            >
                              {approvingProjectId === proj.id
                                ? 'Approving...'
                                : verifyResult.warnings.length > 0
                                ? 'Confirm Approve Anyway'
                                : 'Confirm Approve'}
                            </button>
                          </>
                        )}
                      </div>

                      {verifyResult &&
                        verifyResult.blockingIssues.length > 0 && (
                          <div style={verifyBlockingPanelStyle}>
                            <p style={{ fontWeight: 700, marginBottom: '6px' }}>
                              ⛔ {verifyResult.blockingIssues.length}{' '}
                              overlapping period issue(s) - approval blocked
                              until resolved:
                            </p>
                            <ul style={{ margin: 0, paddingLeft: '18px' }}>
                              {verifyResult.blockingIssues.map((w, i) => (
                                <li
                                  key={i}
                                  style={{
                                    fontSize: '13px',
                                    marginBottom: '4px',
                                  }}
                                >
                                  {w}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                      {verifyResult &&
                        (verifyResult.warnings.length > 0 ||
                          verifyResult.blockingIssues.length === 0) && (
                          <div
                            style={
                              verifyResult.warnings.length > 0
                                ? verifyWarningPanelStyle
                                : verifyOkPanelStyle
                            }
                          >
                            <p style={{ fontWeight: 700, marginBottom: '6px' }}>
                              {verifyResult.warnings.length > 0
                                ? `${verifyResult.warnings.length} thing(s) to check before approving:`
                                : 'All checks passed - nothing flagged.'}
                            </p>
                            {verifyResult.warnings.length > 0 && (
                              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                                {verifyResult.warnings.map((w, i) => (
                                  <li
                                    key={i}
                                    style={{
                                      fontSize: '13px',
                                      marginBottom: '4px',
                                    }}
                                  >
                                    {w}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <p
                              style={{
                                fontSize: '11px',
                                color: '#64748b',
                                marginTop: '6px',
                                marginBottom: 0,
                              }}
                            >
                              Checked at{' '}
                              {new Date(
                                verifyResult.checkedAt
                              ).toLocaleString()}
                            </p>
                          </div>
                        )}

                      <table
                        style={{ width: '100%', borderCollapse: 'collapse' }}
                      >
                        <thead>
                          <tr
                            style={{
                              textAlign: 'left',
                              borderBottom: '2px solid #93c5fd',
                            }}
                          >
                            <th style={thStyle}>Code</th>
                            <th style={thStyle}>Name</th>
                            <th style={thStyle}>Dept</th>
                            <th style={thStyle}>Days</th>
                            <th style={thStyle}>Basic Pay</th>
                            <th style={thStyle}>OT Pay</th>
                            <th style={thStyle}>Total Pay</th>
                            <th style={thStyle}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr
                              key={r.code}
                              style={{ borderBottom: '1px solid #bfdbfe' }}
                            >
                              <td style={tdStyle}>{r.code}</td>
                              <td style={tdStyle}>{r.name}</td>
                              <td style={tdStyle}>{r.department}</td>
                              <td style={tdStyle}>{r.daysPresent}</td>
                              <td style={tdStyle}>{r.basicPay.toFixed(2)}</td>
                              <td style={tdStyle}>{r.otPay.toFixed(2)}</td>
                              <td style={{ ...tdStyle, fontWeight: 700 }}>
                                {r.totalPay.toFixed(2)}
                              </td>
                              <td
                                style={{
                                  ...tdStyle,
                                  display: 'flex',
                                  gap: '6px',
                                }}
                              >
                                <Link
                                  to={`/payslip/${proj.id}/${r.code}/${rangeStart}/${rangeEnd}`}
                                  style={viewLinkStyle}
                                >
                                  View
                                </Link>
                                <Link
                                  to={`/payslip-history/${proj.id}/${r.code}`}
                                  style={historyLinkStyle}
                                >
                                  History
                                </Link>
                                <button
                                  onClick={() => handleSendPayslip(r)}
                                  disabled={sendingCode === r.code}
                                  style={sendButtonStyle}
                                >
                                  {sendingCode === r.code
                                    ? 'Sending...'
                                    : 'Send'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <div style={totalLineStyle}>
                        <span>
                          Project Total for Period ({rows.length} employees)
                        </span>
                        <strong style={{ fontSize: '18px' }}>
                          {grandTotal.toFixed(2)}
                        </strong>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
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
const projectHeaderButtonStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '14px 20px',
  background: '#1e3a8a',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '17px',
  fontWeight: 700,
};
const statusPillStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  color: '#fff',
  padding: '4px 10px',
  borderRadius: '999px',
};
const labelStyle: React.CSSProperties = { fontSize: '14px', color: '#1e40af' };
const inputStyle: React.CSSProperties = {
  padding: '8px',
  borderRadius: '6px',
  border: '1px solid #93c5fd',
  fontSize: '15px',
  background: '#fff',
};
const sendButtonStyle: React.CSSProperties = {
  padding: '7px 12px',
  background: '#16a34a',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
};
const sendAllButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  background: '#7c3aed',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '15px',
};
const approveButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  background: '#0d9488',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '15px',
};
const reVerifyButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  background: '#64748b',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '15px',
};
const verifyWarningPanelStyle: React.CSSProperties = {
  background: '#fef3c7',
  border: '1px solid #f59e0b',
  borderRadius: '8px',
  padding: '14px 16px',
  marginBottom: '15px',
  color: '#92400e',
};
const verifyBlockingPanelStyle: React.CSSProperties = {
  background: '#fee2e2',
  border: '2px solid #dc2626',
  borderRadius: '8px',
  padding: '14px 16px',
  marginBottom: '15px',
  color: '#991b1b',
};
const verifyOkPanelStyle: React.CSSProperties = {
  background: '#dcfce7',
  border: '1px solid #16a34a',
  borderRadius: '8px',
  padding: '14px 16px',
  marginBottom: '15px',
  color: '#166534',
};
const viewLinkStyle: React.CSSProperties = {
  padding: '7px 12px',
  background: '#1e3a8a',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};
const historyLinkStyle: React.CSSProperties = {
  padding: '7px 12px',
  background: '#d97706',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};
const totalLineStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: '20px',
  paddingTop: '15px',
  borderTop: '1px solid #93c5fd',
  fontSize: '15px',
  color: '#1e40af',
};
const thStyle: React.CSSProperties = {
  padding: '10px 8px',
  fontSize: '14px',
  color: '#1e3a8a',
};
const tdStyle: React.CSSProperties = { padding: '10px 8px', fontSize: '14px' };
const panelEmptyStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#1e40af',
};
