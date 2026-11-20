/**
 * Maximum-weight assignment of rows to distinct columns (Hungarian algorithm, O(n^2 m)).
 * `weights[row][col]`; use `null` for a forbidden pairing. Requires rows <= columns.
 * Returns the chosen column for each row, or -1 if no feasible column remained.
 */
export function maxWeightAssignment(weights: readonly (readonly (number | null)[])[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const m = weights[0]?.length ?? 0;
  if (m < n) throw new Error(`assignment needs at least as many columns (${m}) as rows (${n})`);

  let max = 0;
  for (const row of weights) for (const w of row) if (w !== null && w > max) max = w;
  const FORBIDDEN = max * 4 + 1e6;
  const cost = (i: number, j: number): number => {
    const w = weights[i - 1]?.[j - 1];
    return w === null || w === undefined ? FORBIDDEN : max - w;
  };

  // 1-indexed arrays, index 0 is the virtual column.
  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1);
  const way = new Int32Array(m + 1);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(Infinity);
    const used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost(i0, j) - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    const row = p[j]!;
    if (row > 0 && cost(row, j) < FORBIDDEN) result[row - 1] = j - 1;
  }
  return result;
}
