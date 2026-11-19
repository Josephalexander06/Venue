import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthSessionResponse, SessionUser } from '@venue/shared';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { api, ApiError } from './lib/api';
import { FullPageLoader } from './components/ui';

const ME_KEY = ['auth', 'me'] as const;

interface AuthContextValue {
  user: SessionUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  setSession: (session: AuthSessionResponse | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ME_KEY,
    queryFn: () => api.getMe(),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const setSession = useCallback(
    (next: AuthSessionResponse | null) => {
      queryClient.setQueryData<AuthSessionResponse | null>(ME_KEY, next);
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (error) {
      // An expired session is already signed out server-side.
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
    queryClient.clear();
    queryClient.setQueryData(ME_KEY, null);
  }, [queryClient]);

  const user = session.data?.user ?? null;
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading: session.isPending,
      isAdmin: user?.roles.some((entry) => entry.role === 'ADMINISTRATOR') ?? false,
      setSession,
      logout,
    }),
    [user, session.isPending, setSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export function RequireAdmin() {
  const { isAdmin, isLoading } = useAuth();
  if (isLoading) return <FullPageLoader label="Checking permissions" />;
  if (!isAdmin) return <Navigate to="/forbidden" replace />;
  return <Outlet />;
}

export function RedirectIfAuthed() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageLoader label="Checking your session" />;
  if (user) return <Navigate to="/" replace />;
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
