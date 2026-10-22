import { SPECIES, Species } from '../engine/data/species';
import { REACTIONS } from '../engine/data/reactions';
import { Mixture } from '../engine/mixture';
import { Simulator } from '../engine/simulator';
import { pH } from '../engine/solution';
import { R_GAS } from '../engine/thermo';
import { Reaction, StepResult } from '../engine/types';

export type EquipmentType =
  | 'beaker'
  | 'flask'
  | 'test_tube'
  | 'gas_jar'
  | 'stopper'
  | 'burner'
  | 'scale'
  | 'pipette'
  | 'thermometer'
  | 'ph_meter';

export type VesselType = 'beaker' | 'flask' | 'test_tube' | 'gas_jar';

export type PourUnit = 'mL' | 'g' | 'mol';

export type ChemicalCategory =
  | 'all'
  | 'gases'
  | 'acids'
  | 'bases'
  | 'salts'
  | 'metals'
  | 'organics'
  | 'liquids_oxides';

export interface EquipmentCatalogItem {
  type: EquipmentType;
  label: string;
  subtitle: string;
  group: 'vessel' | 'heat' | 'meter';
  capacityL?: number;
}

export const EQUIPMENT_CATALOG: EquipmentCatalogItem[] = [
  { type: 'beaker', label: 'Beaker', subtitle: '250 mL Glass', group: 'vessel', capacityL: 0.25 },
  { type: 'flask', label: 'Flask', subtitle: '250 mL Conical', group: 'vessel', capacityL: 0.25 },
  { type: 'test_tube', label: 'Test Tube', subtitle: '50 mL Rack', group: 'vessel', capacityL: 0.05 },
  { type: 'gas_jar', label: 'Gas Jar', subtitle: '500 mL Heavy', group: 'vessel', capacityL: 0.5 },
  { type: 'stopper', label: 'Stopper', subtitle: 'Seal Vessel', group: 'vessel' },
  { type: 'burner', label: 'Burner', subtitle: 'Bunsen Flame', group: 'heat' },
  { type: 'scale', label: 'Scale', subtitle: '0.01 g Balance', group: 'meter' },
  { type: 'pipette', label: 'Pipette', subtitle: '10 mL Dropper', group: 'meter' },
  { type: 'thermometer', label: 'Thermometer', subtitle: '°C / K Probe', group: 'meter' },
  { type: 'ph_meter', label: 'pH Meter', subtitle: 'Electrode', group: 'meter' },
];

export const VESSEL_CAPACITIES_L: Record<VesselType, number> = {
  beaker: 0.25,
  flask: 0.25,
  test_tube: 0.05,
  gas_jar: 0.5,
};

export interface LabVessel {
  id: string;
  kind: 'vessel';
  vesselType: VesselType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  capacityL: number;
  closed: boolean;
  mixture: Mixture;
  simulator: Simulator;
  lastStepResult: StepResult;
  lastReactionsFired: string[];
  overflowWarning: boolean;
  burst: boolean;
  spilledColor?: string;
  ventedMoles: Record<string, number>;
  peakBurstPressureKPa?: number;
}

export interface VesselStepResult extends StepResult {
  vented: Record<string, number>;
  peakBurstPressureKPa?: number;
}

export interface LabTool {
  id: string;
  kind: 'tool';
  toolType: Exclude<EquipmentType, VesselType | 'stopper'>;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  active: boolean; // e.g. burner flame ON/OFF
  powerWatts: number;
}

export type BenchItem = LabVessel | LabTool;

export interface PourOptions {
  molarity?: number; // Default 1.0 M for 'aq' solutions
}

export interface PourCalculation {
  moles: number;
  volumeL: number;
  massG: number;
}

export interface PourResult {
  addedMoles: number;
  addedVolumeL: number;
  overflowVolumeL: number;
  overflowed: boolean;
  ignored: boolean;
  message: string;
}

export interface TransferResult {
  transferredMoles: number;
  transferredVolumeL: number;
  overflowed: boolean;
  ignored: boolean;
  message: string;
}

