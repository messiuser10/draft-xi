/** Catches render errors so one broken page shows a recoverable card instead of a blank screen. */
import { Component, type ReactNode } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

export function ErrorCard({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="card mx-auto max-w-md p-8 text-center" role="alert">
      <p className="display text-3xl">{title}</p>
      <p className="mt-2 text-slate-500 dark:text-slate-400">{message}</p>
      <div className="mt-6 flex justify-center gap-2">
        <button type="button" className="btn-secondary" onClick={onRetry ?? (() => window.location.reload())}>
          Try again
        </button>
        <Link to="/" className="btn-primary" onClick={onRetry}>
          Back to home
        </Link>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null; key: string | undefined }> {
  override state: { error: Error | null; key: string | undefined } = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  // Navigating to another page clears the error.
  static getDerivedStateFromProps(props: { resetKey?: string }, state: { error: Error | null; key: string | undefined }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  override componentDidCatch(error: Error) {
    console.error(error);
  }

  override render() {
    if (this.state.error) {
      return <ErrorCard title="Something broke" message="This page hit an unexpected error. Your game is safe on the server." onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

/** Router-level fallback for errors thrown outside the page boundary (loaders, the layout itself). */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : 'Unknown error';
  return (
    <main className="p-6">
      <ErrorCard title="Something broke" message={message} />
    </main>
  );
}
