import { describe, it, expect } from 'vitest';
import { SPECIES } from '../../src/engine/data/species';

const ATOMIC_MASSES: Record<string, number> = {
  H: 1.008,
  He: 4.0026,
  Li: 6.94,
  Be: 9.0122,
  B: 10.81,
  C: 12.011,
  N: 14.007,
  O: 15.999,
  F: 18.998,
  Ne: 20.180,
  Na: 22.990,
  Mg: 24.305,
  Al: 26.982,
  Si: 28.085,
  P: 30.974,
  S: 32.06,
  Cl: 35.45,
  Ar: 39.948,
  K: 39.098,
  Ca: 40.078,
  Ti: 47.867,
  Cr: 51.996,
  Mn: 54.938,
  Fe: 55.845,
  Co: 58.933,
  Ni: 58.693,
  Cu: 63.546,
  Zn: 65.38,
  Br: 79.904,
  Ag: 107.868,
  Sn: 118.71,
  I: 126.904,
  Ba: 137.327,
  Pt: 195.084,
  Au: 196.967,
  Hg: 200.59,
  Pb: 207.2,
};

function computeFormulaMass(formula: string): number {
  const cleaned = formula.replace(/\((?:g|l|s|aq)\)$/i, '').replace(/[\^+-]\d*[+-]?$/, '');

  function parseSegment(seg: string): Record<string, number> {
    const counts: Record<string, number> = {};
    let i = 0;
    while (i < seg.length) {
      if (seg[i] === '(') {
        let depth = 0;
        const start = i + 1;
        while (i < seg.length) {
          if (seg[i] === '(') depth++;
          else if (seg[i] === ')') {
            depth--;
            if (depth === 0) break;
          }
          i++;
        }
        const inner = parseSegment(seg.slice(start, i));
        i++; // skip ')'
        let numStr = '';
        while (i < seg.length && /\d/.test(seg[i])) {
          numStr += seg[i++];
        }
        const mult = numStr ? parseInt(numStr, 10) : 1;
        for (const [el, c] of Object.entries(inner)) {
          counts[el] = (counts[el] ?? 0) + c * mult;
        }
      } else if (/[A-Z]/.test(seg[i])) {
        let el = seg[i++];
        while (i < seg.length && /[a-z]/.test(seg[i])) {
          el += seg[i++];
        }
        let numStr = '';
        while (i < seg.length && /\d/.test(seg[i])) {
          numStr += seg[i++];
        }
        const mult = numStr ? parseInt(numStr, 10) : 1;
        counts[el] = (counts[el] ?? 0) + mult;
      } else {
        throw new Error(`Unexpected character '${seg[i]}' in formula '${formula}'`);
      }
    }
    return counts;
  }

  const atoms = parseSegment(cleaned);
  let total = 0;
  for (const [el, count] of Object.entries(atoms)) {
    const mass = ATOMIC_MASSES[el];
    if (mass === undefined) {
      throw new Error(`Unknown element '${el}' in formula '${formula}'`);
    }
    total += mass * count;
  }
  return total;
}

describe('SPECIES dataset', () => {
  const entries = Object.values(SPECIES);

  it('contains at least 60 species', () => {
    expect(entries.length).toBeGreaterThanOrEqual(60);
  });

  it('includes all required baseline species from spec', () => {
    const requiredIds = [
      'H2', 'O2', 'N2', 'CO2', 'Cl2', 'NH3', 'CH4',
      'HCl', 'H2SO4', 'HNO3', 'CH3COOH',
      'NaOH', 'KOH', 'NH3(aq)',
      'Na', 'Mg', 'Zn', 'Fe', 'Cu',
      'C2H5OH', 'C6H12O6', 'H2O',
    ];
    for (const id of requiredIds) {
      expect(SPECIES[id], `Missing required species ${id}`).toBeDefined();
    }
  });

  it('has molarMass matching sum of atomic masses from formula within 0.05 g/mol for every species', () => {
    for (const [key, sp] of Object.entries(SPECIES)) {
      expect(sp.id).toBe(key);
      const expectedMass = computeFormulaMass(sp.formula);
      const diff = Math.abs(sp.molarMass - expectedMass);
      expect(
        diff,
        `Species ${sp.id} (${sp.formula}): stored molarMass ${sp.molarMass} differs from computed ${expectedMass.toFixed(4)} by ${diff.toFixed(4)}`
      ).toBeLessThanOrEqual(0.05);
    }
  });

  it('has liquid water dHf equal to -285.8 (±0.5) kJ/mol', () => {
    const h2o = SPECIES['H2O'];
    expect(h2o).toBeDefined();
    expect(h2o.phase).toBe('l');
    expect(Math.abs(h2o.dHf - -285.8)).toBeLessThanOrEqual(0.5);
  });

  it('has a valid non-empty source for every entry', () => {
    for (const sp of entries) {
      expect(typeof sp.source).toBe('string');
      expect(sp.source.trim().length, `Missing source on ${sp.id}`).toBeGreaterThan(0);
      expect(sp.source).toMatch(/NIST|PubChem|CRC/i);
    }
  });

  it('includes NaBH4 (molar mass 37.83 ±0.05), NaBO2, H3BO3 (pKa 9.24), acetone, and isopropanol', () => {
    const nabh4 = SPECIES['NaBH4'];
    expect(nabh4).toBeDefined();
    expect(nabh4.phase).toBe('s');
    expect(Math.abs(nabh4.molarMass - 37.83)).toBeLessThanOrEqual(0.05);

    const nabo2 = SPECIES['NaBO2'];
    expect(nabo2).toBeDefined();
    expect(nabo2.phase).toBe('aq');

    const h3bo3 = SPECIES['H3BO3'];
    expect(h3bo3).toBeDefined();
    expect(h3bo3.phase).toBe('aq');
    const pKa = -Math.log10(h3bo3.ka!);
    expect(pKa).toBeCloseTo(9.24, 2);

    expect(SPECIES['CH3COCH3']).toBeDefined();
    expect(SPECIES['C3H8O']).toBeDefined();
  });

  it('includes PROPIOPHENONE (molar mass 134.18 ±0.05) and PHENYLPROPANOL (molar mass 136.19 ±0.05) with estimated fields', () => {
    const propio = SPECIES['PROPIOPHENONE'];
    expect(propio).toBeDefined();
    expect(propio.phase).toBe('l');
    expect(Math.abs(propio.molarMass - 134.18)).toBeLessThanOrEqual(0.05);
    expect(propio.dHf).toBeCloseTo(-167.2, 1);
    expect(propio.estimated).toEqual(['S', 'Cp']);

    const phenyl = SPECIES['PHENYLPROPANOL'];
    expect(phenyl).toBeDefined();
    expect(phenyl.phase).toBe('l');
    expect(Math.abs(phenyl.molarMass - 136.19)).toBeLessThanOrEqual(0.05);
    expect(phenyl.estimated).toEqual(['dHf', 'S', 'Cp']);
  });
});
