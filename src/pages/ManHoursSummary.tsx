import { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

interface Project {
  id: string;
  name: string;
  startDate: string;
  completionDate: string;
  assumedManHours: number;
}

interface Department {
  id: string;
  name: string;
  startDate: string;
  completionDate: string;
  assumedManHours: number;
}

interface ProjectEmployee {
  employeeCode: string;
  departmentId?: string;
  departmentName?: string;
}

interface AttendanceRecord {
  employeeCode: string;
  totalHours: number;
  status: string;
}

interface Subcontractor {
  id: string;
  companyName: string;
  departmentId?: string;
  departmentName?: string;
}

interface SubAttendanceRecord {
  subcontractorId: string;
  manHours: number;
}

const elapsedPercent = (start: string, end: string): number => {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const now = Date.now();
  if (now <= s) return 0;
  if (now >= e) return 100;
  return ((now - s) / (e - s)) * 100;
};

export default function ManHoursSummary() {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [usedTotal, setUsedTotal] = useState(0);
  const [usedByDept, setUsedByDept] = useState<{ [deptId: string]: number }>(
    {}
  );
  const [usedNoDept, setUsedNoDept] = useState(0);

  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [subHoursById, setSubHoursById] = useState<{
    [subId: string]: number;
  }>({});

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
          await loadData(proj.id);
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const loadData = async (projectId: string) => {
    const deptQ = query(
      collection(db, 'departments'),
      where('projectId', '==', projectId)
    );
    const deptSnap = await getDocs(deptQ);
    const deptList = deptSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as Department[];
    setDepartments(deptList);
    const empQ = query(
      collection(db, 'projectEmployees'),
      where('projectId', '==', projectId)
    );
    const empSnap = await getDocs(empQ);
    const empList = empSnap.docs.map((d) => d.data()) as ProjectEmployee[];
    const codeToDept: { [code: string]: string | undefined } = {};
    empList.forEach((e) => (codeToDept[e.employeeCode] = e.departmentId));

    const attQ = query(
      collection(db, 'attendance'),
      where('projectId', '==', projectId)
    );
    const attSnap = await getDocs(attQ);
    const records = attSnap.docs.map((d) => d.data()) as AttendanceRecord[];

    let total = 0;
    const byDept: { [deptId: string]: number } = {};
    let noDept = 0;

    records.forEach((r) => {
      if (r.status !== 'present') return;
      const hrs = r.totalHours || 0;
      total += hrs;
      const deptId = codeToDept[r.employeeCode];
      if (deptId) {
        byDept[deptId] = (byDept[deptId] || 0) + hrs;
      } else {
        noDept += hrs;
      }
    });

    setUsedTotal(total);
    setUsedByDept(byDept);
    setUsedNoDept(noDept);

    const subQ = query(
      collection(db, 'subcontractors'),
      where('projectId', '==', projectId)
    );
    const subSnap = await getDocs(subQ);
    const subList = subSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as Subcontractor[];
    setSubcontractors(subList);

    const subAttQ = query(
      collection(db, 'subcontractorAttendance'),
      where('projectId', '==', projectId)
    );
    const subAttSnap = await getDocs(subAttQ);
    const subAttRecords = subAttSnap.docs.map((d) =>
      d.data()
    ) as SubAttendanceRecord[];
    const subHours: { [subId: string]: number } = {};
    subAttRecords.forEach((r) => {
      subHours[r.subcontractorId] =
        (subHours[r.subcontractorId] || 0) + (r.manHours || 0);
    });
    setSubHoursById(subHours);
  };

  if (loading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }

  if (!project) {
    return (
      <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
        <h1>Man Hours Summary</h1>
        <p style={{ color: '#dc2626' }}>
          No project is assigned to your account.
        </p>
      </div>
    );
  }

  const subGrandTotal = subcontractors.reduce(
    (sum, s) => sum + (subHoursById[s.id] || 0),
    0
  );
  const combinedTotal = usedTotal + subGrandTotal;

  const usedPercent =
    project.assumedManHours > 0
      ? (combinedTotal / project.assumedManHours) * 100
      : 0;
  const timePercent = elapsedPercent(project.startDate, project.completionDate);
  const status = usedPercent > timePercent ? 'red' : 'green';

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
        <h1 style={projectTitleStyle}>{project.name}</h1>
        <p style={pageSubtitleStyle}>Man Hours Summary</p>
      </div>

      {/* OVERALL PROJECT - extra top margin so this doesn't collide
          with the corner photo/date block in Layout.tsx */}
      <h3 style={{ ...sectionTitleStyle, marginTop: '90px' }}>
        Overall Project
      </h3>
      <div style={bluePanelStyle}>
        <div style={statRowStyle}>
          <span>Assumed Man Hours</span>
          <span style={statValueStyle}>{project.assumedManHours}</span>
        </div>
        <div style={statRowStyle}>
          <span>Company Employees</span>
          <span style={statValueStyle}>{usedTotal} hrs</span>
        </div>
        <div style={statRowStyle}>
          <span>Subcontractors</span>
          <span style={statValueStyle}>{subGrandTotal} hrs</span>
        </div>
        <div
          style={{
            ...statRowStyle,
            borderTop: '1px solid #93c5fd',
            marginTop: '6px',
            paddingTop: '10px',
          }}
        >
          <span style={{ fontWeight: 700 }}>Total Used</span>
          <span style={{ ...statValueStyle, fontSize: '20px' }}>
            {combinedTotal} hrs ({usedPercent.toFixed(1)}%)
          </span>
        </div>
        <p style={timeLineStyle}>
          Time elapsed: {timePercent.toFixed(1)}% of project duration
        </p>
        <p
          style={{
            ...statusLineStyle,
            color: status === 'red' ? '#dc2626' : '#16a34a',
          }}
        >
          {status === 'red'
            ? '⚠ Hours usage is ahead of schedule pace'
            : '✓ Hours usage is within schedule pace'}
        </p>
      </div>

      {/* BY DEPARTMENT */}
      <h3 style={{ ...sectionTitleStyle, marginTop: '35px' }}>By Department</h3>
      {departments.length === 0 ? (
        <p style={{ color: '#999', marginTop: '15px' }}>
          No departments added yet.
        </p>
      ) : (
        departments.map((d) => {
          const employeeUsed = usedByDept[d.id] || 0;
          const deptSubs = subcontractors.filter(
            (s) => s.departmentId === d.id
          );
          const deptSubTotal = deptSubs.reduce(
            (sum, s) => sum + (subHoursById[s.id] || 0),
            0
          );
          const deptCombinedUsed = employeeUsed + deptSubTotal;
          const pct =
            d.assumedManHours > 0
              ? (deptCombinedUsed / d.assumedManHours) * 100
              : 0;
          const deptTime = elapsedPercent(d.startDate, d.completionDate);
          const deptStatus = pct > deptTime ? 'red' : 'green';

          return (
            <div key={d.id} style={{ marginTop: '20px' }}>
              <h4 style={deptTitleStyle}>{d.name}</h4>
              <div style={bluePanelStyle}>
                <div style={statRowStyle}>
                  <span>Assumed Man Hours</span>
                  <span style={statValueStyle}>{d.assumedManHours}</span>
                </div>
                <div style={statRowStyle}>
                  <span>Company Employees</span>
                  <span style={statValueStyle}>{employeeUsed} hrs</span>
                </div>
                {deptSubs.length > 0 && (
                  <div style={{ margin: '4px 0' }}>
                    {deptSubs.map((s) => (
                      <div key={s.id} style={subRowStyle}>
                        <span>{s.companyName}</span>
                        <span>{subHoursById[s.id] || 0} hrs</span>
                      </div>
                    ))}
                  </div>
                )}
                <div
                  style={{
                    ...statRowStyle,
                    borderTop: '1px solid #93c5fd',
                    marginTop: '6px',
                    paddingTop: '10px',
                  }}
                >
                  <span style={{ fontWeight: 700 }}>Total Used</span>
                  <span style={{ ...statValueStyle, fontSize: '18px' }}>
                    {deptCombinedUsed} hrs ({pct.toFixed(1)}%)
                  </span>
                </div>
                <p
                  style={{
                    ...statusLineStyle,
                    color: deptStatus === 'red' ? '#dc2626' : '#16a34a',
                  }}
                >
                  {deptStatus === 'red'
                    ? '⚠ Ahead of schedule pace'
                    : '✓ Within schedule pace'}
                </p>
              </div>
            </div>
          );
        })
      )}

      {usedNoDept > 0 && (
        <p style={{ fontSize: '13px', color: '#888', marginTop: '20px' }}>
          {usedNoDept} hrs logged by employees not assigned to any department.
        </p>
      )}
    </div>
  );
}

