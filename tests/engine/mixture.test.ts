import { describe, it, expect } from 'vitest';
import { Mixture } from '../../src/engine/mixture';

describe('Mixture model', () => {
  it('initializes with default 298.15 K and empty moles', () => {
    const m = new Mixture();
    expect(m.tempK).toBeCloseTo(298.15, 2);
    expect(m.volumeL).toBe(0);
    expect(m.totalMass()).toBe(0);
    expect(m.heatCapacity()).toBe(0);
  });

  it('adds species moles and computes totalMass and heatCapacity accurately', () => {
    const m = new Mixture();
    m.add('H2', 2); // 2 * 2.016 = 4.032 g
    m.add('O2', 1); // 1 * 31.998 = 31.998 g
    expect(m.moles.H2).toBe(2);
    expect(m.moles.O2).toBe(1);
    expect(m.totalMass()).toBeCloseTo(36.03, 2);
    // Cp: 2 * 28.84 + 1 * 29.38 = 87.06 J/K
    expect(m.heatCapacity()).toBeCloseTo(87.06, 2);
  });

  it('updates volumeL when liquid species are added if volumeL was not preset', () => {
    const m = new Mixture();
    m.add('H2O', 55.509); // ~1000 g = 1.0 L
    expect(m.volumeL).toBeCloseTo(1.0, 2);
  });

  it('rejects zero, negative, NaN, or unknown species on add()', () => {
    const m = new Mixture();
    expect(() => m.add('HCl', 0)).toThrow();
    expect(() => m.add('HCl', -0.5)).toThrow();
    expect(() => m.add('HCl', Number.NaN)).toThrow();
    expect(() => m.add('UNKNOWN_SPECIES', 1)).toThrow();
    expect(m.moles.HCl).toBeUndefined();
  });
});