let nextEquipmentCounter = 1;

export function createVessel(
  vesselType: VesselType,
  x: number,
  y: number,
  customLabel?: string
): LabVessel {
  const id = `vessel_${nextEquipmentCounter++}`;
  const capacityL = VESSEL_CAPACITIES_L[vesselType];
  const burstPressureKPa = vesselType === 'gas_jar' ? 600.0 : 300.0;
  const mixture = new Mixture();
  const simulator = new Simulator(mixture, {
    vesselL: capacityL,
    closed: false,
    burstPressureKPa,
  });

  const dims =
    vesselType === 'beaker'
      ? { width: 108, height: 138, defaultLabel: 'Beaker 250mL' }
      : vesselType === 'flask'
        ? { width: 112, height: 144, defaultLabel: 'Flask 250mL' }
        : vesselType === 'gas_jar'
          ? { width: 104, height: 152, defaultLabel: 'Gas Jar 500mL' }
          : { width: 72, height: 140, defaultLabel: 'Test Tube 50mL' };

  return {
    id,
    kind: 'vessel',
    vesselType,
    label: customLabel ?? dims.defaultLabel,
    x,
    y,
    width: dims.width,
    height: dims.height,
    capacityL,
    closed: false,
    mixture,
    simulator,
    lastStepResult: {
      reactionsFired: [],
      heatJ: 0,
      tempK: mixture.tempK,
      pressureKPa: 101.3,
      hazards: [],
    },
    lastReactionsFired: [],
    overflowWarning: false,
    burst: false,
    ventedMoles: {},
  };
}

export function createTool(
  toolType: Exclude<EquipmentType, VesselType | 'stopper'>,
  x: number,
  y: number
): LabTool {
  const id = `tool_${nextEquipmentCounter++}`;
  const meta: Record<
    Exclude<EquipmentType, VesselType | 'stopper'>,
    { label: string; width: number; height: number; active: boolean; powerWatts: number }
  > = {
    burner: { label: 'Bunsen Burner', width: 84, height: 108, active: true, powerWatts: 1800 },
    scale: { label: 'Analytical Scale', width: 144, height: 52, active: true, powerWatts: 0 },
    pipette: { label: 'Pipette (10 mL)', width: 52, height: 116, active: false, powerWatts: 0 },
    thermometer: { label: 'Thermometer', width: 54, height: 124, active: true, powerWatts: 0 },
    ph_meter: { label: 'pH Probe', width: 72, height: 118, active: true, powerWatts: 0 },
  };
  const cfg = meta[toolType];
  return {
    id,
    kind: 'tool',
    toolType,
    label: cfg.label,
    x,
    y,
    width: cfg.width,
    height: cfg.height,
    active: cfg.active,
    powerWatts: cfg.powerWatts,
  };
}

export function isVesselType(type: EquipmentType): type is VesselType {
  return type === 'beaker' || type === 'flask' || type === 'test_tube' || type === 'gas_jar';
}

export function resetVesselState(vessel: LabVessel): void {
  vessel.mixture.reset();
  vessel.overflowWarning = false;
  vessel.burst = false;
  vessel.spilledColor = undefined;
  vessel.ventedMoles = {};
  vessel.peakBurstPressureKPa = undefined;
  vessel.lastReactionsFired = [];
  vessel.simulator.resetState();
  vessel.lastStepResult = {
    reactionsFired: [],
    heatJ: 0,
    tempK: 298.15,
    pressureKPa: 101.3,
    hazards: [],
  };
}

/**
 * Steps the vessel's chemical simulator and applies open-vessel atmospheric gas venting
 * or closed-vessel rupture/spillage rules.
 */