const companyBannerStyle: React.CSSProperties = {
  textAlign: 'center',
  fontFamily: "'Poppins', 'Segoe UI', sans-serif",
  fontSize: '46px',
  fontWeight: 900,
  color: '#0d9488',
  letterSpacing: '0.5px',
  margin: '0 0 16px',
};
const projectTitleStyle: React.CSSProperties = {
  fontFamily: "'Poppins', 'Segoe UI', sans-serif",
  fontSize: '40px',
  fontWeight: 900,
  color: '#1e3a8a',
  letterSpacing: '0.4px',
  margin: '0 0 10px',
};
const pageSubtitleStyle: React.CSSProperties = {
  margin: '0 0 10px',
  padding: 0,
  background: 'none',
  color: '#d4af37',
  fontFamily: "'Inter', 'Segoe UI', sans-serif",
  fontSize: '40px',
  fontWeight: 600,
};
const sectionTitleStyle: React.CSSProperties = {
  marginTop: '25px',
  marginBottom: 0,
  padding: '12px 18px',
  background: '#1e3a8a',
  border: '1px solid #1e3a8a',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '19px',
  fontWeight: 700,
};
const deptTitleStyle: React.CSSProperties = {
  margin: '0 0 0',
  padding: '10px 16px',
  background: '#2563eb',
  border: '1px solid #2563eb',
  borderRadius: '8px 8px 0 0',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: 700,
};
const bluePanelStyle: React.CSSProperties = {
  background: '#dbeafe',
  border: '1px solid #93c5fd',
  borderRadius: '10px',
  padding: '18px 20px',
  marginTop: '0',
};
const statRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 0',
  fontSize: '16px',
  color: '#1e40af',
};
const statValueStyle: React.CSSProperties = {
  fontWeight: 700,
  color: '#1e3a8a',
};
const subRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '4px 0 4px 16px',
  fontSize: '15px',
  color: '#334155',
};
const timeLineStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#475569',
  marginTop: '10px',
  marginBottom: '4px',
};
const statusLineStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 700,
  marginTop: '4px',
  marginBottom: 0,
};
