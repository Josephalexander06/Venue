import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandLockup } from './ui';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <header className="auth-header">
        <Link to="/login" aria-label="Campus Venue sign in"><BrandLockup compact /></Link>
      </header>
      <main className="auth-main" id="main-content">
        <div className="auth-main-inner">{children}</div>
      </main>
    </div>
  );
}