export function stepVesselPhysics(vessel: LabVessel, dtSeconds: number): VesselStepResult {
  if (vessel.burst) {
    return {
      reactionsFired: [],
      heatJ: 0,
      tempK: 298.15,
      pressureKPa: 101.3,
      hazards: [],
      vented: {},
    };
  }

  vessel.simulator.vesselL = vessel.capacityL;
  vessel.simulator.closed = vessel.closed;

  const result = vessel.simulator.step(dtSeconds);
  const ventedThisStep: Record<string, number> = {};

  // Open vessels vent excess gas to atmosphere proportionally so pressure stays near ~101.3 kPa
  if (!vessel.closed) {
    const headspaceL = Math.max(0.01, vessel.capacityL - Math.max(0, vessel.mixture.volumeL));
    const maxAtmGasMoles = (101.325 * headspaceL) / (R_GAS * Math.max(200, vessel.mixture.tempK));

    let currentGasMoles = 0;
    for (const [id, n] of Object.entries(vessel.mixture.moles)) {
      if (n > 0 && SPECIES[id]?.phase === 'g') {
        currentGasMoles += n;
      }
    }

    if (currentGasMoles > maxAtmGasMoles) {
      const scale = maxAtmGasMoles / currentGasMoles;
      for (const [id, n] of Object.entries(vessel.mixture.moles)) {
        if (n > 0 && SPECIES[id]?.phase === 'g') {
          const remaining = n * scale;
          const ventedAmount = n - remaining;
          vessel.mixture.moles[id] = remaining;
          if (ventedAmount > 1e-8) {
            ventedThisStep[id] = (ventedThisStep[id] ?? 0) + ventedAmount;
            vessel.ventedMoles[id] = (vessel.ventedMoles[id] ?? 0) + ventedAmount;
          }
        }
      }
    }
    result.pressureKPa = 101.3;
  }

  // Clamp liquid volume if reaction produced liquid exceeding vessel capacity
  if (vessel.mixture.volumeL > vessel.capacityL) {
    vessel.mixture.volumeL = vessel.capacityL;
    vessel.overflowWarning = true;
  }

  if (result.reactionsFired.length > 0) {
    vessel.lastReactionsFired = result.reactionsFired;
  }

  let peakBurstPressureKPa: number | undefined;
  // If a burst occurred (only possible when closed AND after heat or reaction), shatter vessel, spill contents, and reset T/P to ambient
  if (result.hazards.includes('burst')) {
    peakBurstPressureKPa = result.pressureKPa;
    vessel.peakBurstPressureKPa = peakBurstPressureKPa;
    vessel.burst = true;
    vessel.closed = false;
    vessel.simulator.closed = false;
    vessel.spilledColor = blendMixtureColor(vessel.mixture);
    vessel.mixture.reset();
    result.tempK = 298.15;
    result.pressureKPa = 101.3;
  }

  const vesselResult: VesselStepResult = {
    ...result,
    vented: ventedThisStep,
    peakBurstPressureKPa,
  };
  vessel.lastStepResult = vesselResult;
  return vesselResult;
}

/**
 * Pure scenario helper for 2H2 + O2 -> 2H2O (make water).
 * Uses 0.02 mol H2 + 0.01 mol O2 in a stoppered vessel so internal pressure stays safe (~148-297 kPa),
 * then on ignition forms 0.02 mol H2O liquid with flame, heat, and condensation without bursting.
 */
export function runMakeWaterScenario(vessel: LabVessel, igniteNow = false): StepResult {
  if (!igniteNow) {
    resetVesselState(vessel);
    vessel.closed = true;
    vessel.simulator.closed = true;
    pourChemical(vessel, 'H2', 0.02, 'mol');
    pourChemical(vessel, 'O2', 0.01, 'mol');
    return stepVesselPhysics(vessel, 0.05);
  }

  const hasReactants =
    (vessel.mixture.moles.H2 ?? 0) > 1e-5 && (vessel.mixture.moles.O2 ?? 0) > 1e-5;
  if (!hasReactants) {
    resetVesselState(vessel);
    vessel.closed = true;
    vessel.simulator.closed = true;
    pourChemical(vessel, 'H2', 0.02, 'mol');
    pourChemical(vessel, 'O2', 0.01, 'mol');
  }

  vessel.simulator.ignite();
  return stepVesselPhysics(vessel, 0.25);
}

/**
 * Pure scenario helper for closed-vessel gas overpressure burst demo.
 */
