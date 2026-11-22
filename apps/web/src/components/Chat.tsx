import type { GameSnapshot } from '@draft-xi/server/contracts';
import { type FormEvent, useState } from 'react';
import { useAction } from '../lib/actions';

export function Chat({ snapshot, bare = false }: { snapshot: GameSnapshot; bare?: boolean }) {
  const { game, chat, me } = snapshot;
  const { run, busy } = useAction();
  const [body, setBody] = useState('');
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    if (await run(`/api/games/${game.code}/chat`, 'POST', { body })) setBody('');
  };
  return (
    <section className={bare ? '' : 'card p-5'}>
      {bare ? null : <h2 className="display text-xl">Chat</h2>}
      <ul className="mt-3 grid max-h-60 grid-cols-1 gap-1 overflow-y-auto text-sm" aria-live="polite">
        {chat.length === 0 ? <li className="text-slate-500">No messages yet. Say hello.</li> : null}
        {chat.map((m) => (
          <li key={m.id}>
            <span className="font-semibold">{m.displayName}:</span> {m.body}
          </li>
        ))}
      </ul>
      {me.userId !== null ? (
        <form onSubmit={(e) => void send(e)} className="mt-3 flex gap-2">
          <label htmlFor="chat" className="sr-only">
            Message
          </label>
          <input id="chat" className="input" maxLength={300} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message" />
          <button type="submit" className="btn-secondary" disabled={busy}>
            Send
          </button>
        </form>
      ) : null}
    </section>
  );
}
