/** Seeded randomness. The engine never uses Math.random, so every result is reproducible. */

/** Hashes any mix of strings and numbers into an unsigned 32-bit seed (FNV-1a plus a final mix). */
export function hashSeed(...parts: readonly (string | number)[]): number {
  let h = 0x811c9dc5;
  const text = parts.join('\u001f');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32: small, fast, good enough for games. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  chance(probability: number): boolean;
  /** Standard normal sample. */
  normal(): number;
  poisson(lambda: number): number;
  pick<T>(items: readonly T[]): T;
  /** Picks an item with probability proportional to its weight. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    normal: () => {
      const u1 = 1 - next(); // (0, 1]
      const u2 = next();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    poisson: (lambda) => {
      // Knuth's method; lambda is clamped to at most 4.5 by the match model, so this is fast.
      const limit = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= next();
      } while (p > limit);
      return k - 1;
    },
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    weighted: (items, weight) => {
      if (items.length === 0) throw new Error('weighted pick from empty list');
      let total = 0;
      for (const item of items) total += Math.max(0, weight(item));
      if (total <= 0) return rng.pick(items);
      let r = next() * total;
      for (const item of items) {
        r -= Math.max(0, weight(item));
        if (r < 0) return item;
      }
      return items[items.length - 1]!;
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
  return rng;
}

/** A child RNG for one purpose, e.g. derive(seed, 'match', 7, 'h:1', 'ai:3'). */
export function deriveRng(...parts: readonly (string | number)[]): Rng {
  return createRng(hashSeed(...parts));
}
