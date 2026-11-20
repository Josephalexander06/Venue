import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import {
  useAuth,
  RedirectIfAuthed,
  RequireAdmin,
  RequireApprover,
  RequireAuth,
} from './auth';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';

const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })));
const AccountPage = lazy(() =>
  import('./pages/AccountPage').then((module) => ({ default: module.AccountPage })),
);
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const RegisterPage = lazy(() =>
  import('./pages/RegisterPage').then((module) => ({ default: module.RegisterPage })),
);
const RegistrationPendingPage = lazy(() =>
  import('./pages/RegistrationPendingPage').then((module) => ({
    default: module.RegistrationPendingPage,
  })),
);
const VenuesPage = lazy(() =>
  import('./pages/VenuesPage').then((module) => ({ default: module.VenuesPage })),
);
const VenueDetailPage = lazy(() =>
  import('./pages/VenueDetailPage').then((module) => ({ default: module.VenueDetailPage })),
);
const MyEventsPage = lazy(() =>
  import('./pages/MyEventsPage').then((module) => ({ default: module.MyEventsPage })),
);
const ApprovalInboxPage = lazy(() =>
  import('./pages/ApprovalInboxPage').then((module) => ({ default: module.ApprovalInboxPage })),
);
const ApprovalDetailPage = lazy(() =>
  import('./pages/ApprovalDetailPage').then((module) => ({ default: module.ApprovalDetailPage })),
);
const AdminOverviewPage = lazy(() =>
  import('./pages/AdminOverviewPage').then((module) => ({ default: module.AdminOverviewPage })),
);
const AdminUsersPage = lazy(() =>
  import('./pages/AdminUsersPage').then((module) => ({ default: module.AdminUsersPage })),
);
const AdminVenuesPage = lazy(() =>
  import('./pages/AdminVenuesPage').then((module) => ({ default: module.AdminVenuesPage })),
);
const AdminWorkflowsPage = lazy(() =>
  import('./pages/AdminWorkflowsPage').then((module) => ({ default: module.AdminWorkflowsPage })),
);
const ForbiddenPage = lazy(() =>
  import('./pages/ErrorPages').then((module) => ({ default: module.ForbiddenPage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/ErrorPages').then((module) => ({ default: module.NotFoundPage })),
);

function HomeRedirect() {
  const { isAdmin } = useAuth();
  return <Navigate to={isAdmin ? '/admin' : '/home'} replace />;
}

function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <Spinner size={20} />
      Loading page…
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<RedirectIfAuthed />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/register/pending" element={<RegistrationPendingPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route element={<AppShell />}>
            <Route index element={<HomeRedirect />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/venues" element={<VenuesPage />} />
            <Route path="/venues/:id" element={<VenueDetailPage />} />
            <Route path="/my-events" element={<MyEventsPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/approvals/:id" element={<ApprovalDetailPage />} />
            <Route element={<RequireApprover />}>
              <Route path="/approvals" element={<ApprovalInboxPage />} />
            </Route>
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<AdminOverviewPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/venues" element={<AdminVenuesPage />} />
              <Route path="/admin/workflows" element={<AdminWorkflowsPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
