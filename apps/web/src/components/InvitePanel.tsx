import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useToasts } from '../lib/socket';

export function InvitePanel({ code }: { code: string }) {
  const link = `${window.location.origin}/lobby/${code}`;
  const [qr, setQr] = useState<string | null>(null);
  const push = useToasts((s) => s.push);
  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 240, color: { dark: '#0B1220', light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [link]);
  const copy = () => {
    navigator.clipboard.writeText(link).then(
      () => push('Invite link copied'),
      () => push('Could not copy. Share the code instead.'),
    );
  };
  return (
    <section className="card p-5">
      <h2 className="display text-xl">Invite friends</h2>
      <div className="mt-3 flex items-center gap-4">
        {qr ? <img src={qr} alt={`QR code for ${link}`} className="size-28 rounded-lg bg-white p-1" /> : <div className="size-28 rounded-lg bg-slate-200 dark:bg-night-700" />}
        <div className="grid gap-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">Game code</p>
          <p className="font-mono text-3xl font-bold tracking-[0.25em]">{code}</p>
          <button type="button" className="btn-secondary text-sm" onClick={copy}>
            Copy link
          </button>
        </div>
      </div>
    </section>
  );
}
