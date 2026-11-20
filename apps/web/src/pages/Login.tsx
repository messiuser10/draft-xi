import type { MeView } from '@draft-xi/server/contracts';
import { type FormEvent, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { ErrorText } from '../components/ErrorText';
import { useAuthMutation, useMe, useSite } from '../lib/session';

type Tab = 'guest' | 'login' | 'register';

/** Only same-site paths, so `next` cannot send people elsewhere. */
export const safeNext = (next: string | null): string => (next && /^\/(?!\/)/.test(next) ? next : '/');

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { data: me } = useMe();
  const { data: site } = useSite();
  const [tab, setTab] = useState<Tab>('guest');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const login = useAuthMutation<{ username: string; password: string }>('/api/auth/login');
  const register = useAuthMutation<{ username: string; password: string; displayName?: string }>('/api/auth/register');
  const guest = useAuthMutation<{ displayName: string }>('/api/auth/guest');
  const [done, setDone] = useState<MeView | null>(null);

  if (done || (me && !me.isGuest)) return <Navigate to={next} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const onSuccess = (u: MeView) => setDone(u);
    if (tab === 'guest') guest.mutate({ displayName }, { onSuccess });
    else if (tab === 'login') login.mutate({ username, password }, { onSuccess });
    else register.mutate({ username, password, ...(displayName ? { displayName } : {}) }, { onSuccess });
  };
  const pending = login.isPending || register.isPending || guest.isPending;
  const error = tab === 'guest' ? guest.error : tab === 'login' ? login.error : register.error;

  return (
    <div className="mx-auto max-w-md">
      <div className="card p-6">
        <h1 className="display text-3xl">Get on the team sheet</h1>
        {me?.isGuest ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">You are playing as guest {me.displayName}.</p>
        ) : null}
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-night-900" role="tablist">
          {(['guest', 'login', 'register'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`rounded-lg py-2 text-sm font-semibold ${tab === t ? 'bg-white shadow dark:bg-night-700' : 'text-slate-500'}`}
              onClick={() => setTab(t)}
            >
              {t === 'guest' ? 'Guest' : t === 'login' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          {tab !== 'guest' ? (
            <>
              <div>
                <label className="label" htmlFor="username">
                  Username
                </label>
                <input id="username" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </div>
              <div>
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className="input"
                  autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={tab === 'register' ? 8 : 1}
                />
              </div>
            </>
          ) : null}
          {tab !== 'login' ? (
            <div>
              <label className="label" htmlFor="displayName">
                Display name{tab === 'register' ? ' (optional)' : ''}
              </label>
              <input
                id="displayName"
                className="input"
                value={displayName}
                maxLength={24}
                onChange={(e) => setDisplayName(e.target.value)}
                required={tab === 'guest'}
              />
            </div>
          ) : null}
          {tab === 'register' && site && !site.registrationsOpen ? (
            <p className="text-sm text-gold-500">Registrations are closed right now. You can still play as a guest.</p>
          ) : null}
          <ErrorText error={error} />
          <button type="submit" className="btn-primary" disabled={pending}>
            {tab === 'guest' ? 'Play as guest' : tab === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
