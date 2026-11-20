import { describe, expect, it } from 'vitest';
import { isPosition, POSITIONS } from '../src';

describe('positions', () => {
  it('lists the 15 positions from the spec, with no duplicates', () => {
    expect(POSITIONS).toHaveLength(15);
    expect(new Set(POSITIONS).size).toBe(15);
  });

  it('recognises valid positions and rejects anything else', () => {
    expect(isPosition('GK')).toBe(true);
    expect(isPosition('LWB')).toBe(true);
    expect(isPosition('CF')).toBe(true);
    expect(isPosition('gk')).toBe(false);
    expect(isPosition('SW')).toBe(false);
    expect(isPosition('')).toBe(false);
  });
});
