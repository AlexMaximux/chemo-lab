import { describe, it, expect } from 'vitest';
import { Mixture } from '../../src/engine/mixture';
import { pH } from '../../src/engine/solution';

describe('Aqueous solutions and pH calculation', () => {
  it('gives pH 1.00 (±0.02) for 0.1 mol HCl in 1 L', () => {
    const m = new Mixture({ volumeL: 1.0 });
    m.add('HCl', 0.1);
    const val = pH(m);
    expect(Math.abs(val - 1.0)).toBeLessThanOrEqual(0.02);
  });

  it('gives pH 2.87 (±0.05) for 0.1 M acetic acid (Ka 1.8e-5)', () => {
    const m = new Mixture({ volumeL: 1.0 });
    m.add('CH3COOH', 0.1);
    const val = pH(m);
    expect(Math.abs(val - 2.87)).toBeLessThanOrEqual(0.05);
  });

  it('gives pH 7.0 (±0.1) for equal moles of NaOH + HCl', () => {
    const m = new Mixture({ volumeL: 1.0 });
    m.add('NaOH', 0.1);
    m.add('HCl', 0.1);
    const val = pH(m);
    expect(Math.abs(val - 7.0)).toBeLessThanOrEqual(0.1);
  });

  it('gives pH 13.00 (±0.02) for 0.1 M NaOH and ~11.13 for 0.1 M NH3(aq)', () => {
    const strongBase = new Mixture({ volumeL: 1.0 });
    strongBase.add('NaOH', 0.1);
    expect(Math.abs(pH(strongBase) - 13.0)).toBeLessThanOrEqual(0.02);

    const weakBase = new Mixture({ volumeL: 1.0 });
    weakBase.add('NH3(aq)', 0.1);
    expect(Math.abs(pH(weakBase) - 11.13)).toBeLessThanOrEqual(0.05);
  });
});
