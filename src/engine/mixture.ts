import { SPECIES } from './data/species';
import { parseFormula } from './formula';

export const WATER_DENSITY_25C = 0.997; // g/mL at 25 °C (997.0 g/L)
export const WATER_CP_J_PER_MOL_K = 75.3; // J/(mol·K) (~4.18 J/(g·K))

export interface MixtureOptions {
  volumeL?: number;
  tempK?: number;
}

export class Mixture {
  public moles: Record<string, number> = {};
  public volumeL: number = 0;
  public tempK: number = 298.15;
  public liquidVolumeAddedL: number = 0;
  public solidVolumeAddedL: number = 0;
  public hasAqueousSolvent: boolean = false;
  private explicitVolume = false;

  constructor(optsOrVolumeL?: number | MixtureOptions, tempK?: number) {
    if (typeof optsOrVolumeL === 'number') {
      if (optsOrVolumeL < 0 || !Number.isFinite(optsOrVolumeL)) {
        throw new Error(`Invalid volumeL: ${optsOrVolumeL}`);
      }
      this.volumeL = optsOrVolumeL;
      this.explicitVolume = optsOrVolumeL > 0;
      if (tempK !== undefined) {
        this.tempK = tempK;
      }
    } else if (optsOrVolumeL && typeof optsOrVolumeL === 'object') {
      if (optsOrVolumeL.volumeL !== undefined) {
        if (optsOrVolumeL.volumeL < 0 || !Number.isFinite(optsOrVolumeL.volumeL)) {
          throw new Error(`Invalid volumeL: ${optsOrVolumeL.volumeL}`);
        }
        this.volumeL = optsOrVolumeL.volumeL;
        this.explicitVolume = optsOrVolumeL.volumeL > 0;
      }
      if (optsOrVolumeL.tempK !== undefined) {
        this.tempK = optsOrVolumeL.tempK;
      }
    }
  }

  public reset(): void {
    this.moles = {};
    this.volumeL = 0;
    this.tempK = 298.15;
    this.liquidVolumeAddedL = 0;
    this.solidVolumeAddedL = 0;
    this.hasAqueousSolvent = false;
    this.explicitVolume = false;
  }

  public add(id: string, moles: number): void {
    const sp = SPECIES[id];
    if (!sp) {
      throw new Error(`Unknown species: '${id}'`);
    }
    if (!Number.isFinite(moles) || moles <= 0) {
      throw new Error(`Amount of '${id}' to add must be a positive finite number (got ${moles})`);
    }

    const wasEmpty =
      this.volumeL <= 1e-12 && Object.values(this.moles).every((n) => n <= 1e-12);
    if (wasEmpty) {
      this.liquidVolumeAddedL = 0;
      this.solidVolumeAddedL = 0;
      this.hasAqueousSolvent = false;
    }

    this.moles[id] = (this.moles[id] ?? 0) + moles;

    if (sp.phase === 'aq') {
      this.hasAqueousSolvent = true;
    } else if (sp.phase === 'l') {
      const densityGPerML = sp.density ?? 1.0;
      const massG = moles * sp.molarMass;
      const addedVolumeL = massG / (densityGPerML * 1000);
      this.liquidVolumeAddedL += addedVolumeL;
      if (!this.explicitVolume) {
        this.volumeL += addedVolumeL;
      }
    } else if (sp.phase === 's') {
      const densityGPerML = sp.density ?? 2.0;
      const massG = moles * sp.molarMass;
      const addedVolumeL = massG / (densityGPerML * 1000);
      this.solidVolumeAddedL += addedVolumeL;
    }
  }

  /**
   * Returns the aqueous solvent volume (L) not already accounted for by explicit liquid/solid additions.
   */
  public solventWaterVolumeL(): number {
    const hasAnyMoles = Object.values(this.moles).some((n) => n > 1e-12);
    if (this.volumeL <= 1e-12 || !hasAnyMoles) {
      return 0;
    }
    const hasAq =
      this.hasAqueousSolvent ||
      Object.entries(this.moles).some(([id, n]) => n > 1e-12 && SPECIES[id]?.phase === 'aq');
    if (!hasAq) {
      return 0;
    }
    return Math.max(0, this.volumeL - this.liquidVolumeAddedL - this.solidVolumeAddedL);
  }

  /**
   * Mass (g) of aqueous solvent water (volume * 0.997 g/mL at 25 °C) when aqueous species exist.
   */
  public solventWaterMass(): number {
    const aqVolL = this.solventWaterVolumeL();
    if (aqVolL <= 0) return 0;
    return aqVolL * WATER_DENSITY_25C * 1000.0;
  }

  /**
   * Moles of aqueous solvent water (H2O) present in the solution bath.
   */
  public solventWaterMoles(): number {
    const massG = this.solventWaterMass();
    if (massG <= 0) return 0;
    return massG / SPECIES.H2O.molarMass;
  }

  public totalMass(): number {
    let total = this.solventWaterMass();
    for (const [id, n] of Object.entries(this.moles)) {
      if (n <= 0) continue;
      const sp = SPECIES[id];
      if (sp) {
        total += n * sp.molarMass;
      }
    }
    return total;
  }

  public heatCapacity(): number {
    let cpTotal = this.solventWaterMoles() * WATER_CP_J_PER_MOL_K;
    for (const [id, n] of Object.entries(this.moles)) {
      if (n <= 0) continue;
      const sp = SPECIES[id];
      if (sp) {
        cpTotal += n * sp.Cp;
      }
    }
    return cpTotal;
  }

  /**
   * Returns total elemental atom counts in moles across all species plus aqueous solvent water.
   */
  public totalAtoms(): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const [spId, moles] of Object.entries(this.moles)) {
      if (moles <= 0) continue;
      const sp = SPECIES[spId];
      if (!sp) continue;
      const atoms = parseFormula(sp.formula);
      for (const [el, count] of Object.entries(atoms)) {
        totals[el] = (totals[el] ?? 0) + count * moles;
      }
    }
    const solventMoles = this.solventWaterMoles();
    if (solventMoles > 0) {
      totals.H = (totals.H ?? 0) + 2 * solventMoles;
      totals.O = (totals.O ?? 0) + 1 * solventMoles;
    }
    return totals;
  }
}
