/**
 * Optional sound effects (spec M7): a referee whistle and a pick chime, synthesised with WebAudio so
 * there are no audio assets. Off by default; the choice is remembered per browser.
 */
import { create } from 'zustand';

const KEY = 'sound';

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export const useSound = create<{ enabled: boolean; toggle: () => void }>((set, get) => ({
  enabled: readEnabled(),
  toggle: () => {
    const enabled = !get().enabled;
    try {
      localStorage.setItem(KEY, enabled ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
    set({ enabled });
    if (enabled) play('chime');
  },
}));

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(ac: AudioContext, freq: number, start: number, length: number, type: OscillatorType, peak: number, vibrato = 0): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (vibrato) {
    const lfo = ac.createOscillator();
    const depth = ac.createGain();
    lfo.frequency.value = 28;
    depth.gain.value = vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(start + length);
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

export function play(kind: 'whistle' | 'chime'): void {
  if (!useSound.getState().enabled) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  if (kind === 'chime') {
    tone(ac, 880, t, 0.35, 'sine', 0.15);
    tone(ac, 1318.5, t + 0.08, 0.45, 'sine', 0.1);
  } else {
    tone(ac, 2600, t, 0.25, 'square', 0.04, 120);
    tone(ac, 2600, t + 0.32, 0.6, 'square', 0.04, 120);
  }
}
