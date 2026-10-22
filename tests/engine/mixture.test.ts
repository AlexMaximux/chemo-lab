import { describe, it, expect } from 'vitest';
import { Mixture } from '../../src/engine/mixture';
import { SPECIES } from '../../src/engine/data/species';

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

  it('models aqueous solvent water mass (0.997 g/mL) and heat capacity (75.3 J/mol/K) so 100 mL aqueous solution is within 5% of 100 g', () => {
    const m = new Mixture({ volumeL: 0.1 }); // 100 mL aqueous solution
    m.add('HCl', 0.05);
    m.add('NaOH', 0.05);

    expect(m.solventWaterMass()).toBeCloseTo(99.7, 2);
    const totalMass = m.totalMass();
    expect(Math.abs(totalMass - 100.0)).toBeLessThanOrEqual(5.0);
    expect(m.heatCapacity()).toBeGreaterThan(400.0);
  });

  it('counts liquid ethanol solvent mass, volume, and Cp in totalMass() and heatCapacity(), conserving atoms', () => {
    const m = new Mixture();
    const ethVolML = 20;
    const ethDensity = SPECIES.C2H5OH.density!; // 0.789 g/mL
    const ethMassG = ethVolML * ethDensity; // 15.78 g
    const ethMoles = ethMassG / SPECIES.C2H5OH.molarMass; // ~0.3425 mol

    m.add('C2H5OH', ethMoles);
    m.add('PROPIOPHENONE', 0.004);
    m.add('NaBH4', 0.001);
    m.add('H2O', 0.002);

    expect(m.volumeL).toBeGreaterThan(0.02);
    expect(m.totalMass()).toBeCloseTo(ethMassG + 0.004 * 134.18 + 0.001 * 37.83 + 0.002 * 18.015, 3);
    const expectedCp =
      ethMoles * SPECIES.C2H5OH.Cp +
      0.004 * SPECIES.PROPIOPHENONE.Cp +
      0.001 * SPECIES.NaBH4.Cp +
      0.002 * SPECIES.H2O.Cp;
    expect(m.heatCapacity()).toBeCloseTo(expectedCp, 2);

    const atoms = m.totalAtoms();
    expect(atoms.C).toBeCloseTo(2 * ethMoles + 9 * 0.004, 5);
    expect(atoms.H).toBeCloseTo(6 * ethMoles + 10 * 0.004 + 4 * 0.001 + 2 * 0.002, 5);
    expect(atoms.O).toBeCloseTo(1 * ethMoles + 1 * 0.004 + 1 * 0.002, 5);
    expect(atoms.Na).toBeCloseTo(0.001, 5);
    expect(atoms.B).toBeCloseTo(0.001, 5);
  });
});
