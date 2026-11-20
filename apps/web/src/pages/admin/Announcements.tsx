/** Announcements: set or clear the site-wide banner. */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSite } from '../../lib/session';
import { Section, send, useAdminMutation } from './shared';

export function AdminAnnouncementsPage() {
  const { data: site } = useSite();
  const qc = useQueryClient();
  const [text, setText] = useState<string | null>(null);
  const value = text ?? site?.banner ?? '';
  const save = useAdminMutation((t: string) => send('/api/admin/announcement', 'PUT', { text: t }), (o) => (o ? 'Banner updated' : 'Banner cleared'));
  const submit = (t: string) => save.mutate(t, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['site'] }) });
  return (
    <Section title="Site-wide banner">
      <p className="text-sm text-slate-500">Shown at the top of every page for everyone. Up to 300 characters.</p>
      <textarea className="input mt-2 h-24" maxLength={300} aria-label="Banner text" value={value} onChange={(e) => setText(e.target.value)} />
      {value ? <div className="mt-2 rounded-xl bg-gold-500 px-4 py-2 text-center text-sm font-semibold text-night-950">{value}</div> : null}
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn-primary" disabled={save.isPending || !value.trim()} onClick={() => submit(value.trim())}>
          Publish banner
        </button>
        <button type="button" className="btn-ghost" disabled={save.isPending || !site?.banner} onClick={() => (setText(''), submit(''))}>
          Clear banner
        </button>
      </div>
    </Section>
  );
}
