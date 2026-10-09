import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, useAuth } from './auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';

const Display = lazy(() => import('./pages/Display'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const QueueConsole = lazy(() => import('./pages/QueueConsole'));
const Patients = lazy(() => import('./pages/Patients'));
const Visits = lazy(() => import('./pages/Visits'));
const VisitDetail = lazy(() => import('./pages/VisitDetail'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Reports = lazy(() => import('./pages/Reports'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const AdminDepartments = lazy(() => import('./pages/AdminDepartments'));
const AdminSettings = lazy(() => import('./pages/AdminSettings'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const Account = lazy(() => import('./pages/Account'));
const TicketSlip = lazy(() => import('./pages/TicketSlip'));

/** Sends each signed-in user to the page that fits their role. */
function Home() {
  const { user, can } = useAuth();
  if (can('dashboard.admin')) return <Dashboard />;
  const first = user?.departmentIds[0];
  if (first) return <Navigate to={`/queue/${first}`} replace />;
  return <Navigate to="/account" replace />;
}

export function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/display" element={<Display />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Home />} />
          <Route path="queue/:departmentId" element={<RequireAuth permission="queue.view"><QueueConsole /></RequireAuth>} />
          <Route path="patients" element={<RequireAuth permission="patient.search"><Patients /></RequireAuth>} />
          <Route path="visits" element={<RequireAuth permission="visit.view"><Visits /></RequireAuth>} />
          <Route path="visits/:visitId" element={<RequireAuth permission="visit.view"><VisitDetail /></RequireAuth>} />
          <Route path="tickets/:ticketId/slip" element={<TicketSlip />} />
          <Route path="notifications" element={<RequireAuth permission="notifications.view"><Notifications /></RequireAuth>} />
          <Route path="reports" element={<RequireAuth permission="reports.view"><Reports /></RequireAuth>} />
          <Route path="admin/users" element={<RequireAuth permission="users.manage"><AdminUsers /></RequireAuth>} />
          <Route path="admin/departments" element={<RequireAuth permission="departments.manage"><AdminDepartments /></RequireAuth>} />
          <Route path="admin/settings" element={<RequireAuth permission="settings.manage"><AdminSettings /></RequireAuth>} />
          <Route path="admin/audit" element={<RequireAuth permission="audit.view"><AuditLog /></RequireAuth>} />
          <Route path="account" element={<Account />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
