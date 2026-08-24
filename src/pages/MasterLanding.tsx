import RoleLanding from '../components/RoleLanding';

export default function MasterLanding() {
  return (
    <RoleLanding
      pageTitle="Master"
      items={[
        { to: '/hr', label: 'HR' },
        { to: '/idle-pool', label: 'Idle Pool' },
        { to: '/master-salary-payslip', label: 'Salary & Pay Slip' },
        { to: '/payslip-summary', label: 'Payslip Summary' },
        {
          to: '/master-attendance-summary',
          label: 'Daily Attendance Summary',
        },
        { to: '/settings', label: 'Settings' },
      ]}
    />
  );
}
