import { describe, it, expect } from 'vitest';
import { Mixture } from '../../src/engine/mixture';
import {
  idealGasPressure,
  reactionEnthalpy,
  reactionEntropy,
  reactionGibbsFreeEnergy,
  isSpontaneous,
} from '../../src/engine/thermo';
import { REACTIONS } from '../../src/engine/data/reactions';

describe('Thermodynamics and Ideal Gas Law', () => {
  it('computes 101.325 kPa (±0.1) for 1 mol ideal gas at 273.15 K in 22.414 L', () => {
    const m = new Mixture();
    m.tempK = 273.15;
    m.add('N2', 1.0);
    const p = idealGasPressure(m, 22.414);
    expect(Math.abs(p - 101.325)).toBeLessThanOrEqual(0.1);
  });

  it('ignores non-gaseous species when computing idealGasPressure', () => {
    const m = new Mixture();
    m.tempK = 273.15;
    m.add('H2O', 10.0); // liquid
    m.add('NaCl', 1.0); // aqueous
    expect(idealGasPressure(m, 10.0)).toBe(0);

    m.add('H2', 0.5);
    m.add('O2', 0.5);
    const p = idealGasPressure(m, 22.414);
    expect(Math.abs(p - 101.325)).toBeLessThanOrEqual(0.1);
  });

  it('computes dH, dS, dG and spontaneity for water formation', () => {
    const h2oRxn = REACTIONS.find((r) => r.id === 'h2_o2_water')!;
    expect(reactionEnthalpy(h2oRxn)).toBeCloseTo(-571.66, 1);
    expect(reactionEntropy(h2oRxn)).toBeLessThan(0);
    expect(reactionGibbsFreeEnergy(h2oRxn, 298.15)).toBeLessThan(-450);
    expect(isSpontaneous(h2oRxn, 298.15)).toBe(true);
  });
});
