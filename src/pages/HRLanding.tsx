import RoleLanding from '../components/RoleLanding';

export default function HRLanding() {
  return (
    <RoleLanding
      pageTitle="HR"
      items={[
        { to: '/hr', label: 'Employee Master' },
        { to: '/idle-pool', label: 'Idle - Awaiting Assignment' },
      ]}
    />
  );
}
