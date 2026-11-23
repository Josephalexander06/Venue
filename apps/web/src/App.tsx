import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import {
  useAuth,
  RedirectIfAuthed,
  RequireAdmin,
  RequireActive,
  RequireBooker,
  RequireDepartmentHead,
  RequireApprover,
  RequireAuth,
} from './auth';
import { AppShell } from './components/AppShell';
import { Skeleton } from './components/ui';

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
const MyBookingsPage = lazy(() =>
  import('./pages/MyBookingsPage').then((module) => ({ default: module.MyBookingsPage })),
);
const MyEventsPage = lazy(() =>
  import('./pages/MyEventsPage').then((module) => ({ default: module.MyEventsPage })),
);
const BookingStatusPage = lazy(() =>
  import('./pages/BookingStatusPage').then((module) => ({ default: module.BookingStatusPage })),
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
const AdminDepartmentsPage = lazy(() =>
  import('./pages/AdminDepartmentsPage').then((module) => ({
    default: module.AdminDepartmentsPage,
  })),
);
const DepartmentPage = lazy(() =>
  import('./pages/DepartmentPage').then((module) => ({ default: module.DepartmentPage })),
);
const ForbiddenPage = lazy(() =>
  import('./pages/ErrorPages').then((module) => ({ default: module.ForbiddenPage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/ErrorPages').then((module) => ({ default: module.NotFoundPage })),
);

function HomeRedirect() {
  const { user, approvalOnly } = useAuth();
  const target = user?.status === 'PENDING_APPROVAL' ? '/register/pending' : approvalOnly ? '/approvals' : '/home';
  return <Navigate to={target} replace />;
}

function LegacyBookingRedirect() {
  const { id } = useParams();
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  const target = id || params.get('highlight');
  const path = target ? `/bookings/${target}` : params.has('create') || hash ? '/bookings/events' : '/bookings';
  return <Navigate to={path + search + hash} replace />;
}

function RouteFallback() {
  return <div className="route-fallback" role="status">
    <span className="sr-only">Loading page</span><Skeleton className="skeleton-block" />
  </div>;
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<RedirectIfAuthed />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route path="/register/pending" element={<RegistrationPendingPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route element={<AppShell />}>
            <Route index element={<HomeRedirect />} />
            <Route path="/venues" element={<VenuesPage />} />
            <Route path="/venues/:id" element={<VenueDetailPage />} />
            <Route element={<RequireActive />}>
              <Route path="/home" element={<HomePage />} />
              <Route element={<RequireBooker />}>
                <Route path="/bookings" element={<MyBookingsPage />} />
                <Route path="/bookings/events" element={<MyEventsPage />} />
              </Route>
              <Route path="/bookings/:id" element={<BookingStatusPage />} />
              <Route path="/my-events" element={<LegacyBookingRedirect />} />
              <Route path="/my-events/requests/:id" element={<LegacyBookingRedirect />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/approvals/:id" element={<ApprovalDetailPage />} />
              <Route element={<RequireApprover />}>
                <Route path="/approvals" element={<ApprovalInboxPage />} />
              </Route>
              <Route element={<RequireDepartmentHead />}>
                <Route path="/department" element={<DepartmentPage />} />
              </Route>
              <Route element={<RequireAdmin />}>
                <Route path="/admin" element={<AdminOverviewPage />} />
                <Route path="/admin/users" element={<AdminUsersPage />} />
                <Route path="/admin/venues" element={<AdminVenuesPage />} />
                <Route path="/admin/workflows" element={<AdminWorkflowsPage />} />
                <Route path="/admin/departments" element={<AdminDepartmentsPage />} />
              </Route>
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