export function runClosedGasBurstScenario(vessel: LabVessel): StepResult {
  resetVesselState(vessel);
  vessel.closed = true;
  vessel.simulator.closed = true;
  pourChemical(vessel, 'N2', 0.25, 'mol');
  vessel.simulator.heat(65000);
  return stepVesselPhysics(vessel, 0.1);
}

export function runNeutralizeScenario(vessel: LabVessel): StepResult {
  resetVesselState(vessel);
  pourChemical(vessel, 'HCl', 50, 'mL', { molarity: 1.0 });
  pourChemical(vessel, 'NaOH', 50, 'mL', { molarity: 1.0 });
  return stepVesselPhysics(vessel, 0.1);
}

export function runSodiumWaterHazardScenario(vessel: LabVessel): StepResult {
  resetVesselState(vessel);
  pourChemical(vessel, 'H2O', 80, 'mL');
  pourChemical(vessel, 'Na', 2.0, 'g');
  return stepVesselPhysics(vessel, 0.1);
}

export function runChloramineHazardScenario(vessel: LabVessel): StepResult {
  resetVesselState(vessel);
  pourChemical(vessel, 'NaOCl', 40, 'mL', { molarity: 0.5 });
  pourChemical(vessel, 'NH3(aq)', 40, 'mL', { molarity: 0.5 });
  return stepVesselPhysics(vessel, 0.1);
}

export function runNaBH4AcidScenario(vessel: LabVessel): VesselStepResult {
  resetVesselState(vessel);
  pourChemical(vessel, 'HCl', 80, 'mL', { molarity: 1.0 });
  pourChemical(vessel, 'NaBH4', 1.0, 'g');
  return stepVesselPhysics(vessel, 0.1);
}

export function runPropiophenoneReductionScenario(vessel: LabVessel): VesselStepResult {
  resetVesselState(vessel);
  pourChemical(vessel, 'C2H5OH', 20, 'mL');
  pourChemical(vessel, 'PROPIOPHENONE', 0.004, 'mol');
  pourChemical(vessel, 'NaBH4', 0.001, 'mol');
  pourChemical(vessel, 'H2O', 0.002, 'mol');
  return stepVesselPhysics(vessel, 0.1);
}

export function calculatePourAmount(
  speciesId: string,
  amount: number,
  unit: PourUnit,
  opts?: PourOptions
): PourCalculation {
  const sp = SPECIES[speciesId];
  if (!sp || !Number.isFinite(amount) || amount <= 0) {
    return { moles: 0, volumeL: 0, massG: 0 };
  }

  const molarity = opts?.molarity && opts.molarity > 0 ? opts.molarity : 1.0;
  const molarVolumeGasL = 24.4654; // Ideal gas molar volume at 298.15 K, 101.325 kPa

  let moles = 0;
  let volumeL = 0;

  if (unit === 'mL') {
    const reqVolumeL = amount / 1000.0;
    if (sp.phase === 'l') {
      const density = sp.density ?? 1.0;
      const massG = amount * density;
      moles = massG / sp.molarMass;
      volumeL = reqVolumeL;
    } else if (sp.phase === 'aq') {
      volumeL = reqVolumeL;
      moles = reqVolumeL * molarity;
    } else if (sp.phase === 's') {
      const density = sp.density ?? 2.0;
      const massG = amount * density;
      moles = massG / sp.molarMass;
      volumeL = reqVolumeL;
    } else {
      moles = reqVolumeL / molarVolumeGasL;
      volumeL = 0;
    }
  } else if (unit === 'g') {
    moles = amount / sp.molarMass;
    if (sp.phase === 'l') {
      const density = sp.density ?? 1.0;
      volumeL = amount / (density * 1000.0);
    } else if (sp.phase === 'aq') {
      volumeL = moles / molarity;
    } else if (sp.phase === 's') {
      const density = sp.density ?? 2.0;
      volumeL = amount / (density * 1000.0);
    } else {
      volumeL = 0;
    }
  } else {
    // unit === 'mol'
    moles = amount;
    if (sp.phase === 'l') {
      const density = sp.density ?? 1.0;
      volumeL = (moles * sp.molarMass) / (density * 1000.0);
    } else if (sp.phase === 'aq') {
      volumeL = moles / molarity;
    } else if (sp.phase === 's') {
      const density = sp.density ?? 2.0;
      volumeL = (moles * sp.molarMass) / (density * 1000.0);
    } else {
      volumeL = 0;
    }
  }

  return {
    moles,
    volumeL: Math.max(0, volumeL),
    massG: moles * sp.molarMass,
  };
}

