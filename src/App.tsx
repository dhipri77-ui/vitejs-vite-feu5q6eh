import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ProjectAdmin from './pages/ProjectAdmin';
import HR from './pages/HR';
import AttendanceLog from './pages/AttendanceLog';
import AttendanceSummary from './pages/AttendanceSummary';
import ManHoursSummary from './pages/ManHoursSummary';
import SalaryPayslip from './pages/SalaryPayslip';
import MasterSalaryPayslip from './pages/MasterSalaryPayslip';
import PayslipSummary from './pages/PayslipSummary';
import MasterAttendanceSummary from './pages/MasterAttendanceSummary';
import Payslip from './pages/Payslip';
import PayslipHistory from './pages/PayslipHistory';
import Settings from './pages/Settings';
import SubcontractorLog from './pages/SubcontractorLog';
import EmployeeDetail from './pages/EmployeeDetail';
import WorkerCheckIn from './pages/WorkerCheckIn';
import IdlePool from './pages/IdlePool';
import HRLanding from './pages/HRLanding';
import AccountantLanding from './pages/AccountantLanding';
import MasterLanding from './pages/MasterLanding';

import Layout from './components/Layout';

import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <Layout>
              <Dashboard />
            </Layout>
          }
        />
        <Route
          path="/project-admin"
          element={
            <Layout>
              <ProjectAdmin />
            </Layout>
          }
        />
        <Route
          path="/subcontractor-log"
          element={
            <Layout>
              <SubcontractorLog />
            </Layout>
          }
        />
        <Route
          path="/idle-pool"
          element={
            <Layout>
              <IdlePool />
            </Layout>
          }
        />
        <Route
          path="/hr"
          element={
            <Layout>
              <HR />
            </Layout>
          }
        />

        <Route path="/worker" element={<WorkerCheckIn />} />
        <Route path="/hr-landing" element={<HRLanding />} />
        <Route path="/accountant-landing" element={<AccountantLanding />} />
        <Route path="/master-landing" element={<MasterLanding />} />

        <Route
          path="/hr/:id"
          element={
            <Layout>
              <EmployeeDetail />
            </Layout>
          }
        />
        <Route
          path="/attendance-log"
          element={
            <Layout>
              <AttendanceLog />
            </Layout>
          }
        />
        <Route
          path="/attendance-summary"
          element={
            <Layout>
              <AttendanceSummary />
            </Layout>
          }
        />
        <Route
          path="/man-hours-summary"
          element={
            <Layout>
              <ManHoursSummary />
            </Layout>
          }
        />
        <Route
          path="/salary-payslip"
          element={
            <Layout>
              <SalaryPayslip />
            </Layout>
          }
        />
        <Route
          path="/master-salary-payslip"
          element={
            <Layout>
              <MasterSalaryPayslip />
            </Layout>
          }
        />
        <Route
          path="/payslip-summary"
          element={
            <Layout>
              <PayslipSummary />
            </Layout>
          }
        />
        <Route
          path="/master-attendance-summary"
          element={
            <Layout>
              <MasterAttendanceSummary />
            </Layout>
          }
        />
        <Route
          path="/settings"
          element={
            <Layout>
              <Settings />
            </Layout>
          }
        />
        <Route
          path="/payslip/:projectId/:code/:periodStart/:periodEnd"
          element={<Payslip />}
        />
        <Route
          path="/payslip-history/:projectId/:code"
          element={<PayslipHistory />}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
