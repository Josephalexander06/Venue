import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, RedirectIfAuthed, RequireAdmin, RequireAuth } from './auth';
import { AppShell } from './components/AppShell';
import { AdminOverviewPage } from './pages/AdminOverviewPage';
import { AccountPage } from './pages/AccountPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { ForbiddenPage, NotFoundPage } from './pages/ErrorPages';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { RegistrationPendingPage } from './pages/RegistrationPendingPage';

function HomeRedirect() {
  const { isAdmin } = useAuth();
  return <Navigate to={isAdmin ? '/admin' : '/home'} replace />;
}

export function App() {
  return (
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
          <Route path="/account" element={<AccountPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin" element={<AdminOverviewPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