export function pourChemical(
  vessel: LabVessel,
  speciesId: string,
  amount: number,
  unit: PourUnit,
  opts?: PourOptions
): PourResult {
  if (vessel.burst) {
    return {
      addedMoles: 0,
      addedVolumeL: 0,
      overflowVolumeL: 0,
      overflowed: false,
      ignored: true,
      message: `${vessel.label} is shattered! Reset bench or select another vessel.`,
    };
  }

  const sp = SPECIES[speciesId];
  if (!sp) {
    return {
      addedMoles: 0,
      addedVolumeL: 0,
      overflowVolumeL: 0,
      overflowed: false,
      ignored: true,
      message: `Unknown chemical species: ${speciesId}`,
    };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      addedMoles: 0,
      addedVolumeL: 0,
      overflowVolumeL: 0,
      overflowed: false,
      ignored: true,
      message: 'Pour amount must be a positive number greater than zero.',
    };
  }

  const calc = calculatePourAmount(speciesId, amount, unit, opts);
  if (calc.moles <= 0) {
    return {
      addedMoles: 0,
      addedVolumeL: 0,
      overflowVolumeL: 0,
      overflowed: false,
      ignored: true,
      message: 'Calculated pour amount is zero.',
    };
  }

  const currentVolumeL = Math.max(0, vessel.mixture.volumeL);
  const remainingL = Math.max(0, vessel.capacityL - currentVolumeL);

  let actualMoles = calc.moles;
  let actualVolumeL = calc.volumeL;
  let overflowVolumeL = 0;
  let overflowed = false;

  if (calc.volumeL > 0) {
    if (remainingL <= 1e-9) {
      vessel.overflowWarning = true;
      return {
        addedMoles: 0,
        addedVolumeL: 0,
        overflowVolumeL: calc.volumeL,
        overflowed: true,
        ignored: false,
        message: `${vessel.label} is full (${(vessel.capacityL * 1000).toFixed(0)} mL max). Overflow prevented!`,
      };
    }

    if (calc.volumeL > remainingL + 1e-9) {
      const fraction = remainingL / calc.volumeL;
      actualVolumeL = remainingL;
      actualMoles = calc.moles * fraction;
      overflowVolumeL = calc.volumeL - remainingL;
      overflowed = true;
      vessel.overflowWarning = true;
    }
  }

  const volBefore = vessel.mixture.volumeL;
  vessel.mixture.add(speciesId, actualMoles);

  const targetVolumeL = Math.max(0, Math.min(vessel.capacityL, volBefore + actualVolumeL));
  vessel.mixture.volumeL = targetVolumeL;

  const addedLabel =
    unit === 'mL'
      ? `${(actualVolumeL * 1000).toFixed(1)} mL`
      : unit === 'g'
        ? `${(actualMoles * sp.molarMass).toFixed(2)} g`
        : `${actualMoles.toFixed(3)} mol`;

  return {
    addedMoles: actualMoles,
    addedVolumeL: actualVolumeL,
    overflowVolumeL,
    overflowed,
    ignored: false,
    message: overflowed
      ? `Overflow! Clamped ${sp.formula} pour to ${addedLabel} (${vessel.label} at capacity).`
      : `Added ${addedLabel} (${actualMoles.toFixed(4)} mol) of ${sp.name} (${sp.formula}) to ${vessel.label}.`,
  };
}

