import { SPECIES } from './data/species';
import { REACTIONS } from './data/reactions';
import { Mixture } from './mixture';
import { idealGasPressure, R_GAS } from './thermo';
import { LabEvent, Reaction, StepResult } from './types';

export type { LabEvent, StepResult };

export interface SimulatorOptions {
  vesselL?: number;
  closed?: boolean;
  burstPressureKPa?: number;
}

const DEFAULT_BURST_PRESSURE_KPA = 300.0; // ~3 atm for standard glass labware
const MAX_SUBSTEP_SECONDS = 0.05; // 50 ms fixed tick per spec
const EPSILON = 1e-12;

// Deterministic ordering: lower activation energy first, then alphabetical by id
const ORDERED_REACTIONS = [...REACTIONS].sort((a, b) => {
  if (a.Ea !== b.Ea) return a.Ea - b.Ea;
  return a.id.localeCompare(b.id);
});

export class Simulator {
  public readonly mixture: Mixture;
  public readonly m: Mixture;
  public vesselL: number;
  public closed: boolean;
  public burstPressureKPa: number;
  public events: LabEvent[] = [];

  private ignited = false;
  private hasThermalOrReaction = false;
  private elapsedSeconds = 0;
  private pendingHazards = new Set<string>();

  constructor(m: Mixture, opts?: SimulatorOptions) {
    this.mixture = m;
    this.m = m;
    this.vesselL = opts?.vesselL && opts.vesselL > 0 ? opts.vesselL : Math.max(1.0, m.volumeL || 1.0);
    this.closed = opts?.closed ?? false;
    this.burstPressureKPa = opts?.burstPressureKPa ?? DEFAULT_BURST_PRESSURE_KPA;
  }

  public ignite(): void {
    this.ignited = true;
    this.events.push({
      type: 'ignite',
      message: 'Ignition source applied to mixture',
      time: this.elapsedSeconds,
    });
  }

  public heat(joules: number): void {
    if (!Number.isFinite(joules) || joules === 0) {
      return;
    }
    this.hasThermalOrReaction = true;
    const cp = Math.max(this.mixture.heatCapacity(), 25.0);
    this.mixture.tempK = Math.max(1.0, this.mixture.tempK + joules / cp);

    this.events.push({
      type: 'heat',
      message: `Added ${joules.toFixed(1)} J of thermal energy (T = ${this.mixture.tempK.toFixed(2)} K)`,
      time: this.elapsedSeconds,
    });

    this.checkBurstPressure();
  }

  public resetState(): void {
    this.ignited = false;
    this.hasThermalOrReaction = false;
    this.pendingHazards.clear();
  }

  public step(dtSeconds: number): StepResult {
    const reactionsFiredSet = new Set<string>();
    const hazardsSet = new Set<string>(this.pendingHazards);
    this.pendingHazards.clear();

    let totalHeatJ = 0;

    if (Number.isFinite(dtSeconds) && dtSeconds > 0) {
      const hasReagents = Object.keys(this.mixture.moles).length > 0;
      if (!hasReagents) {
        this.elapsedSeconds += dtSeconds;
      } else {
        const numSubsteps = Math.max(1, Math.ceil(dtSeconds / MAX_SUBSTEP_SECONDS));
        const subDt = dtSeconds / numSubsteps;

        for (let s = 0; s < numSubsteps; s++) {
          this.elapsedSeconds += subDt;

          for (const rxn of ORDERED_REACTIONS) {
          if (!this.conditionsMet(rxn)) {
            continue;
          }

          const maxExtent = this.limitingExtent(rxn);
          if (maxExtent <= EPSILON) {
            continue;
          }

          const kRate = this.arrheniusRate(rxn, this.mixture.tempK);
          if (kRate <= 0) {
            continue;
          }

          let dXi = 0;
          if (!rxn.reversible) {
            // Irreversible reactions that overcome activation/ignition convert via limiting reagent
            const fraction = 1 - Math.exp(-kRate * subDt);
            dXi = fraction > 0.999 || this.ignited || rxn.Ea <= 45 ? maxExtent : maxExtent * fraction;
          } else {
            // Reversible reaction relaxes toward equilibrium constant keq
            const targetExtent = this.equilibriumExtent(rxn, maxExtent);
            const fraction = Math.min(1, 1 - Math.exp(-kRate * subDt));
            dXi = targetExtent * fraction;
          }

          if (dXi <= EPSILON) {
            continue;
          }

          this.applyReactionExtent(rxn, dXi);
          reactionsFiredSet.add(rxn.id);

          const rxnHeatJ = -rxn.dH * 1000.0 * dXi;
          totalHeatJ += rxnHeatJ;

          const cp = Math.max(this.mixture.heatCapacity(), 25.0);
          this.mixture.tempK = Math.max(1.0, this.mixture.tempK + rxnHeatJ / cp);

          this.events.push({
            type: 'reaction',
            reactionId: rxn.id,
            message: `Reaction ${rxn.id} advanced by ${dXi.toFixed(4)} mol`,
            time: this.elapsedSeconds,
          });

            if (rxn.hazard) {
              for (const h of rxn.hazard) {
                hazardsSet.add(h);
                this.events.push({
                  type: 'hazard',
                  reactionId: rxn.id,
                  hazard: h,
                  message: `Hazard warning (${h}) from reaction ${rxn.id}`,
                  time: this.elapsedSeconds,
                });
              }
            }
          }
        }
      }
    }

    if (reactionsFiredSet.size > 0) {
      this.ignited = false;
      this.hasThermalOrReaction = true;
    }

    const pressureKPa = this.checkBurstPressure(hazardsSet);

    return {
      reactionsFired: Array.from(reactionsFiredSet),
      heatJ: totalHeatJ,
      tempK: this.mixture.tempK,
      pressureKPa,
      hazards: Array.from(hazardsSet),
    };
  }

