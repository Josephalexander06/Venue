import { Component, type ErrorInfo, type ReactNode } from 'react';
import { WarningOctagon } from '@phosphor-icons/react';
import { BrandLockup, Button } from './ui';

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled interface error', error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="state-shell">
          <header className="state-header">
            <BrandLockup />
          </header>
          <main className="state-card">
            <span className="state-icon">
              <WarningOctagon size={36} weight="duotone" />
            </span>
            <p className="state-code">Error</p>
            <h1>The interface ran into a problem</h1>
            <p>Reload the page to try again. If the problem continues, contact the administrator.</p>
            <Button onClick={() => window.location.reload()}>Reload the page</Button>
          </main>
        </div>
      );
    }
    return this.props.children;
  }
}
