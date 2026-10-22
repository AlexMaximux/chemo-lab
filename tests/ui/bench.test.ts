import { describe, it, expect } from 'vitest';
import {
  createVessel,
  calculatePourAmount,
  pourChemical,
  transferBetweenVessels,
  blendMixtureColor,
  formatFormula,
  formatReactionEquation,
  getSpeciesCategory,
  getPrecipitateInfo,
} from '../../src/ui/equipment';
import { SPECIES } from '../../src/engine/data/species';

describe('UI Equipment & Bench Logic (pour math, overflow clamp, transfers)', () => {
  it('calculates moles and volume accurately for liquid, aqueous, solid, and gas pours', () => {
    // 10 mL of liquid water (density 1.0 g/mL, MM 18.015 g/mol) -> 10 g -> ~0.5551 mol, 0.01 L
    const waterPour = calculatePourAmount('H2O', 10, 'mL');
    expect(waterPour.volumeL).toBeCloseTo(0.01, 5);
    expect(waterPour.moles).toBeCloseTo(10 / 18.015, 3);

    // 10 mL of 1.0 M HCl (aq) -> 0.01 mol, 0.01 L
    const hclPour = calculatePourAmount('HCl', 10, 'mL', { molarity: 1.0 });
    expect(hclPour.volumeL).toBeCloseTo(0.01, 5);
    expect(hclPour.moles).toBeCloseTo(0.01, 5);

    // 1 g of solid Mg (MM 24.305 g/mol) -> ~0.04114 mol
    const mgPour = calculatePourAmount('Mg', 1, 'g');
    expect(mgPour.moles).toBeCloseTo(1 / 24.305, 4);
    expect(mgPour.volumeL).toBeGreaterThan(0);

    // 2 mol of H2 gas -> 2 mol, 0 L liquid volume
    const h2Pour = calculatePourAmount('H2', 2, 'mol');
    expect(h2Pour.moles).toBeCloseTo(2.0, 5);
    expect(h2Pour.volumeL).toBe(0);
  });

  it('clamps vessel volume to capacityL on overflow and never produces negative volume', () => {
    // Test tube has 50 mL (0.05 L) capacity
    const tube = createVessel('test_tube', 100, 100);
    expect(tube.capacityL).toBeCloseTo(0.05, 5);

    // Pour 30 mL of H2O -> fits without overflow
    const r1 = pourChemical(tube, 'H2O', 30, 'mL');
    expect(r1.overflowed).toBe(false);
    expect(tube.mixture.volumeL).toBeCloseTo(0.03, 4);

    // Pour another 40 mL of H2O -> exceeds 50 mL capacity, clamps at 0.05 L
    const r2 = pourChemical(tube, 'H2O', 40, 'mL');
    expect(r2.overflowed).toBe(true);
    expect(r2.addedVolumeL).toBeCloseTo(0.02, 4);
    expect(r2.overflowVolumeL).toBeCloseTo(0.02, 4);
    expect(tube.mixture.volumeL).toBeCloseTo(0.05, 4);
    expect(tube.overflowWarning).toBe(true);

    // Pouring more into an already full vessel adds 0 and stays at 0.05 L
    const r3 = pourChemical(tube, 'HCl', 10, 'mL');
    expect(r3.overflowed).toBe(true);
    expect(r3.addedMoles).toBe(0);
    expect(tube.mixture.volumeL).toBeCloseTo(0.05, 4);
    expect(tube.mixture.volumeL).toBeGreaterThanOrEqual(0);
  });

  it('ignores zero or negative pour amounts with a message and leaves vessel unchanged', () => {
    const beaker = createVessel('beaker', 200, 200);
    const rZero = pourChemical(beaker, 'HCl', 0, 'mL');
    expect(rZero.ignored).toBe(true);
    expect(rZero.addedMoles).toBe(0);
    expect(rZero.message).toMatch(/greater than zero|positive/i);
    expect(beaker.mixture.volumeL).toBe(0);

    const rNeg = pourChemical(beaker, 'NaOH', -10, 'mL');
    expect(rNeg.ignored).toBe(true);
    expect(rNeg.addedMoles).toBe(0);
    expect(beaker.mixture.volumeL).toBe(0);
  });

  it('ignores pouring from an empty vessel and clamps when transferring into a smaller vessel', () => {
    const emptyBeaker = createVessel('beaker', 100, 100);
    const targetTube = createVessel('test_tube', 200, 100); // 50 mL max

    const emptyTransfer = transferBetweenVessels(emptyBeaker, targetTube, 20);
    expect(emptyTransfer.ignored).toBe(true);
    expect(emptyTransfer.transferredMoles).toBe(0);
    expect(emptyTransfer.message).toMatch(/empty/i);

    // Fill beaker with 100 mL of 1.0 M NaOH
    pourChemical(emptyBeaker, 'NaOH', 100, 'mL', { molarity: 1.0 });
    expect(emptyBeaker.mixture.volumeL).toBeCloseTo(0.1, 4);

    // Transfer 80 mL into 50 mL test tube -> clamps at 50 mL (0.05 L)
    const clampedTransfer = transferBetweenVessels(emptyBeaker, targetTube, 80);
    expect(clampedTransfer.overflowed).toBe(true);
    expect(clampedTransfer.transferredVolumeL).toBeCloseTo(0.05, 4);
    expect(targetTube.mixture.volumeL).toBeCloseTo(0.05, 4);
    expect(targetTube.mixture.moles.NaOH).toBeCloseTo(0.05, 4);
    // Source beaker retains remaining 50 mL
    expect(emptyBeaker.mixture.volumeL).toBeCloseTo(0.05, 4);
    expect(emptyBeaker.mixture.moles.NaOH).toBeCloseTo(0.05, 4);
  });

  it('blends mixture colors from constituent species', () => {
    const beaker = createVessel('beaker', 100, 100);
    pourChemical(beaker, 'H2O', 50, 'mL');
    const waterColor = blendMixtureColor(beaker.mixture);
    expect(waterColor).toMatch(/^rgba?\(/);

    pourChemical(beaker, 'CuSO4', 50, 'mL', { molarity: 1.0 });
    const copperColor = blendMixtureColor(beaker.mixture);
    expect(copperColor).not.toBe(waterColor);
  });

  it('formats chemical formulas and reaction equations and categorizes all 60+ species', () => {
    expect(formatFormula('H2SO4')).toBe('H₂SO₄');
    expect(formatFormula('Ca(OH)2')).toBe('Ca(OH)₂');

    const eq = formatReactionEquation('h2_o2_water');
    expect(eq).toContain('2 H₂(g) + O₂(g) → 2 H₂O(l)');
    expect(eq).toContain('ΔH = -571.7 kJ/mol');

    const speciesList = Object.values(SPECIES);
    expect(speciesList.length).toBeGreaterThanOrEqual(60);
    for (const sp of speciesList) {
      const cat = getSpeciesCategory(sp);
      expect(['gases', 'acids', 'bases', 'salts', 'metals', 'organics', 'liquids_oxides']).toContain(cat);
    }

    const beaker = createVessel('beaker', 100, 100);
    pourChemical(beaker, 'AgCl', 1.0, 'g');
    const precip = getPrecipitateInfo(beaker.mixture);
    expect(precip.massG).toBeCloseTo(1.0, 3);
    expect(precip.formulas).toContain('AgCl');
  });
});
