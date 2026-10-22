import { SPECIES } from './data/species';

export interface MixtureOptions {
  volumeL?: number;
  tempK?: number;
}

export class Mixture {
  public moles: Record<string, number> = {};
  public volumeL: number = 0;
  public tempK: number = 298.15;
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

  public add(id: string, moles: number): void {
    const sp = SPECIES[id];
    if (!sp) {
      throw new Error(`Unknown species: '${id}'`);
    }
    if (!Number.isFinite(moles) || moles <= 0) {
      throw new Error(`Amount of '${id}' to add must be a positive finite number (got ${moles})`);
    }

    this.moles[id] = (this.moles[id] ?? 0) + moles;

    if (sp.phase === 'l' && !this.explicitVolume) {
      const densityGPerML = sp.density ?? 1.0;
      const massG = moles * sp.molarMass;
      const addedVolumeL = massG / (densityGPerML * 1000);
      this.volumeL += addedVolumeL;
    }
  }

  public totalMass(): number {
    let total = 0;
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
    let cpTotal = 0;
    for (const [id, n] of Object.entries(this.moles)) {
      if (n <= 0) continue;
      const sp = SPECIES[id];
      if (sp) {
        cpTotal += n * sp.Cp;
      }
    }
    return cpTotal;
  }
}
