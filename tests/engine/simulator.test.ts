import { describe, it, expect } from 'vitest';
import { Mixture } from '../../src/engine/mixture';
import { Simulator } from '../../src/engine/simulator';
import { SPECIES } from '../../src/engine/data/species';
import { parseFormula } from '../../src/engine/formula';

function totalAtoms(m: Mixture): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const [spId, moles] of Object.entries(m.moles)) {
    if (moles <= 0) continue;
    const sp = SPECIES[spId];
    const atoms = parseFormula(sp.formula);
    for (const [el, count] of Object.entries(atoms)) {
      totals[el] = (totals[el] ?? 0) + count * moles;
    }
  }
  return totals;
}

describe('Simulator (kinetics, limiting reagent, time stepping)', () => {
  it('keeps 2 mol H2 + 1 mol O2 unreacted over 60 s without ignition', () => {
    const m = new Mixture();
    m.add('H2', 2);
    m.add('O2', 1);
    const sim = new Simulator(m, { vesselL: 10, closed: true });

    const res = sim.step(60);
    expect(res.reactionsFired).toEqual([]);
    expect(m.moles.H2).toBeCloseTo(2, 5);
    expect(m.moles.O2).toBeCloseTo(1, 5);
    expect(m.moles.H2O ?? 0).toBe(0);
  });

  it('converts 2 mol H2 + 1 mol O2 fully to 2 mol H2O with ignite(), releasing ~571.6 kJ (±5)', () => {
    const m = new Mixture();
    m.add('H2', 2);
    m.add('O2', 1);
    const sim = new Simulator(m, { vesselL: 10, closed: true });

    sim.ignite();
    const res = sim.step(1.0);

    expect(res.reactionsFired).toContain('h2_o2_water');
    expect(m.moles.H2O).toBeCloseTo(2.0, 4);
    expect(m.moles.H2 ?? 0).toBeCloseTo(0, 4);
    expect(m.moles.O2 ?? 0).toBeCloseTo(0, 4);

    const releasedKJ = res.heatJ / 1000;
    expect(Math.abs(releasedKJ - 571.6)).toBeLessThanOrEqual(5.0);
  });

  it('respects limiting reagent: 3 mol H2 + 1 mol O2 ignites leaving 1 mol H2 and 2 mol H2O', () => {
    const m = new Mixture();
    m.add('H2', 3);
    m.add('O2', 1);
    const sim = new Simulator(m, { vesselL: 10, closed: true });

    sim.ignite();
    sim.step(1.0);

    expect(m.moles.H2).toBeCloseTo(1.0, 4);
    expect(m.moles.O2 ?? 0).toBeCloseTo(0, 4);
    expect(m.moles.H2O).toBeCloseTo(2.0, 4);
  });

  it('conserves atoms and total mass after every step across multi-reaction mixtures', () => {
    const m = new Mixture({ volumeL: 1.0 });
    m.add('Mg', 0.5);
    m.add('HCl', 1.5);
    m.add('NaOH', 0.5);
    m.add('O2', 0.25);

    const initialAtoms = totalAtoms(m);
    const initialMass = m.totalMass();

    const sim = new Simulator(m, { vesselL: 2.0 });
    sim.step(0.5);
    sim.ignite();
    sim.step(0.5);

    const finalAtoms = totalAtoms(m);
    for (const [el, count] of Object.entries(initialAtoms)) {
      expect(finalAtoms[el]).toBeCloseTo(count, 6);
    }
    expect(m.totalMass()).toBeCloseTo(initialMass, 3);
  });

  it('releases ~57 kJ/mol and raises temperature on NaOH + HCl neutralization', () => {
    const m = new Mixture({ volumeL: 1.0 });
    m.add('NaOH', 1.0);
    m.add('HCl', 1.0);
    const initialTemp = m.tempK;

    const sim = new Simulator(m, { vesselL: 2.0 });
    const res = sim.step(1.0);

    expect(res.reactionsFired).toContain('hcl_naoh');
    const releasedKJ = res.heatJ / 1000;
    expect(Math.abs(releasedKJ - 57.0)).toBeLessThanOrEqual(2.0);
    expect(res.tempK).toBeGreaterThan(initialTemp);
    expect(m.tempK).toBeGreaterThan(initialTemp);
  });

  it('yields empty reactionsFired when mixing unrelated species (NaCl + N2)', () => {
    const m = new Mixture({ volumeL: 1.0 });
    m.add('NaCl', 1.0);
    m.add('N2', 1.0);

    const sim = new Simulator(m, { vesselL: 5.0 });
    const res = sim.step(5.0);

    expect(res.reactionsFired).toEqual([]);
    expect(res.heatJ).toBe(0);
    expect(m.moles.NaCl).toBe(1.0);
    expect(m.moles.N2).toBe(1.0);
  });

  it('exceeds burst pressure and emits a burst hazard event when heating gas in a closed vessel', () => {
    const m = new Mixture();
    m.add('N2', 2.0); // 2 mol in 1 L at 298.15 K is ~495 kPa, or heat it further
    const sim = new Simulator(m, { vesselL: 1.0, closed: true });

    sim.heat(50000);
    const res = sim.step(0.1);

    expect(res.pressureKPa).toBeGreaterThan(300);
    expect(res.hazards).toContain('burst');
    expect(sim.events.some((e) => e.type === 'burst' || e.hazard === 'burst')).toBe(true);
  });

  it('flags toxic/explosive hazards for dangerous reactions (Na + H2O, NaOCl + NH3)', () => {
    const m1 = new Mixture({ volumeL: 1.0 });
    m1.add('Na', 0.2);
    m1.add('H2O', 10.0);
    const sim1 = new Simulator(m1, { vesselL: 2.0 });
    const res1 = sim1.step(1.0);
    expect(res1.reactionsFired).toContain('na_h2o');
    expect(res1.hazards).toContain('explosive');

    const m2 = new Mixture({ volumeL: 1.0 });
    m2.add('NaOCl', 0.5);
    m2.add('NH3', 0.5);
    const sim2 = new Simulator(m2, { vesselL: 2.0 });
    const res2 = sim2.step(1.0);
    expect(res2.reactionsFired).toContain('naocl_nh3_chloramine');
    expect(res2.hazards).toContain('toxic');
    expect(m2.moles.NH2Cl).toBeCloseTo(0.5, 4);
  });

  it('reaches partial equilibrium for reversible reactions when conditions are met', () => {
    const m = new Mixture();
    m.tempK = 650;
    m.add('N2', 1.0);
    m.add('H2', 3.0);
    m.add('Fe', 0.1); // catalyst
    const sim = new Simulator(m, { vesselL: 2.0, closed: true });
    const res = sim.step(2.0);
    expect(res.reactionsFired).toContain('haber_nh3_synthesis');
    expect(m.moles.NH3).toBeGreaterThan(0);
    expect(m.moles.NH3).toBeLessThan(2.0);
    expect(m.moles.N2).toBeGreaterThan(0);
  });
});