  private conditionsMet(rxn: Reaction): boolean {
    const { ignition, minTempK, catalyst } = rxn.conditions;

    if (catalyst) {
      if ((this.mixture.moles[catalyst] ?? 0) <= EPSILON) {
        return false;
      }
    }

    if (ignition) {
      const autoIgniteTemp = minTempK ?? 850.0;
      if (!this.ignited && this.mixture.tempK < autoIgniteTemp) {
        return false;
      }
    }

    if (minTempK !== undefined && !ignition) {
      if (this.mixture.tempK < minTempK && !this.ignited) {
        return false;
      }
    }

    return true;
  }

  private limitingExtent(rxn: Reaction): number {
    let minExtent = Infinity;
    for (const [spId, coeff] of Object.entries(rxn.reactants)) {
      const avail = this.mixture.moles[spId] ?? 0;
      if (avail <= EPSILON) {
        return 0;
      }
      const ext = avail / coeff;
      if (ext < minExtent) {
        minExtent = ext;
      }
    }
    return Number.isFinite(minExtent) ? minExtent : 0;
  }

  private arrheniusRate(rxn: Reaction, tempK: number): number {
    // Effective temperature accounts for local spark/ignition energy when ignited
    const effectiveTempK = this.ignited && rxn.conditions.ignition ? Math.max(tempK, 1500.0) : tempK;
    const preExponential = 1.0e9;
    const eaJoules = rxn.Ea * 1000.0;
    return preExponential * Math.exp(-eaJoules / (R_GAS * effectiveTempK));
  }

  private equilibriumExtent(rxn: Reaction, maxExtent: number): number {
    const keq = rxn.keq ?? 1.0;
    const vol = Math.max(this.vesselL, this.mixture.volumeL, 1.0);

    const quotientAt = (xi: number): number => {
      let num = 1.0;
      let den = 1.0;
      for (const [pId, coeff] of Object.entries(rxn.products)) {
        const n = Math.max(EPSILON, (this.mixture.moles[pId] ?? 0) + coeff * xi);
        num *= Math.pow(n / vol, coeff);
      }
      for (const [rId, coeff] of Object.entries(rxn.reactants)) {
        const n = Math.max(EPSILON, (this.mixture.moles[rId] ?? 0) - coeff * xi);
        den *= Math.pow(n / vol, coeff);
      }
      return num / den;
    };

    let lo = 0;
    let hi = maxExtent;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (quotientAt(mid) < keq) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return 0.5 * (lo + hi);
  }

  private applyReactionExtent(rxn: Reaction, dXi: number): void {
    for (const [rId, coeff] of Object.entries(rxn.reactants)) {
      const next = (this.mixture.moles[rId] ?? 0) - coeff * dXi;
      if (next <= EPSILON) {
        delete this.mixture.moles[rId];
      } else {
        this.mixture.moles[rId] = next;
      }
    }

    for (const [pId, coeff] of Object.entries(rxn.products)) {
      const added = coeff * dXi;
      this.mixture.moles[pId] = (this.mixture.moles[pId] ?? 0) + added;
      const sp = SPECIES[pId];
      if (sp && sp.phase === 'l' && this.mixture.volumeL === 0) {
        const density = sp.density ?? 1.0;
        const addedVolL = (added * sp.molarMass) / (density * 1000.0);
        this.mixture.volumeL += addedVolL;
        this.mixture.liquidVolumeAddedL += addedVolL;
      }
    }
  }

  private checkBurstPressure(hazardsSet?: Set<string>): number {
    const pressureKPa = idealGasPressure(this.mixture, this.vesselL);
    if (this.closed && this.hasThermalOrReaction && pressureKPa > this.burstPressureKPa) {
      if (hazardsSet) {
        hazardsSet.add('burst');
      } else {
        this.pendingHazards.add('burst');
      }
      const alreadyLogged = this.events.some((e) => e.type === 'burst' || e.hazard === 'burst');
      if (!alreadyLogged) {
        this.events.push({
          type: 'burst',
          hazard: 'burst',
          message: `Vessel burst! Internal gas pressure (${pressureKPa.toFixed(1)} kPa) exceeded limit (${this.burstPressureKPa.toFixed(1)} kPa).`,
          time: this.elapsedSeconds,
        });
      }
    }
    return pressureKPa;
  }
}
