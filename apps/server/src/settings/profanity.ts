/**
 * Lightweight team-name filter. Normalises common look-alike characters, splits into words, and
 * blocks a word that starts or ends with a listed term. Matching whole-word edges (not any
 * substring) keeps names like "Scunthorpe" or "Arsenal" usable.
 */
const LOOKALIKES: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

export function normaliseForFilter(text: string): string[] {
  const mapped = [...text.normalize('NFKD').toLowerCase()]
    .map((ch) => LOOKALIKES[ch] ?? ch)
    .join('')
    .replace(/[̀-ͯ]/g, '');
  return mapped.split(/[^a-z]+/).filter(Boolean);
}

export function containsProfanity(text: string, words: readonly string[]): boolean {
  const banned = words.map((w) => w.toLowerCase()).filter((w) => w.length >= 2);
  const tokens = normaliseForFilter(text);
  const joined = tokens.join('');
  return (
    tokens.some((tok) => banned.some((b) => tok === b || tok.startsWith(b) || tok.endsWith(b))) ||
    // Catch spaced-out spellings such as "f u c k".
    (tokens.every((tok) => tok.length === 1) && banned.some((b) => joined.includes(b)))
  );
}