export function transferBetweenVessels(
  source: LabVessel,
  target: LabVessel,
  volumeML: number
): TransferResult {
  if (source.id === target.id) {
    return {
      transferredMoles: 0,
      transferredVolumeL: 0,
      overflowed: false,
      ignored: true,
      message: 'Cannot transfer from a vessel into itself.',
    };
  }

  if (source.burst || target.burst) {
    return {
      transferredMoles: 0,
      transferredVolumeL: 0,
      overflowed: false,
      ignored: true,
      message: 'Cannot transfer with a shattered vessel.',
    };
  }

  if (!Number.isFinite(volumeML) || volumeML <= 0) {
    return {
      transferredMoles: 0,
      transferredVolumeL: 0,
      overflowed: false,
      ignored: true,
      message: 'Transfer volume must be greater than zero.',
    };
  }

  const totalSourceMoles = Object.values(source.mixture.moles).reduce(
    (sum, n) => sum + (n > 0 ? n : 0),
    0
  );

  if (totalSourceMoles <= 1e-12) {
    return {
      transferredMoles: 0,
      transferredVolumeL: 0,
      overflowed: false,
      ignored: true,
      message: `${source.label} is empty — nothing to pour.`,
    };
  }

  const reqVolumeL = volumeML / 1000.0;
  const sourceVolL = Math.max(0, source.mixture.volumeL);
  const targetRemainingL = Math.max(0, target.capacityL - Math.max(0, target.mixture.volumeL));

  if (sourceVolL > 0 && targetRemainingL <= 1e-9) {
    target.overflowWarning = true;
    return {
      transferredMoles: 0,
      transferredVolumeL: 0,
      overflowed: true,
      ignored: false,
      message: `${target.label} is already full! Overflow prevented.`,
    };
  }

  let actualTransferVolL = 0;
  let fraction = 1.0;
  let overflowed = false;

  if (sourceVolL > 0) {
    const desiredFromSourceL = Math.min(sourceVolL, reqVolumeL);
    if (desiredFromSourceL > targetRemainingL + 1e-9) {
      actualTransferVolL = targetRemainingL;
      overflowed = true;
      target.overflowWarning = true;
    } else {
      actualTransferVolL = desiredFromSourceL;
    }
    fraction = Math.min(1.0, actualTransferVolL / sourceVolL);
  } else {
    fraction = Math.min(1.0, reqVolumeL / Math.max(0.05, source.capacityL));
  }

  if (fraction <= 1e-12) {
    return {
      transferredMoles: 0,
      transferredVolumeL: 0,
      overflowed,
      ignored: true,
      message: 'No volume could be transferred.',
    };
  }

  const targetCpBefore = Math.max(target.mixture.heatCapacity(), 10);
  const transferredCp = Math.max(source.mixture.heatCapacity() * fraction, 10);
  const mixedTempK =
    Object.keys(target.mixture.moles).length > 0
      ? (target.mixture.tempK * targetCpBefore + source.mixture.tempK * transferredCp) /
        (targetCpBefore + transferredCp)
      : source.mixture.tempK;

  let transferredMolesTotal = 0;
  const targetVolBefore = Math.max(0, target.mixture.volumeL);

  for (const [spId, n] of Object.entries(source.mixture.moles)) {
    if (n <= 1e-12) continue;
    const dMoles = n * fraction;
    const remaining = n - dMoles;
    if (remaining <= 1e-12) {
      delete source.mixture.moles[spId];
    } else {
      source.mixture.moles[spId] = remaining;
    }
    target.mixture.add(spId, dMoles);
    transferredMolesTotal += dMoles;
  }

  source.mixture.volumeL = Math.max(0, sourceVolL - actualTransferVolL);
  source.mixture.liquidVolumeAddedL = Math.max(0, source.mixture.liquidVolumeAddedL * (1 - fraction));
  source.mixture.solidVolumeAddedL = Math.max(0, source.mixture.solidVolumeAddedL * (1 - fraction));
  if (source.mixture.volumeL <= 1e-12) {
    source.mixture.hasAqueousSolvent = false;
  }
  target.mixture.volumeL = Math.max(
    0,
    Math.min(target.capacityL, targetVolBefore + actualTransferVolL)
  );
  target.mixture.tempK = mixedTempK;

  return {
    transferredMoles: transferredMolesTotal,
    transferredVolumeL: actualTransferVolL,
    overflowed,
    ignored: false,
    message: overflowed
      ? `Transferred ${(actualTransferVolL * 1000).toFixed(1)} mL from ${source.label} to ${target.label} (clamped at capacity).`
      : `Transferred ${(actualTransferVolL * 1000).toFixed(1)} mL from ${source.label} to ${target.label}.`,
  };
}

