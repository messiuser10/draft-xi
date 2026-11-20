/** First-visit walkthrough (spec M7): four short cards, shown once per browser and replayable from How to Play. */
import { useEffect, useRef } from 'react';
import { create } from 'zustand';

const KEY = 'walkthrough:done';

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // No storage (private mode): do not nag on every page.
  }
}

export const useWalkthrough = create<{ open: boolean; step: number; setStep: (step: number) => void; show: () => void; close: () => void }>((set) => ({
  open: !seen(),
  step: 0,
  setStep: (step) => set({ step }),
  show: () => set({ open: true, step: 0 }),
  close: () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* storage unavailable */
    }
    set({ open: false });
  },
}));

export const WALKTHROUGH = [
  ['Welcome to Draft XI League', 'Draft a starting XI from 20 real clubs, then watch your team play a full 38-matchday season against friends and AI clubs.'],
  ['Create or join', 'Start a game and share the 6-letter code. Friends join as guests with just a name. Empty seats can be filled by bots.'],
  ['Draft your XI', 'Take turns picking players into the slots of your formation. Tap a slot to filter the pool, star players to queue them, and watch the clock.'],
  ['Play the season', 'Everyone plays everyone twice. The table moves live, then you get a champion, awards and a grade for every draft.'],
] as const;

export function Walkthrough() {
  const { open, close, step, setStep } = useWalkthrough();
  const dialog = useRef<HTMLDivElement>(null);
  const last = step === WALKTHROUGH.length - 1;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('[data-primary]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open, close]);

  if (!open) return null;
  const [title, text] = WALKTHROUGH[step]!;
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-night-950/70 p-4 backdrop-blur-sm sm:place-items-center" role="presentation" onClick={close}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-title"
        className="card w-full max-w-md animate-reveal p-6 shadow-2xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-bold text-pitch-500" aria-live="polite">
          Step {step + 1} of {WALKTHROUGH.length}
        </p>
        <h2 id="walkthrough-title" className="display mt-1 text-2xl">
          {title}
        </h2>
        <p className="mt-2 text-slate-600 dark:text-slate-300">{text}</p>
        <div className="mt-4 flex gap-1" aria-hidden>
          {WALKTHROUGH.map((_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? 'bg-pitch-500' : 'bg-slate-300 dark:bg-night-700'}`} />
          ))}
        </div>
        <div className="mt-6 flex gap-2">
          <button type="button" className="btn-ghost" onClick={close}>
            Skip
          </button>
          <span className="flex-1" />
          {step > 0 ? (
            <button type="button" className="btn-secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : null}
          <button type="button" data-primary className="btn-primary" onClick={() => (last ? close() : setStep(step + 1))}>
            {last ? "Let's play" : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
