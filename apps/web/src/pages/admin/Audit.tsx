/** Admin Audit Log: filter by actor, action, game and date, with CSV export. */
import type { AuditEntryView } from '@draft-xi/server/contracts';
import { useState } from 'react';
import { fmtDate, Loading, Section, useAdminQuery } from './shared';

export function AdminAuditPage() {
  const [f, setF] = useState({ actor: '', action: '', game: '', from: '', to: '' });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v.trim()) qs.set(k, k === 'to' ? `${v}T23:59:59` : v.trim());
  const q = useAdminQuery<{ entries: AuditEntryView[] }>(['audit', qs.toString()], `/api/admin/audit?${qs.toString()}`);
  const csv = new URLSearchParams(qs);
  csv.set('format', 'csv');
  csv.set('limit', '5000');
  return (
    <Section
      title="Audit log"
      actions={
        <a className="btn-ghost text-sm" href={`/api/admin/audit?${csv.toString()}`} download>
          Export CSV
        </a>
      }
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <input className="input" placeholder="Actor" aria-label="Actor" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} />
        <input className="input" placeholder="Action (e.g. draft)" aria-label="Action" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />
        <input className="input font-mono uppercase" placeholder="Game code" aria-label="Game code" maxLength={6} value={f.game} onChange={(e) => setF({ ...f, game: e.target.value })} />
        <label className="text-xs">
          From
          <input className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </label>
        <label className="text-xs">
          To
          <input className="input" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </label>
      </div>
      {!q.data ? (
        <div className="mt-3">
          <Loading />
        </div>
      ) : q.data.entries.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No entries match.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="text-left">When</th>
                <th className="text-left">Actor</th>
                <th className="text-left">Action</th>
                <th className="text-left">Target</th>
                <th className="text-left">Details</th>
              </tr>
            </thead>
            <tbody>
              {q.data.entries.map((a) => (
                <tr key={a.id} className="border-t border-slate-200 align-top dark:border-white/5">
                  <td className="whitespace-nowrap py-1 pr-2 text-xs text-slate-500">{fmtDate(a.createdAt)}</td>
                  <td className="pr-2">{a.actor}</td>
                  <td className="pr-2 font-mono text-xs">{a.action}</td>
                  <td className="pr-2 text-xs">{a.gameCode ?? a.target ?? ''}</td>
                  <td className="max-w-xs truncate font-mono text-xs text-slate-500" title={a.details ? JSON.stringify(a.details) : ''}>
                    {a.details ? JSON.stringify(a.details) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