function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return [r, g, b];
  }
  const r = parseInt(clean.slice(0, 2), 16) || 200;
  const g = parseInt(clean.slice(2, 4), 16) || 235;
  const b = parseInt(clean.slice(4, 6), 16) || 255;
  return [r, g, b];
}

export function blendMixtureColor(mixture: Mixture): string {
  let rSum = 195 * 0.15;
  let gSum = 232 * 0.15;
  let bSum = 255 * 0.15;
  let weightSum = 0.15;
  let coloredSoluteWeight = 0;

  for (const [id, moles] of Object.entries(mixture.moles)) {
    if (moles <= 1e-9) continue;
    const sp = SPECIES[id];
    if (!sp) continue;
    if (sp.phase === 'g') continue;

    if (sp.color && id !== 'H2O') {
      const [r, g, b] = parseHexColor(sp.color);
      const w = Math.max(0.05, moles * 12);
      rSum += r * w;
      gSum += g * w;
      bSum += b * w;
      weightSum += w;
      coloredSoluteWeight += w;
    } else if (id === 'H2O') {
      const w = Math.min(0.4, moles * 0.01);
      rSum += 205 * w;
      gSum += 236 * w;
      bSum += 255 * w;
      weightSum += w;
    }
  }

  if (coloredSoluteWeight < 0.05 && mixture.volumeL > 0) {
    const currentPh = pH(mixture);
    if (currentPh < 5.5) {
      const intensity = Math.min(1, (7 - currentPh) / 6) * 0.25;
      rSum += 255 * intensity;
      gSum += 160 * intensity;
      bSum += 185 * intensity;
      weightSum += intensity;
    } else if (currentPh > 8.5) {
      const intensity = Math.min(1, (currentPh - 7) / 6) * 0.25;
      rSum += 145 * intensity;
      gSum += 210 * intensity;
      bSum += 255 * intensity;
      weightSum += intensity;
    }
  }

  const r = Math.round(Math.max(0, Math.min(255, rSum / weightSum)));
  const g = Math.round(Math.max(0, Math.min(255, gSum / weightSum)));
  const b = Math.round(Math.max(0, Math.min(255, bSum / weightSum)));
  const alpha = Math.min(0.84, 0.48 + Math.min(0.36, coloredSoluteWeight * 0.25));

  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

export function getPrecipitateInfo(mixture: Mixture): { massG: number; color: string; formulas: string[] } {
  let totalMassG = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let wSum = 0;
  const formulas: string[] = [];

  for (const [id, moles] of Object.entries(mixture.moles)) {
    if (moles <= 1e-6) continue;
    const sp = SPECIES[id];
    if (!sp || sp.phase !== 's') continue;
    const mass = moles * sp.molarMass;
    totalMassG += mass;
    formulas.push(sp.formula);
    const [r, g, b] = parseHexColor(sp.color ?? '#e5e7eb');
    rSum += r * mass;
    gSum += g * mass;
    bSum += b * mass;
    wSum += mass;
  }

  if (wSum <= 0) {
    return { massG: 0, color: 'rgba(255,255,255,0)', formulas: [] };
  }

  const r = Math.round(rSum / wSum);
  const g = Math.round(gSum / wSum);
  const b = Math.round(bSum / wSum);
  return {
    massG: totalMassG,
    color: `rgba(${r}, ${g}, ${b}, 0.92)`,
    formulas,
  };
}

export function getHeadspaceGasInfo(mixture: Mixture): { moles: number; color: string; formulas: string[] } {
  let gasMoles = 0;
  let rSum = 210 * 0.05;
  let gSum = 230 * 0.05;
  let bSum = 250 * 0.05;
  let wSum = 0.05;
  let coloredGasMoles = 0;
  const formulas: string[] = [];

  for (const [id, moles] of Object.entries(mixture.moles)) {
    if (moles <= 1e-6) continue;
    const sp = SPECIES[id];
    if (!sp || sp.phase !== 'g') continue;
    gasMoles += moles;
    formulas.push(sp.formula);
    if (sp.color) {
      const [r, g, b] = parseHexColor(sp.color);
      rSum += r * moles * 5;
      gSum += g * moles * 5;
      bSum += b * moles * 5;
      wSum += moles * 5;
      coloredGasMoles += moles;
    }
  }

  if (gasMoles <= 0) {
    return { moles: 0, color: 'rgba(0,0,0,0)', formulas: [] };
  }

  const r = Math.round(rSum / wSum);
  const g = Math.round(gSum / wSum);
  const b = Math.round(bSum / wSum);
  const alpha =
    coloredGasMoles > 0
      ? Math.min(0.42, 0.12 + coloredGasMoles * 0.25)
      : Math.min(0.14, 0.04 + gasMoles * 0.03);
  return {
    moles: gasMoles,
    color: `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`,
    formulas,
  };
}

const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
};

