import type { ReactNode } from 'react';
import { CheckCircle, ClockCountdown, ShieldCheck } from '@phosphor-icons/react';
import { BrandLockup } from './ui';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <div className="auth-aside-glow" aria-hidden="true" />
        <div className="auth-aside-top">
          <BrandLockup tone="light" />
        </div>

        <div className="auth-aside-body">
          <p className="auth-kicker">College venue operations</p>
          <h2>Every room. Every request. One clear approval trail.</h2>
          <p className="auth-aside-copy">
            A single workspace for departments, faculty and campus administration to coordinate
            bookings without crossed calendars or lost paperwork.
          </p>

          <div className="auth-preview" aria-hidden="true">
            <div className="auth-preview-head">
              <span>Access requests</span>
              <span className="auth-preview-live">
                <span className="live-dot" /> Live queue
              </span>
            </div>
            <div className="auth-preview-row">
              <span className="preview-avatar">AR</span>
              <span className="preview-copy">
                <strong>Ananya Rao</strong>
                <span>Computer Science</span>
              </span>
              <span className="preview-status preview-pending">
                <ClockCountdown size={13} /> Awaiting review
              </span>
            </div>
            <div className="auth-preview-row">
              <span className="preview-avatar preview-avatar-alt">MK</span>
              <span className="preview-copy">
                <strong>Meera Krishnan</strong>
                <span>Department of Physics</span>
              </span>
              <span className="preview-status preview-approved">
                <CheckCircle size={13} weight="fill" /> Verified
              </span>
            </div>
          </div>
        </div>

        <div className="auth-aside-foot">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Identity-reviewed accounts. Scoped access. Audited decisions.</span>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-main-inner">{children}</div>
        <p className="auth-legal">Campus Venue · For authorised college use only</p>
      </main>
    </div>
  );
}
