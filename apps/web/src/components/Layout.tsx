import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router';
import { useLogout, useMe, useSite } from '../lib/session';
import { ensureSocket, useConnection, useToasts } from '../lib/socket';

export const DISCLAIMER = 'Unofficial fan game, not affiliated with any club, league or player.';

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('theme') !== 'light';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      /* storage unavailable */
    }
  }, [dark]);
  return [dark, () => setDark((d) => !d)];
}

export function Layout() {
  const { data: me } = useMe();
  const { data: site } = useSite();
  const logout = useLogout();
  const [dark, toggleTheme] = useTheme();
  const toasts = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      {site?.banner ? (
        <div className="bg-gold-500 px-4 py-2 text-center text-sm font-semibold text-night-950">{site.banner}</div>
      ) : null}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-white/5 dark:bg-night-900/80">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2" aria-label="Home">
            <span className="grid size-9 place-items-center rounded-full ring-4 ring-pitch-500 display text-sm">XI</span>
            <span className="display hidden text-xl sm:inline">{site?.leagueName ?? 'Draft XI League'}</span>
          </Link>
          <nav className="ml-auto flex min-w-0 items-center gap-1">
            <Link to="/how-to-play" className="btn-ghost hidden text-sm sm:inline-flex">
              How to play
            </Link>
            <Link to="/hall-of-fame" className="btn-ghost hidden text-sm md:inline-flex">
              Hall of Fame
            </Link>
            {me?.role === 'admin' ? (
              <Link to="/admin" className="btn-ghost hidden text-sm md:inline-flex">
                Admin
              </Link>
            ) : null}
            <ConnectionDot />
            <button type="button" className="btn-ghost text-sm" onClick={toggleTheme} aria-label="Toggle light and dark">
              {dark ? '☀︎' : '☾'}
            </button>
            {me ? (
              <div className="flex items-center gap-2">
                <Link to="/profile" className="hidden text-sm text-slate-500 hover:underline sm:inline dark:text-slate-400">
                  {me.displayName}
                  {me.isGuest ? ' (guest)' : ''}
                  {me.role === 'admin' ? ' · admin' : ''}
                </Link>
                <button type="button" className="btn-ghost px-2 text-sm" onClick={() => logout.mutate()}>
                  Sign out
                </button>
              </div>
            ) : (
              <Link to="/login" className="btn-secondary text-sm">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 px-4 py-6 text-center text-xs text-slate-500 dark:border-white/5 dark:text-slate-400">
        {DISCLAIMER}
      </footer>

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className="pointer-events-auto card px-4 py-3 text-sm font-medium"
          >
            {t.text}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConnectionDot() {
  const connected = useConnection((s) => s.connected);
  useEffect(() => ensureSocket(), []);
  return (
    <span className="flex items-center gap-1 px-2 text-xs text-slate-500 dark:text-slate-400" title={connected ? 'Live' : 'Offline'}>
      <span className={`size-2 rounded-full ${connected ? 'bg-pitch-500' : 'bg-slate-500'}`} aria-hidden />
      <span className="sr-only sm:not-sr-only">{connected ? 'Live' : 'Offline'}</span>
    </span>
  );
}