export function formatFormula(formula: string): string {
  return formula.replace(/([A-Za-z)\]])(\d+)/g, (_, prefix: string, digits: string) => {
    const sub = digits
      .split('')
      .map((d) => SUBSCRIPT_MAP[d] ?? d)
      .join('');
    return `${prefix}${sub}`;
  });
}

export function formatReactionEquation(reactionOrId: string | Reaction): string {
  const rxn =
    typeof reactionOrId === 'string'
      ? REACTIONS.find((r) => r.id === reactionOrId)
      : reactionOrId;
  if (!rxn) return typeof reactionOrId === 'string' ? reactionOrId : '';

  const formatSide = (side: Record<string, number>): string =>
    Object.entries(side)
      .map(([spId, coeff]) => {
        const sp = SPECIES[spId];
        const f = sp ? `${formatFormula(sp.formula)}(${sp.phase})` : spId;
        return coeff > 1 ? `${coeff} ${f}` : f;
      })
      .join(' + ');

  const arrow = rxn.reversible ? '⇌' : '→';
  const dHStr = `ΔH = ${rxn.dH > 0 ? '+' : ''}${rxn.dH.toFixed(1)} kJ/mol`;
  return `${formatSide(rxn.reactants)} ${arrow} ${formatSide(rxn.products)}  (${dHStr})`;
}

export function getSpeciesCategory(sp: Species): Exclude<ChemicalCategory, 'all'> {
  if (sp.phase === 'g') return 'gases';
  if (
    [
      'C2H5OH',
      'C6H12O6',
      'C3H8',
      'C2H4',
      'CH3OH',
      'CH4',
      'CH3COCH3',
      'C3H8O',
      'PROPIOPHENONE',
      'PHENYLPROPANOL',
    ].includes(sp.id)
  ) {
    return 'organics';
  }
  if ((sp.ka !== undefined && sp.ka >= 1e-7 && sp.id !== 'NH4Cl') || sp.id === 'H3BO3') {
    return 'acids';
  }
  if (
    (sp.kb !== undefined && sp.kb >= 1e-6) ||
    sp.id === 'Mg(OH)2' ||
    sp.id === 'Cu(OH)2' ||
    sp.id === 'Fe(OH)2'
  ) {
    return 'bases';
  }
  if (['Na', 'K', 'Ca', 'Mg', 'Al', 'Zn', 'Fe', 'Cu', 'Ag', 'C', 'S'].includes(sp.id)) {
    return 'metals';
  }
  if (['H2O', 'H2O2', 'Br2', 'MgO', 'CaO', 'CuO', 'ZnO', 'Fe2O3', 'Al2O3'].includes(sp.id)) {
    return 'liquids_oxides';
  }
  return 'salts';
}
