import RoleLanding from '../components/RoleLanding';

export default function AccountantLanding() {
  return (
    <RoleLanding
      pageTitle="Accountant"
      items={[
        { to: '/master-salary-payslip', label: 'Salary & Pay Slip' },
        { to: '/payslip-summary', label: 'Payslip Summary' },
        { to: '/master-attendance-summary', label: 'Daily Attendance Summary' },
      ]}
    />
  );
}
