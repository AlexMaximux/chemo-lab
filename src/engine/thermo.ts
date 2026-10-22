import { SPECIES } from './data/species';
import { Mixture } from './mixture';
import { Reaction } from './types';

export const R_GAS = 8.314462618; // J/(mol*K) = L*kPa/(mol*K)

export function idealGasPressure(m: Mixture, vesselL: number): number {
  if (!Number.isFinite(vesselL) || vesselL <= 0) {
    throw new Error(`Invalid vessel volume: ${vesselL}`);
  }
  let gasMoles = 0;
  for (const [id, n] of Object.entries(m.moles)) {
    if (n <= 0) continue;
    const sp = SPECIES[id];
    if (sp && sp.phase === 'g') {
      gasMoles += n;
    }
  }
  if (gasMoles <= 0) {
    return 0;
  }
  return (gasMoles * R_GAS * m.tempK) / vesselL;
}

export function reactionEnthalpy(rxn: Reaction): number {
  let sumReactants = 0;
  let sumProducts = 0;
  for (const [id, coeff] of Object.entries(rxn.reactants)) {
    const sp = SPECIES[id];
    if (sp) sumReactants += sp.dHf * coeff;
  }
  for (const [id, coeff] of Object.entries(rxn.products)) {
    const sp = SPECIES[id];
    if (sp) sumProducts += sp.dHf * coeff;
  }
  return sumProducts - sumReactants;
}

export function reactionEntropy(rxn: Reaction): number {
  let sumReactants = 0;
  let sumProducts = 0;
  for (const [id, coeff] of Object.entries(rxn.reactants)) {
    const sp = SPECIES[id];
    if (sp) sumReactants += sp.S * coeff;
  }
  for (const [id, coeff] of Object.entries(rxn.products)) {
    const sp = SPECIES[id];
    if (sp) sumProducts += sp.S * coeff;
  }
  return sumProducts - sumReactants;
}

export function reactionGibbsFreeEnergy(rxn: Reaction, tempK = 298.15): number {
  const dH = rxn.dH; // kJ/mol
  const dS = reactionEntropy(rxn); // J/(mol*K)
  return dH - (tempK * dS) / 1000.0;
}

export function isSpontaneous(rxn: Reaction, tempK = 298.15): boolean {
  return reactionGibbsFreeEnergy(rxn, tempK) < 0;
}
