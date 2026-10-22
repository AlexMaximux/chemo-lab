import { describe, it, expect } from 'vitest';
import { SPECIES } from '../../src/engine/data/species';
import { REACTIONS } from '../../src/engine/data/reactions';
import { parseFormula, parseCharge } from '../../src/engine/formula';

describe('parseFormula', () => {
  it('parses simple and organic formulas with repeated elements', () => {
    expect(parseFormula('H2O')).toEqual({ H: 2, O: 1 });
    expect(parseFormula('CH3COOH')).toEqual({ C: 2, H: 4, O: 2 });
    expect(parseFormula('C2H5OH')).toEqual({ C: 2, H: 6, O: 1 });
    expect(parseFormula('C6H12O6')).toEqual({ C: 6, H: 12, O: 6 });
  });

  it('parses parenthesized groups', () => {
    expect(parseFormula('Ca(OH)2')).toEqual({ Ca: 1, O: 2, H: 2 });
    expect(parseFormula('Al2(SO4)3')).toEqual({ Al: 2, S: 3, O: 12 });
    expect(parseFormula('(NH4)2SO4')).toEqual({ N: 2, H: 8, S: 1, O: 4 });
  });

  it('handles phase suffixes and ionic charges cleanly', () => {
    expect(parseFormula('NH3(aq)')).toEqual({ N: 1, H: 3 });
    expect(parseFormula('H2O(g)')).toEqual({ H: 2, O: 1 });
  });
});

