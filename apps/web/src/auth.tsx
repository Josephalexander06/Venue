import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  APPROVER_ROLES,
  type AuthSessionResponse,
  type RoleName,
  type SessionUser,
} from '@venue/shared';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from './lib/api';
import { FullPageLoader } from './components/ui';

const ME_KEY = ['auth', 'me'] as const;

interface AuthContextValue {
  user: SessionUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  isApprover: boolean;
  isFacultyOnlyApprover: boolean;
  hasRole: (role: RoleName) => boolean;
  setSession: (session: AuthSessionResponse | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const session = useQuery({
    queryKey: ME_KEY,
    queryFn: () => api.getMe(),
    enabled: !signingOut,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: (query) => query.state.data?.user.status === 'PENDING_APPROVAL' ? 'always' : false,
    refetchInterval: (query) => query.state.data?.user.status === 'PENDING_APPROVAL' ? 12_000 : false,
  });

  const setSession = useCallback(
    (next: AuthSessionResponse | null) => {
      queryClient.setQueryData<AuthSessionResponse | null>(ME_KEY, next);
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    setSigningOut(true);
    try {
      await api.logout();
    } catch {
      // Regardless of server response or network state, always clear client session
    } finally {
      await queryClient.cancelQueries();
      setSession(null);
      const sessionQuery = queryClient.getQueryCache().find({ queryKey: ME_KEY, exact: true });
      queryClient.removeQueries({ predicate: (query) => query !== sessionQuery });
      queryClient.getMutationCache().clear();
      void navigate('/login', { replace: true });
      setSigningOut(false);
    }
  }, [navigate, queryClient, setSession]);

  const user = session.data?.user ?? null;
  const value = useMemo<AuthContextValue>(
    () => {
      const userRoles = new Set(user?.roles.map((entry) => entry.role) ?? []);
      return {
        user,
        isLoading: session.isPending,
        isAdmin: userRoles.has('ADMINISTRATOR'),
        isApprover: APPROVER_ROLES.some((role) => userRoles.has(role)),
        isFacultyOnlyApprover: userRoles.has('FACULTY') &&
          APPROVER_ROLES.every((role) => role === 'FACULTY' || !userRoles.has(role)),
        hasRole: (role: RoleName) => userRoles.has(role),
        setSession,
        logout,
      };
    },
    [user, session.isPending, setSession, logout],
  );

  return (
    <AuthContext.Provider value={value}>
      {signingOut ? <FullPageLoader label="Signing out…" /> : children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}

export function RequireAuth() {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageLoader label="Checking your session" />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }} />;
  }
  return <Outlet />;
}

export function RequireActive() {
  const { user } = useAuth();
  return user?.status === 'ACTIVE' ? <Outlet /> : <Navigate to="/register/pending" replace />;
}

export function RequireAdmin() {
  const { isAdmin, isLoading } = useAuth();
  if (isLoading) return <FullPageLoader label="Checking permissions" />;
  if (!isAdmin) return <Navigate to="/forbidden" replace />;
  return <Outlet />;
}

export function RequireApprover() {
  const { isApprover, isLoading } = useAuth();
  if (isLoading) return <FullPageLoader label="Checking permissions" />;
  if (!isApprover) return <Navigate to="/forbidden" replace />;
  return <Outlet />;
}

export function RedirectIfAuthed() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageLoader label="Checking your session" />;
  if (user) return <Navigate to={user.status === 'PENDING_APPROVAL' ? '/register/pending' : '/'} replace />;
  return <Outlet />;
}

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Campus Venue` : 'Campus Venue';
    return () => {
      document.title = 'Campus Venue';
    };
  }, [title]);
}
