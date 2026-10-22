export type Phase = 'g' | 'l' | 's' | 'aq';

export interface Species {
  id: string;
  formula: string;
  name: string;
  phase: Phase;
  molarMass: number;
  dHf: number;
  S: number;
  Cp: number;
  density?: number;
  color?: string;
  hazard?: string[];
  ka?: number;
  kb?: number;
  estimated?: string[];
  source: string;
}

export interface ReactionConditions {
  minTempK?: number;
  ignition?: boolean;
  catalyst?: string;
}

export interface Reaction {
  id: string;
  reactants: Record<string, number>;
  products: Record<string, number>;
  dH: number;
  Ea: number;
  conditions: ReactionConditions;
  reversible: boolean;
  keq?: number;
  hazard?: string[];
  source: string;
}

export interface StepResult {
  reactionsFired: string[];
  heatJ: number;
  tempK: number;
  pressureKPa: number;
  hazards: string[];
}

export interface LabEvent {
  type: string;
  message: string;
  reactionId?: string;
  hazard?: string;
  time?: number;
}