describe('REACTIONS table', () => {
  it('contains at least 40 reactions', () => {
    expect(REACTIONS.length).toBeGreaterThanOrEqual(40);
  });

  it('has unique reaction IDs and valid species references', () => {
    const ids = new Set<string>();
    for (const rxn of REACTIONS) {
      expect(ids.has(rxn.id), `Duplicate reaction ID: ${rxn.id}`).toBe(false);
      ids.add(rxn.id);

      expect(Object.keys(rxn.reactants).length).toBeGreaterThan(0);
      expect(Object.keys(rxn.products).length).toBeGreaterThan(0);

      for (const [spId, coeff] of Object.entries(rxn.reactants)) {
        expect(SPECIES[spId], `Unknown reactant ${spId} in ${rxn.id}`).toBeDefined();
        expect(coeff).toBeGreaterThan(0);
      }
      for (const [spId, coeff] of Object.entries(rxn.products)) {
        expect(SPECIES[spId], `Unknown product ${spId} in ${rxn.id}`).toBeDefined();
        expect(coeff).toBeGreaterThan(0);
      }
    }
  });

  it('is atom-balanced and charge-balanced for every reaction', () => {
    for (const rxn of REACTIONS) {
      const reactantAtoms: Record<string, number> = {};
      const productAtoms: Record<string, number> = {};
      let reactantCharge = 0;
      let productCharge = 0;

      for (const [spId, coeff] of Object.entries(rxn.reactants)) {
        const sp = SPECIES[spId];
        const atoms = parseFormula(sp.formula);
        for (const [el, count] of Object.entries(atoms)) {
          reactantAtoms[el] = (reactantAtoms[el] ?? 0) + count * coeff;
        }
        reactantCharge += parseCharge(sp.formula) * coeff;
      }

      for (const [spId, coeff] of Object.entries(rxn.products)) {
        const sp = SPECIES[spId];
        const atoms = parseFormula(sp.formula);
        for (const [el, count] of Object.entries(atoms)) {
          productAtoms[el] = (productAtoms[el] ?? 0) + count * coeff;
        }
        productCharge += parseCharge(sp.formula) * coeff;
      }

      expect(
        productAtoms,
        `Atom imbalance in reaction ${rxn.id}: reactants=${JSON.stringify(reactantAtoms)}, products=${JSON.stringify(productAtoms)}`
      ).toEqual(reactantAtoms);

      expect(
        productCharge,
        `Charge imbalance in reaction ${rxn.id}: reactants=${reactantCharge}, products=${productCharge}`
      ).toBe(reactantCharge);
    }
  });

  it('satisfies Hess law within 1 kJ/mol for every reaction', () => {
    for (const rxn of REACTIONS) {
      let sumReactants = 0;
      let sumProducts = 0;

      for (const [spId, coeff] of Object.entries(rxn.reactants)) {
        sumReactants += SPECIES[spId].dHf * coeff;
      }
      for (const [spId, coeff] of Object.entries(rxn.products)) {
        sumProducts += SPECIES[spId].dHf * coeff;
      }

      const expectedDH = sumProducts - sumReactants;
      const diff = Math.abs(rxn.dH - expectedDH);
      expect(
        diff,
        `Hess law mismatch in ${rxn.id}: stored dH=${rxn.dH}, computed=${expectedDH.toFixed(2)} (diff=${diff.toFixed(2)})`
      ).toBeLessThanOrEqual(1.0);
    }
  });

  it('contains at least 8 hazardous reactions', () => {
    const hazardous = REACTIONS.filter((r) => Array.isArray(r.hazard) && r.hazard.length > 0);
    expect(hazardous.length).toBeGreaterThanOrEqual(8);
  });

  it('has a valid source for every reaction', () => {
    for (const rxn of REACTIONS) {
      expect(typeof rxn.source).toBe('string');
      expect(rxn.source.trim().length, `Missing source on ${rxn.id}`).toBeGreaterThan(0);
      expect(rxn.source).toMatch(/NIST|PubChem|CRC/i);
    }
  });

  it('includes all required benchmark reactions', () => {
    // 1. 2H2 + O2 -> 2H2O (ignition, Ea ~ 75 kJ/mol)
    const h2oRxn = REACTIONS.find(
      (r) => r.reactants.H2 === 2 && r.reactants.O2 === 1 && r.products.H2O === 2
    );
    expect(h2oRxn, 'Missing 2H2 + O2 -> 2H2O').toBeDefined();
    expect(h2oRxn?.conditions.ignition).toBe(true);
    expect(h2oRxn?.Ea).toBeGreaterThanOrEqual(65);
    expect(h2oRxn?.Ea).toBeLessThanOrEqual(85);

    // 2. HCl + NaOH -> NaCl + H2O
    const neutRxn = REACTIONS.find(
      (r) => r.reactants.HCl === 1 && r.reactants.NaOH === 1 && r.products.NaCl === 1 && r.products.H2O === 1
    );
    expect(neutRxn, 'Missing HCl + NaOH neutralization').toBeDefined();

    // 3. Mg + 2HCl -> MgCl2 + H2
    const mgHcl = REACTIONS.find(
      (r) => r.reactants.Mg === 1 && r.reactants.HCl === 2 && r.products.MgCl2 === 1 && r.products.H2 === 1
    );
    expect(mgHcl, 'Missing Mg + 2HCl').toBeDefined();

    // 4. CH4 + 2O2 -> CO2 + 2H2O
    const ch4Comb = REACTIONS.find(
      (r) => r.reactants.CH4 === 1 && r.reactants.O2 === 2 && r.products.CO2 === 1
    );
    expect(ch4Comb, 'Missing CH4 + 2O2').toBeDefined();

    // 5. NaHCO3 + CH3COOH -> CH3COONa + H2O + CO2
    const bicarbVinegar = REACTIONS.find(
      (r) => r.reactants.NaHCO3 === 1 && r.reactants.CH3COOH === 1 && r.products.CO2 === 1
    );
    expect(bicarbVinegar, 'Missing NaHCO3 + CH3COOH').toBeDefined();

    // 6. Zn + H2SO4 -> ZnSO4 + H2
    const znAcid = REACTIONS.find(
      (r) => r.reactants.Zn === 1 && r.reactants.H2SO4 === 1 && r.products.ZnSO4 === 1 && r.products.H2 === 1
    );
    expect(znAcid, 'Missing Zn + H2SO4').toBeDefined();

    // 7. 2Na + 2H2O -> 2NaOH + H2 (hazard)
    const naWater = REACTIONS.find(
      (r) => r.reactants.Na && r.reactants.H2O && r.products.NaOH && r.products.H2
    );
    expect(naWater, 'Missing Na + H2O').toBeDefined();
    expect(naWater?.hazard?.length).toBeGreaterThan(0);

    // 8. NaOCl + NH3 -> NH2Cl + NaOH (toxic chloramine)
    const bleachAmmonia = REACTIONS.find(
      (r) => r.reactants.NaOCl && (r.reactants.NH3 || r.reactants['NH3(aq)']) && r.products.NH2Cl
    );
    expect(bleachAmmonia, 'Missing NaOCl + NH3 chloramine reaction').toBeDefined();
    expect(bleachAmmonia?.hazard?.length).toBeGreaterThan(0);

    // 9. H2 + Cl2 -> 2HCl(g) or 2HCl (hazard)
    const h2Cl2 = REACTIONS.find(
      (r) => r.reactants.H2 === 1 && r.reactants.Cl2 === 1
    );
    expect(h2Cl2, 'Missing H2 + Cl2').toBeDefined();
    expect(h2Cl2?.hazard?.length).toBeGreaterThan(0);

    // 10. NaBH4 reactions: neutral hydrolysis, acid hydrolysis, and acetone reduction
    const nabh4Water = REACTIONS.find((r) => r.id === 'nabh4_h2o_hydrolysis');
    expect(nabh4Water).toBeDefined();
    expect(nabh4Water?.products.H2).toBe(4);

    const nabh4Acid = REACTIONS.find((r) => r.id === 'nabh4_hcl_hydrolysis');
    expect(nabh4Acid).toBeDefined();
    expect(nabh4Acid?.products.H2).toBe(4);
    expect(nabh4Acid?.products.H3BO3).toBe(1);

    const acetoneRed = REACTIONS.find((r) => r.id === 'acetone_nabh4_reduction');
    expect(acetoneRed).toBeDefined();
    expect(acetoneRed?.reactants.CH3COCH3).toBe(4);
    expect(acetoneRed?.products.C3H8O).toBe(4);
  });
});
