import { SPECIES } from '../engine/data/species';
import { REACTIONS } from '../engine/data/reactions';
import { pH } from '../engine/solution';
import { EffectsManager } from './effects';
import {
  BenchItem,
  blendMixtureColor,
  createTool,
  createVessel,
  EquipmentType,
  formatReactionEquation,
  getHeadspaceGasInfo,
  getPrecipitateInfo,
  isVesselType,
  LabTool,
  LabVessel,
  pourChemical,
  PourOptions,
  PourResult,
  PourUnit,
  resetVesselState,
  stepVesselPhysics,
  transferBetweenVessels,
} from './equipment';

export interface BenchCallbacks {
  onSelectVessel: (vessel: LabVessel | null) => void;
  onLogEvent: (
    action: string,
    details: string,
    vessel?: LabVessel,
    extra?: { reaction?: string; hazards?: string[] }
  ) => void;
  onHazard: (hazards: string[], message: string, vessel: LabVessel) => void;
  onNotice: (message: string, level?: 'info' | 'warn' | 'danger') => void;
  onSimSample: (simTime: number, vessel: LabVessel | null) => void;
}

export class LabBench {
  public readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  public readonly effects = new EffectsManager();
  private readonly callbacks: BenchCallbacks;

  public items: BenchItem[] = [];
  public selectedVesselId: string | null = null;
  public speedMultiplier: 1 | 10 | 100 = 1;
  public paused = false;
  public simElapsedSeconds = 0;

  private width = 880;
  private height = 460;
  private sampleAccumSec = 0;
  private dirty = true;
  private frameCounter = 0;
  private draggingItem: BenchItem | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private pointerDownMoved = false;
  private hoveredDropVesselId: string | null = null;
  private animTimeSec = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: BenchCallbacks) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not initialize 2D context for LabBench canvas');
    }
    this.ctx = context;
    this.callbacks = callbacks;

    this.setupStarterBench();
    this.bindEvents();
    this.resize();
  }

  public setupStarterBench(): void {
    this.items = [];
    this.simElapsedSeconds = 0;

    const beaker1 = createVessel('beaker', 100, 185, 'Beaker A (250mL)');
    const flask1 = createVessel('flask', 265, 179, 'Flask B (250mL)');
    const gasJar1 = createVessel('gas_jar', 435, 171, 'Gas Jar C (500mL)');
    const tube1 = createVessel('test_tube', 595, 183, 'Tube D (50mL)');

    const scale = createTool('scale', 82, 312);
    const burner = createTool('burner', 279, 300);
    burner.active = false;

    const phMeter = createTool('ph_meter', 705, 200);
    const thermometer = createTool('thermometer', 795, 195);

    this.items.push(scale, burner, beaker1, flask1, gasJar1, tube1, phMeter, thermometer);
    this.selectedVesselId = beaker1.id;
    this.dirty = true;
    this.callbacks.onSelectVessel(beaker1);
  }

  public getVessels(): LabVessel[] {
    return this.items.filter((it): it is LabVessel => it.kind === 'vessel');
  }

  public getTools(): LabTool[] {
    return this.items.filter((it): it is LabTool => it.kind === 'tool');
  }

  public getSelectedVessel(): LabVessel | null {
    if (!this.selectedVesselId) {
      const first = this.getVessels()[0] ?? null;
      if (first) this.selectedVesselId = first.id;
      return first;
    }
    return this.getVessels().find((v) => v.id === this.selectedVesselId) ?? null;
  }

  public selectVessel(vesselId: string | null): void {
    this.selectedVesselId = vesselId;
    this.dirty = true;
    this.callbacks.onSelectVessel(this.getSelectedVessel());
  }

  public addEquipment(type: EquipmentType, clientX?: number, clientY?: number): BenchItem | null {
    if (type === 'stopper') {
      // If dropped over a specific vessel, toggle that vessel; otherwise toggle selected vessel
      let target = this.getSelectedVessel();
      if (clientX !== undefined && clientY !== undefined) {
        const { x, y } = this.toCanvasCoords(clientX, clientY);
        const hit = this.hitTest(x, y);
        if (hit && hit.kind === 'vessel') {
          target = hit;
        }
      }
      if (target) {
        this.toggleVesselStopper(target);
        this.callbacks.onNotice(
          `${target.closed ? 'Stoppered (sealed)' : 'Unstoppered (open to air)'} ${target.label}.`,
          'info'
        );
      }
      return target;
    }

    const rect = this.canvas.getBoundingClientRect();
    let x = this.width * 0.42 + (Math.random() - 0.5) * 120;

    if (clientX !== undefined && clientY !== undefined && rect.width > 0) {
      x = Math.max(30, Math.min(this.width - 130, clientX - rect.left - 50));
    }

    if (isVesselType(type)) {
      const count = this.getVessels().filter((v) => v.vesselType === type).length + 1;
      const prefix =
        type === 'beaker'
          ? 'Beaker'
          : type === 'flask'
            ? 'Flask'
            : type === 'gas_jar'
              ? 'Gas Jar'
              : 'Test Tube';
      const cap = type === 'test_tube' ? '50mL' : type === 'gas_jar' ? '500mL' : '250mL';
      const vessel = createVessel(
        type,
        x,
        this.getBenchSurfaceY() - 140,
        `${prefix} #${count} (${cap})`
      );
      this.items.push(vessel);
      this.selectVessel(vessel.id);
      this.dirty = true;
      this.callbacks.onLogEvent('equipment', `Placed ${vessel.label} on the bench`, vessel);
      return vessel;
    } else {
      const tool = createTool(type, x, this.getBenchSurfaceY() - 112);
      this.items.push(tool);
      this.dirty = true;
      this.callbacks.onLogEvent('equipment', `Placed ${tool.label} on the bench`);
      return tool;
    }
  }

  public removeVessel(vesselId: string): void {
    const idx = this.items.findIndex((i) => i.id === vesselId);
    if (idx >= 0) {
      const removed = this.items[idx];
      this.items.splice(idx, 1);
      this.dirty = true;
      this.callbacks.onLogEvent('equipment', `Removed ${removed.label} from the bench`);
      if (this.selectedVesselId === vesselId) {
        const next = this.getVessels()[0] ?? null;
        this.selectVessel(next ? next.id : null);
      }
    }
  }

  public rinseVessel(vessel: LabVessel): void {
    resetVesselState(vessel);
    this.dirty = true;
    this.callbacks.onLogEvent('rinse', `Rinsed and restored ${vessel.label}`, vessel);
    this.callbacks.onNotice(`Rinsed ${vessel.label} (25.0 °C, empty).`, 'info');
    this.callbacks.onSelectVessel(vessel);
  }

  public toggleVesselStopper(vessel: LabVessel, closed?: boolean): void {
    if (vessel.burst) {
      this.callbacks.onNotice(`${vessel.label} is shattered and cannot be stoppered.`, 'warn');
      return;
    }
    vessel.closed = closed ?? !vessel.closed;
    vessel.simulator.closed = vessel.closed;
    this.dirty = true;
    this.callbacks.onLogEvent(
      'stopper',
      `${vessel.closed ? 'Stoppered (sealed)' : 'Unstoppered (open)'} ${vessel.label}`,
      vessel
    );
    this.callbacks.onSelectVessel(vessel);
  }

  public pourIntoSelected(
    speciesId: string,
    amount: number,
    unit: PourUnit,
    opts?: PourOptions
  ): PourResult | null {
    const vessel = this.getSelectedVessel();
    if (!vessel) {
      this.callbacks.onNotice('Select or place a vessel on the bench first.', 'warn');
      return null;
    }
    return this.pourIntoVessel(vessel, speciesId, amount, unit, opts);
  }

  public pourIntoVessel(
    vessel: LabVessel,
    speciesId: string,
    amount: number,
    unit: PourUnit,
    opts?: PourOptions
  ): PourResult {
    const sp = SPECIES[speciesId];
    const res = pourChemical(vessel, speciesId, amount, unit, opts);

    if (res.ignored) {
      this.callbacks.onNotice(res.message, 'warn');
      return res;
    }

    if (sp) {
      const streamColor = sp.color ?? blendMixtureColor(vessel.mixture);
      this.effects.triggerPourStream(vessel, streamColor, sp.phase, sp.formula, 0.38);
      if (sp.phase === 'g') {
        this.effects.triggerGasEvolution(vessel, 8);
      }
    }

    if (res.overflowed) {
      this.callbacks.onNotice(res.message, 'warn');
      this.callbacks.onLogEvent('overflow', res.message, vessel);
    } else {
      this.callbacks.onLogEvent('pour', res.message, vessel);
    }

    this.dirty = true;
    this.stepVesselSimulation(vessel, 0.05);
    this.callbacks.onSelectVessel(vessel);
    return res;
  }

  public igniteVessel(vessel?: LabVessel | null): void {
    const target = vessel ?? this.getSelectedVessel();
    if (!target) {
      this.callbacks.onNotice('No vessel selected to ignite.', 'warn');
      return;
    }
    if (target.burst) {
      this.callbacks.onNotice(`${target.label} is shattered. Reset bench first.`, 'warn');
      return;
    }
    this.dirty = true;
    target.simulator.ignite();
    this.effects.triggerIgnitionFlare(target, true);
    this.callbacks.onLogEvent('ignite', `Applied ignition spark to ${target.label}`, target);
    this.stepVesselSimulation(target, 0.25);
    this.callbacks.onSelectVessel(target);
  }

  public heatVessel(joules: number, vessel?: LabVessel | null, logAction = true): void {
    const target = vessel ?? this.getSelectedVessel();
    if (!target) {
      this.callbacks.onNotice('No vessel selected to heat.', 'warn');
      return;
    }
    if (target.burst) {
      this.callbacks.onNotice(`${target.label} is shattered. Reset bench first.`, 'warn');
      return;
    }
    this.dirty = true;
    target.simulator.heat(joules);
    if (logAction) {
      this.callbacks.onLogEvent(
        'heat',
        `Heated ${target.label} with ${(joules / 1000).toFixed(1)} kJ (T = ${(target.mixture.tempK - 273.15).toFixed(1)} °C)`,
        target
      );
    }
    this.stepVesselSimulation(target, 0.1);
    this.callbacks.onSelectVessel(target);
  }

  public transferVessels(source: LabVessel, target: LabVessel, volumeML = 25): void {
    const res = transferBetweenVessels(source, target, volumeML);
    if (res.ignored) {
      this.callbacks.onNotice(res.message, 'warn');
      return;
    }
    this.effects.triggerPourStream(
      target,
      blendMixtureColor(target.mixture),
      'aq',
      'Transfer',
      0.55
    );
    if (res.overflowed) {
      this.callbacks.onNotice(res.message, 'warn');
    } else {
      this.callbacks.onNotice(res.message, 'info');
    }
    this.dirty = true;
    this.callbacks.onLogEvent('transfer', res.message, target);
    this.stepVesselSimulation(target, 0.1);
    this.selectVessel(target.id);
  }

  public runScenario(preset: string): void {
    const vessels = this.getVessels();
    if (vessels.length === 0) return;

    if (preset === 'make_water') {
      // Prefer the thick-walled Gas Jar if present on the bench, otherwise selected vessel
      const jar = vessels.find((v) => v.vesselType === 'gas_jar') ?? this.getSelectedVessel() ?? vessels[0];
      this.selectVessel(jar.id);
      resetVesselState(jar);
      this.toggleVesselStopper(jar, true);
      this.pourIntoVessel(jar, 'H2', 0.02, 'mol');
      this.pourIntoVessel(jar, 'O2', 0.01, 'mol');
      this.callbacks.onNotice(
        `Loaded 0.02 mol H₂ + 0.01 mol O₂ in stoppered ${jar.label} (P = ${jar.lastStepResult.pressureKPa.toFixed(1)} kPa). Press "⚡ Spark / Ignite" to synthesize H₂O!`,
        'info'
      );
      this.callbacks.onSelectVessel(jar);
    } else if (preset === 'neutralize') {
      const beaker = vessels.find((v) => v.vesselType === 'beaker') ?? this.getSelectedVessel() ?? vessels[0];
      this.selectVessel(beaker.id);
      resetVesselState(beaker);
      this.pourIntoVessel(beaker, 'HCl', 50, 'mL', { molarity: 1.0 });
      this.pourIntoVessel(beaker, 'NaOH', 50, 'mL', { molarity: 1.0 });
      this.callbacks.onNotice(
        'Mixed 50 mL 1.0M HCl + 50 mL 1.0M NaOH → Neutralized to NaCl + H₂O (pH 7.00)!',
        'info'
      );
      this.callbacks.onSelectVessel(beaker);
    } else if (preset === 'heat_gas') {
      const flask = vessels.find((v) => v.vesselType === 'flask') ?? this.getSelectedVessel() ?? vessels[0];
      this.selectVessel(flask.id);
      resetVesselState(flask);
      this.toggleVesselStopper(flask, true);
      this.pourIntoVessel(flask, 'N2', 0.35, 'mol');
      this.heatVessel(65000, flask);
      this.callbacks.onSelectVessel(flask);
    } else if (preset === 'hazard_na') {
      const target = this.getSelectedVessel() ?? vessels[0];
      resetVesselState(target);
      this.pourIntoVessel(target, 'H2O', 80, 'mL');
      this.pourIntoVessel(target, 'Na', 2.0, 'g');
      this.callbacks.onSelectVessel(target);
    } else if (preset === 'hazard_chloramine') {
      const target = this.getSelectedVessel() ?? vessels[0];
      resetVesselState(target);
      this.pourIntoVessel(target, 'NaOCl', 40, 'mL', { molarity: 0.5 });
      this.pourIntoVessel(target, 'NH3(aq)', 40, 'mL', { molarity: 0.5 });
      this.callbacks.onSelectVessel(target);
    } else if (preset === 'nabh4_hcl') {
      const target = vessels.find((v) => v.vesselType === 'beaker') ?? this.getSelectedVessel() ?? vessels[0];
      this.selectVessel(target.id);
      resetVesselState(target);
      this.pourIntoVessel(target, 'HCl', 80, 'mL', { molarity: 1.0 });
      this.pourIntoVessel(target, 'NaBH4', 1.0, 'g');
      this.callbacks.onSelectVessel(target);
    }
  }

  public tick(dtRealSeconds: number): void {
    this.animTimeSec += dtRealSeconds;
    this.frameCounter++;

    const burners = this.getTools().filter((t) => t.toolType === 'burner' && t.active);
    const vessels = this.getVessels();

    if (!this.paused) {
      const simDt = Math.min(0.2, dtRealSeconds) * this.speedMultiplier;
      this.simElapsedSeconds += simDt;

      // Active burners heat vessels positioned directly above or near them
      for (const burner of burners) {
        const bCx = burner.x + burner.width * 0.5;
        const bTop = burner.y;
        for (const v of vessels) {
          if (v.burst) continue;
          const vCx = v.x + v.width * 0.5;
          const vBottom = v.y + v.height;
          if (Math.abs(vCx - bCx) < 88 && Math.abs(vBottom - bTop) < 125) {
            v.simulator.heat(burner.powerWatts * simDt);
            this.dirty = true;
          }
        }
      }

      for (const v of vessels) {
        if (!v.burst) {
          this.stepVesselSimulation(v, simDt);
        }
      }

      this.sampleAccumSec += dtRealSeconds;
      if (this.sampleAccumSec >= 0.2) {
        this.sampleAccumSec = 0;
        this.callbacks.onSimSample(this.simElapsedSeconds, this.getSelectedVessel());
      }
    }

    const hadEffects = this.effects.hasActiveEffects();
    this.effects.update(dtRealSeconds, vessels);
    const hasEffects = this.effects.hasActiveEffects();
    const hasLiquidWave = vessels.some((v) => !v.burst && v.mixture.volumeL > 0.002);

    if (
      this.dirty ||
      hasEffects ||
      hadEffects ||
      burners.length > 0 ||
      (hasLiquidWave && this.frameCounter % 3 === 0)
    ) {
      this.dirty = false;
      this.render();
    }
  }

  private stepVesselSimulation(vessel: LabVessel, simDt: number): void {
    if (vessel.burst) return;

    const beforeGasMoles = getHeadspaceGasInfo(vessel.mixture).moles;
    const beforePrecipMass = getPrecipitateInfo(vessel.mixture).massG;

    const result = stepVesselPhysics(vessel, simDt);

    if (result.reactionsFired.length > 0) {
      this.dirty = true;
      for (const rxnId of result.reactionsFired) {
        const rxn = REACTIONS.find((r) => r.id === rxnId);
        const eqStr = formatReactionEquation(rxn ?? rxnId);
        this.callbacks.onLogEvent(
          'reaction',
          `Reaction fired in ${vessel.label}: ${eqStr}`,
          vessel,
          { reaction: eqStr, hazards: result.hazards }
        );

        if (rxn) {
          const producesGas = Object.keys(rxn.products).some(
            (pId) => SPECIES[pId]?.phase === 'g'
          );
          if (producesGas) {
            this.effects.triggerGasEvolution(vessel, 22);
          }

          const precipSpId = Object.keys(rxn.products).find(
            (pId) => SPECIES[pId]?.phase === 's'
          );
          if (precipSpId) {
            const pColor = SPECIES[precipSpId]?.color ?? '#f3f4f6';
            this.effects.triggerPrecipitate(vessel, pColor, 26);
          }

          if (rxn.products.H2O || rxn.products['H2O(g)'] || rxn.dH < -150) {
            this.effects.triggerCondensationAndVapor(vessel, 18);
          }

          if (rxn.conditions.ignition || rxn.dH < -250) {
            this.effects.triggerIgnitionFlare(vessel, true);
          }
        }
      }
    }

    const afterGasMoles = getHeadspaceGasInfo(vessel.mixture).moles;
    if (afterGasMoles > beforeGasMoles + 1e-5) {
      this.effects.triggerGasEvolution(vessel, 14);
    }

    const afterPrecipMass = getPrecipitateInfo(vessel.mixture).massG;
    if (afterPrecipMass > beforePrecipMass + 1e-4) {
      const pInfo = getPrecipitateInfo(vessel.mixture);
      this.effects.triggerPrecipitate(vessel, pInfo.color, 18);
    }

    if (result.vented) {
      for (const [spId, ventedMol] of Object.entries(result.vented)) {
        if (ventedMol >= 1e-4) {
          const sp = SPECIES[spId];
          const formula = sp ? sp.formula : spId;
          const remainingMol = vessel.mixture.moles[spId] ?? 0;
          this.callbacks.onLogEvent(
            'vent',
            `Vented ${ventedMol.toFixed(4)} mol ${formula} to atmosphere (${remainingMol.toFixed(4)} mol remaining in ${vessel.label})`,
            vessel
          );
        }
      }
    }

    if (result.hazards.length > 0) {
      this.dirty = true;
      const isBurst = result.hazards.includes('burst');
      const isExplosive = result.hazards.includes('explosive') || isBurst;
      if (isExplosive) {
        this.effects.triggerExplosion(vessel);
      }

      const peakP =
        result.peakBurstPressureKPa ?? vessel.peakBurstPressureKPa ?? result.pressureKPa;

      if (isBurst) {
        this.callbacks.onLogEvent(
          'hazard',
          `Vessel ruptured! Peak internal gas pressure (${peakP.toFixed(0)} kPa) shattered ${vessel.label} and spilled contents.`,
          vessel,
          { hazards: result.hazards }
        );
      }

      const eqSummary = isBurst
        ? `Overpressure (peak ${peakP.toFixed(0)} kPa) shattered ${vessel.label}! Contents spilled on bench.`
        : result.reactionsFired.length > 0
          ? result.reactionsFired.map((id) => formatReactionEquation(id)).join(' ; ')
          : `Hazardous condition in ${vessel.label}`;

      this.callbacks.onHazard(result.hazards, eqSummary, vessel);
      this.callbacks.onSelectVessel(vessel);
    }
  }

  public resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    this.width = Math.max(520, Math.floor(rect.width));
    this.height = Math.max(300, Math.floor(rect.height));

    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.dirty = true;

    const surfaceY = this.getBenchSurfaceY();
    for (const item of this.items) {
      item.x = Math.max(12, Math.min(this.width - item.width - 12, item.x));
      item.y = Math.max(24, Math.min(surfaceY - item.height + 24, item.y));
    }
    this.render();
  }

  public getBenchSurfaceY(): number {
    return Math.floor(this.height * 0.73);
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('pointerdown', (e) => {
      const { x, y } = this.toCanvasCoords(e.clientX, e.clientY);
      const hit = this.hitTest(x, y);
      this.pointerDownMoved = false;
      this.dragStartX = x;
      this.dragStartY = y;

      if (hit) {
        this.draggingItem = hit;
        this.dragOffsetX = x - hit.x;
        this.dragOffsetY = y - hit.y;
        this.canvas.setPointerCapture(e.pointerId);

        if (hit.kind === 'vessel') {
          this.selectVessel(hit.id);
        }
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const { x, y } = this.toCanvasCoords(e.clientX, e.clientY);
      if (!this.draggingItem) {
        const hover = this.hitTest(x, y);
        this.canvas.style.cursor = hover ? 'grab' : 'default';
        return;
      }

      if ( Math.hypot(x - this.dragStartX, y - this.dragStartY) > 5) {
        this.pointerDownMoved = true;
      }

      this.dirty = true;
      this.canvas.style.cursor = 'grabbing';
      const surfaceY = this.getBenchSurfaceY();
      this.draggingItem.x = Math.max(
        12,
        Math.min(this.width - this.draggingItem.width - 12, x - this.dragOffsetX)
      );
      this.draggingItem.y = Math.max(
        18,
        Math.min(surfaceY - this.draggingItem.height + 28, y - this.dragOffsetY)
      );

      if (this.draggingItem.kind === 'vessel') {
        const target = this.findOverlappingVessel(this.draggingItem);
        this.hoveredDropVesselId = target ? target.id : null;
      } else {
        this.hoveredDropVesselId = null;
      }
    });

    const finishPointer = (e: PointerEvent) => {
      if (!this.draggingItem) return;
      const item = this.draggingItem;
      this.draggingItem = null;
      this.canvas.style.cursor = 'default';

      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }

      if (!this.pointerDownMoved && item.kind === 'tool' && item.toolType === 'burner') {
        item.active = !item.active;
        this.dirty = true;
        this.callbacks.onLogEvent(
          'burner',
          `Turned Bunsen Burner ${item.active ? 'ON' : 'OFF'}`
        );
        this.callbacks.onNotice(
          `Bunsen Burner ${item.active ? 'ignited (heating active)' : 'turned off'}.`,
          'info'
        );
      } else if (this.pointerDownMoved && item.kind === 'vessel') {
        const target = this.findOverlappingVessel(item);
        if (target) {
          this.transferVessels(item, target, 25);
          item.x = Math.max(20, target.x - item.width - 16);
          item.y = this.getBenchSurfaceY() - item.height + 8;
        }
      }
      this.hoveredDropVesselId = null;
    };

    this.canvas.addEventListener('pointerup', finishPointer);
    this.canvas.addEventListener('pointercancel', finishPointer);

    this.canvas.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
      const { x, y } = this.toCanvasCoords(e.clientX, e.clientY);
      const hit = this.hitTest(x, y);
      this.hoveredDropVesselId = hit && hit.kind === 'vessel' ? hit.id : null;
    });

    this.canvas.addEventListener('dragleave', () => {
      this.hoveredDropVesselId = null;
    });

    this.canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      this.hoveredDropVesselId = null;
      if (!e.dataTransfer) return;

      const equipType = e.dataTransfer.getData('application/x-chemlab-equipment') as EquipmentType;
      const speciesId = e.dataTransfer.getData('application/x-chemlab-species');

      if (equipType) {
        this.addEquipment(equipType, e.clientX, e.clientY);
      } else if (speciesId) {
        const { x, y } = this.toCanvasCoords(e.clientX, e.clientY);
        const hit = this.hitTest(x, y);
        const targetVessel =
          hit && hit.kind === 'vessel' ? hit : this.getSelectedVessel();
        if (targetVessel) {
          const sp = SPECIES[speciesId];
          const unit: PourUnit = sp?.phase === 's' ? 'g' : sp?.phase === 'g' ? 'mol' : 'mL';
          const defaultAmt = sp?.phase === 's' ? 1 : sp?.phase === 'g' ? 0.02 : 10;
          this.pourIntoVessel(targetVessel, speciesId, defaultAmt, unit);
        }
      }
    });
  }

  private toCanvasCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  private hitTest(x: number, y: number): BenchItem | null {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (x >= it.x && x <= it.x + it.width && y >= it.y && y <= it.y + it.height) {
        return it;
      }
    }
    return null;
  }

  private findOverlappingVessel(source: LabVessel): LabVessel | null {
    const sCx = source.x + source.width * 0.5;
    const sCy = source.y + source.height * 0.5;
    for (const v of this.getVessels()) {
      if (v.id === source.id) continue;
      const vCx = v.x + v.width * 0.5;
      const vCy = v.y + v.height * 0.5;
      if (Math.hypot(sCx - vCx, sCy - vCy) < 76) {
        return v;
      }
    }
    return null;
  }

  public render(): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const surfaceY = this.getBenchSurfaceY();

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    if (this.effects.shakeIntensity > 0.1) {
      ctx.translate(this.effects.shakeOffsetX, this.effects.shakeOffsetY);
    }

    // 1. Dark Instrument-Panel Back Wall + Subtle Grid
    ctx.fillStyle = '#0d1420';
    ctx.fillRect(0, 0, w, surfaceY);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.045)';
    ctx.lineWidth = 1;
    const gridStep = 40;
    ctx.beginPath();
    for (let gx = 0; gx < w; gx += gridStep) {
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, surfaceY);
    }
    for (let gy = 0; gy < surfaceY; gy += gridStep) {
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
    }
    ctx.stroke();

    // 2. Brushed Steel Backsplash & Wooden Lab Bench Surface
    ctx.fillStyle = '#263346';
    ctx.fillRect(0, surfaceY - 12, w, 12);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.moveTo(0, surfaceY - 12);
    ctx.lineTo(w, surfaceY - 12);
    ctx.stroke();

    const benchFrontEdgeY = surfaceY + Math.min(72, (h - surfaceY) * 0.64);
    ctx.fillStyle = '#3d2719';
    ctx.fillRect(0, surfaceY, w, benchFrontEdgeY - surfaceY);

    ctx.fillStyle = '#131b27';
    ctx.fillRect(0, benchFrontEdgeY, w, h - benchFrontEdgeY);

    ctx.strokeStyle = 'rgba(15, 8, 4, 0.35)';
    ctx.lineWidth = 1;
    const plankCount = 4;
    ctx.beginPath();
    for (let p = 1; p < plankCount; p++) {
      const py = surfaceY + ((benchFrontEdgeY - surfaceY) * p) / plankCount;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.fillRect(0, benchFrontEdgeY - 3, w, 6);

    // 3. Render Tools and Vessels
    const backgroundTools = this.getTools().filter(
      (t) => t.toolType === 'scale' || t.toolType === 'burner'
    );
    const foregroundTools = this.getTools().filter(
      (t) => t.toolType !== 'scale' && t.toolType !== 'burner'
    );

    for (const tool of backgroundTools) {
      this.renderTool(ctx, tool);
    }

    for (const vessel of this.getVessels()) {
      this.renderVessel(ctx, vessel);
    }

    for (const tool of foregroundTools) {
      this.renderTool(ctx, tool);
    }

    this.effects.renderOverlayEffects(ctx, w, h);

    ctx.restore();
  }

  private renderShatteredVessel(ctx: CanvasRenderingContext2D, vessel: LabVessel): void {
    const { x, y, width: w, height: h } = vessel;
    const cx = x + w * 0.5;
    const bottomY = y + h;

    ctx.save();

    // Spilled liquid puddle on the benchtop
    ctx.fillStyle = vessel.spilledColor || 'rgba(125, 211, 252, 0.42)';
    ctx.beginPath();
    ctx.ellipse(cx, bottomY + 3, w * 0.72, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Jagged shattered glass base stump
    ctx.fillStyle = 'rgba(226, 232, 240, 0.16)';
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.78)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x + 14, bottomY);
    ctx.lineTo(x + 14, bottomY - 22);
    ctx.lineTo(x + 28, bottomY - 10);
    ctx.lineTo(x + 42, bottomY - 28);
    ctx.lineTo(x + 58, bottomY - 14);
    ctx.lineTo(x + 74, bottomY - 26);
    ctx.lineTo(x + w - 16, bottomY - 16);
    ctx.lineTo(x + w - 14, bottomY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Scattered glass shards around base
    const shardOffsets = [
      [-38, 2, -12, -5, -24, 7],
      [-16, 6, 4, 2, -6, 10],
      [18, 4, 36, -2, 28, 9],
      [34, 6, 52, 1, 44, 11],
    ];
    ctx.fillStyle = 'rgba(186, 230, 253, 0.38)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 1.1;
    for (const [x1, y1, x2, y2, x3, y3] of shardOffsets) {
      ctx.beginPath();
      ctx.moveTo(cx + x1, bottomY + y1);
      ctx.lineTo(cx + x2, bottomY + y2);
      ctx.lineTo(cx + x3, bottomY + y3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    this.renderVesselBadge(ctx, vessel, vessel.id === this.selectedVesselId);
    ctx.restore();
  }

  private renderVessel(ctx: CanvasRenderingContext2D, vessel: LabVessel): void {
    if (vessel.burst) {
      this.renderShatteredVessel(ctx, vessel);
      return;
    }

    const { x, y, width: w, height: h, vesselType } = vessel;
    const isSelected = vessel.id === this.selectedVesselId;
    const isDropTarget = vessel.id === this.hoveredDropVesselId;

    ctx.save();

    // Contact shadow on bench surface
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.beginPath();
    ctx.ellipse(x + w * 0.5, y + h + 3, w * 0.44, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    if (isSelected || isDropTarget) {
      ctx.strokeStyle = isDropTarget ? '#34d399' : '#22d3ee';
      ctx.lineWidth = isDropTarget ? 2.5 : 1.8;
      ctx.setLineDash(isDropTarget ? [5, 3] : []);
      ctx.beginPath();
      ctx.ellipse(x + w * 0.5, y + h + 3, w * 0.52, 11, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const rawFillRatio = Math.max(0, Math.min(1, vessel.mixture.volumeL / vessel.capacityL));
    // Ensure even small synthesized liquid quantities (like 0.02 mol = 0.36 mL H2O) render a visible liquid layer
    const fillRatio =
      vessel.mixture.volumeL > 1e-5 ? Math.max(0.065, rawFillRatio) : 0;

    const innerTopY = y + 18;
    const innerBottomY = vesselType === 'test_tube' ? y + h - 14 : y + h - 8;
    const usableHeight = innerBottomY - innerTopY;
    const liquidHeight = fillRatio * usableHeight;
    const liquidTopY = innerBottomY - liquidHeight;

    const topBounds = this.getVesselHorizontalBoundsAtY(vessel, liquidTopY);
    const botBounds = this.getVesselHorizontalBoundsAtY(vessel, innerBottomY);

    // Headspace gas tint
    const gasInfo = getHeadspaceGasInfo(vessel.mixture);
    if (gasInfo.moles > 0) {
      this.traceVesselPath(ctx, vessel, true);
      ctx.fillStyle = gasInfo.color;
      ctx.fill();
    }

    // Wall condensation droplets when water was synthesized or mixture is warm
    if ((vessel.lastReactionsFired.includes('h2_o2_water') || vessel.mixture.tempK > 325) && vessel.mixture.moles.H2O) {
      ctx.fillStyle = 'rgba(186, 230, 253, 0.55)';
      for (let d = 0; d < 12; d++) {
        const dy = innerTopY + 14 + ((d * 19) % Math.max(20, usableHeight * 0.65));
        const b = this.getVesselHorizontalBoundsAtY(vessel, dy);
        const span = Math.max(12, b.right - b.left - 8);
        const dx = b.left + 4 + ((d * 23) % span);
        ctx.beginPath();
        ctx.arc(dx, dy, 1.8 + (d % 2) * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Liquid body with animated wave meniscus (geometric bounds, no expensive stencil clip)
    if (fillRatio > 0.002) {
      const liquidColor = blendMixtureColor(vessel.mixture);
      ctx.fillStyle = liquidColor;
      ctx.beginPath();
      const waveAmp = Math.min(2.6, 0.7 + (vessel.mixture.tempK > 350 ? 1.8 : 0.5));
      const steps = 12;
      const topSpan = topBounds.right - topBounds.left;
      ctx.moveTo(botBounds.left, innerBottomY);
      ctx.lineTo(topBounds.left, liquidTopY);
      for (let i = 0; i <= steps; i++) {
        const px = topBounds.left + (topSpan * i) / steps;
        const wy =
          liquidTopY +
          Math.sin((i / steps) * Math.PI * 2 + this.animTimeSec * 4.2) * waveAmp;
        ctx.lineTo(px, wy);
      }
      ctx.lineTo(botBounds.right, innerBottomY);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(x + w * 0.5, liquidTopY, Math.max(6, topSpan * 0.46), 2.8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Solid / Precipitate sediment bed
    const precip = getPrecipitateInfo(vessel.mixture);
    if (precip.massG > 0.001) {
      const sedHeight = Math.min(usableHeight * 0.28, 5 + Math.log10(1 + precip.massG * 6) * 9);
      const botSpan = botBounds.right - botBounds.left;
      ctx.fillStyle = precip.color;
      ctx.beginPath();
      ctx.ellipse(
        x + w * 0.5,
        innerBottomY - sedHeight * 0.35,
        Math.max(8, botSpan * 0.45),
        sedHeight,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    this.effects.renderVesselInternalEffects(ctx, vessel, liquidTopY, innerBottomY);

    if (vesselType === 'test_tube') {
      this.renderTestTubeRack(ctx, vessel);
    }

    this.traceVesselPath(ctx, vessel, false);
    ctx.fillStyle = 'rgba(205, 235, 255, 0.055)';
    ctx.fill();

    ctx.strokeStyle = isSelected
      ? 'rgba(34, 211, 238, 0.88)'
      : vesselType === 'gas_jar'
        ? 'rgba(148, 163, 184, 0.78)'
        : 'rgba(226, 232, 240, 0.58)';
    ctx.lineWidth = vesselType === 'gas_jar' ? 2.6 : isSelected ? 2.2 : 1.6;
    ctx.stroke();

    // Specular vertical glass reflection streak
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (vesselType === 'beaker' || vesselType === 'gas_jar') {
      ctx.moveTo(x + 14, y + 24);
      ctx.lineTo(x + 14, y + h - 16);
    } else if (vesselType === 'flask') {
      ctx.moveTo(x + w * 0.36, y + 24);
      ctx.lineTo(x + 15, y + h - 16);
    } else {
      ctx.moveTo(x + w * 0.32, y + 20);
      ctx.lineTo(x + w * 0.32, y + h - 22);
    }
    ctx.stroke();

    this.renderGraduations(ctx, vessel, innerTopY, innerBottomY);

    if (vessel.closed) {
      const neckW =
        vesselType === 'flask'
          ? w * 0.34
          : vesselType === 'test_tube'
            ? w * 0.46
            : vesselType === 'gas_jar'
              ? w * 0.76
              : w * 0.82;
      const sx = x + (w - neckW) * 0.5;
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.roundRect(sx, y + 4, neckW, 13, 3);
      ctx.fill();
      ctx.stroke();
    }

    this.renderVesselBadge(ctx, vessel, isSelected);

    ctx.restore();
  }

  private getVesselHorizontalBoundsAtY(
    vessel: LabVessel,
    yPos: number
  ): { left: number; right: number } {
    const { x, y, width: w, height: h, vesselType } = vessel;
    if (vesselType === 'beaker') {
      return { left: x + 8, right: x + w - 8 };
    }
    if (vesselType === 'gas_jar') {
      return { left: x + 10, right: x + w - 10 };
    }
    if (vesselType === 'test_tube') {
      const cx = x + w * 0.5;
      const half = w * 0.23 - 2;
      return { left: cx - half, right: cx + half };
    }
    // flask (Erlenmeyer cone)
    const cx = x + w * 0.5;
    const neckHalf = w * 0.16 - 2;
    const baseHalf = w * 0.45 - 3;
    const neckBottom = y + h * 0.36;
    const bottom = y + h - 8;
    if (yPos <= neckBottom) {
      return { left: cx - neckHalf, right: cx + neckHalf };
    }
    const t = Math.max(0, Math.min(1, (yPos - neckBottom) / Math.max(1, bottom - neckBottom)));
    const half = neckHalf + t * (baseHalf - neckHalf);
    return { left: cx - half, right: cx + half };
  }

  private traceVesselPath(
    ctx: CanvasRenderingContext2D,
    vessel: LabVessel,
    insetForClip: boolean
  ): void {
    const pad = insetForClip ? 2 : 0;
    const x = vessel.x + pad;
    const y = vessel.y + pad;
    const w = vessel.width - pad * 2;
    const h = vessel.height - pad * 2;

    ctx.beginPath();
    if (vessel.vesselType === 'beaker') {
      const left = x + 6;
      const right = x + w - 6;
      const top = y + 12;
      const bottom = y + h - 6;
      ctx.moveTo(left - 4, top);
      ctx.lineTo(left, top + 6);
      ctx.lineTo(left, bottom - 10);
      ctx.quadraticCurveTo(left, bottom, left + 10, bottom);
      ctx.lineTo(right - 10, bottom);
      ctx.quadraticCurveTo(right, bottom, right, bottom - 10);
      ctx.lineTo(right, top);
      ctx.closePath();
    } else if (vessel.vesselType === 'gas_jar') {
      const left = x + 8;
      const right = x + w - 8;
      const top = y + 12;
      const bottom = y + h - 6;
      // Thick-walled gas jar with ground-glass top flange
      ctx.moveTo(left - 5, top);
      ctx.lineTo(left - 5, top + 5);
      ctx.lineTo(left, top + 7);
      ctx.lineTo(left, bottom - 8);
      ctx.quadraticCurveTo(left, bottom, left + 8, bottom);
      ctx.lineTo(right - 8, bottom);
      ctx.quadraticCurveTo(right, bottom, right, bottom - 8);
      ctx.lineTo(right, top + 7);
      ctx.lineTo(right + 5, top + 5);
      ctx.lineTo(right + 5, top);
      ctx.closePath();
    } else if (vessel.vesselType === 'flask') {
      const cx = x + w * 0.5;
      const neckHalf = w * 0.16;
      const baseHalf = w * 0.45;
      const top = y + 10;
      const neckBottom = y + h * 0.36;
      const bottom = y + h - 6;

      ctx.moveTo(cx - neckHalf - 3, top);
      ctx.lineTo(cx - neckHalf, top + 5);
      ctx.lineTo(cx - neckHalf, neckBottom);
      ctx.lineTo(cx - baseHalf, bottom - 12);
      ctx.quadraticCurveTo(cx - baseHalf, bottom, cx - baseHalf + 12, bottom);
      ctx.lineTo(cx + baseHalf - 12, bottom);
      ctx.quadraticCurveTo(cx + baseHalf, bottom, cx + baseHalf, bottom - 12);
      ctx.lineTo(cx + neckHalf, neckBottom);
      ctx.lineTo(cx + neckHalf, top + 5);
      ctx.lineTo(cx + neckHalf + 3, top);
      ctx.closePath();
    } else {
      const cx = x + w * 0.5;
      const tubeHalf = w * 0.23;
      const top = y + 10;
      const bottom = y + h - 12;
      ctx.moveTo(cx - tubeHalf - 2, top);
      ctx.lineTo(cx - tubeHalf, top + 4);
      ctx.lineTo(cx - tubeHalf, bottom - tubeHalf);
      ctx.arc(cx, bottom - tubeHalf, tubeHalf, Math.PI, 0, true);
      ctx.lineTo(cx + tubeHalf, top + 4);
      ctx.lineTo(cx + tubeHalf + 2, top);
      ctx.closePath();
    }
  }

  private renderTestTubeRack(ctx: CanvasRenderingContext2D, vessel: LabVessel): void {
    const { x, y, width: w, height: h } = vessel;
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.fillStyle = 'rgba(30, 41, 59, 0.78)';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.roundRect(x + 4, y + h - 10, w - 8, 8, 3);
    ctx.roundRect(x + 6, y + h * 0.46, w - 12, 6, 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + 11, y + h * 0.46 + 6);
    ctx.lineTo(x + 11, y + h - 10);
    ctx.moveTo(x + w - 11, y + h * 0.46 + 6);
    ctx.lineTo(x + w - 11, y + h - 10);
    ctx.stroke();
    ctx.restore();
  }

  private renderGraduations(
    ctx: CanvasRenderingContext2D,
    vessel: LabVessel,
    topY: number,
    bottomY: number
  ): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.52)';
    ctx.font = '600 9px "JetBrains Mono", ui-monospace, monospace';
    ctx.lineWidth = 1;

    const marks =
      vessel.vesselType === 'test_tube'
        ? [10, 20, 30, 40]
        : vessel.vesselType === 'gas_jar'
          ? [100, 200, 300, 400]
          : [50, 100, 150, 200];
    const maxML = vessel.capacityL * 1000;
    const rightX =
      vessel.vesselType === 'test_tube'
        ? vessel.x + vessel.width * 0.5 + vessel.width * 0.22
        : vessel.x + vessel.width - 18;

    for (const ml of marks) {
      const frac = ml / maxML;
      const my = bottomY - frac * (bottomY - topY);
      ctx.beginPath();
      ctx.moveTo(rightX - 8, my);
      ctx.lineTo(rightX, my);
      ctx.stroke();
      if (vessel.vesselType !== 'test_tube' || ml % 20 === 0) {
        ctx.fillText(`${ml}`, rightX - 24, my + 3);
      }
    }
    ctx.restore();
  }

  private renderVesselBadge(
    ctx: CanvasRenderingContext2D,
    vessel: LabVessel,
    isSelected: boolean
  ): void {
    const cx = vessel.x + vessel.width * 0.5;
    const badgeY = vessel.y + vessel.height + 10;

    ctx.save();
    const badgeW = 128;
    const badgeH = 34;
    ctx.fillStyle = vessel.burst
      ? 'rgba(127, 29, 29, 0.92)'
      : isSelected
        ? 'rgba(15, 23, 42, 0.92)'
        : 'rgba(15, 23, 42, 0.78)';
    ctx.strokeStyle = vessel.burst
      ? 'rgba(248, 113, 113, 0.85)'
      : isSelected
        ? 'rgba(34, 211, 238, 0.65)'
        : 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(cx - badgeW * 0.5, badgeY, badgeW, badgeH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = vessel.burst ? '#fecdd3' : isSelected ? '#22d3ee' : '#e2e8f0';
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(vessel.label, cx, badgeY + 13);

    ctx.fillStyle = vessel.burst ? '#fda4af' : '#94a3b8';
    ctx.font = '500 9px "JetBrains Mono", ui-monospace, monospace';
    if (vessel.burst) {
      ctx.fillText('SHATTERED (RESET)', cx, badgeY + 26);
    } else {
      const tempC = (vessel.mixture.tempK - 273.15).toFixed(1);
      const volML =
        vessel.mixture.volumeL > 0 && vessel.mixture.volumeL < 0.001
          ? (vessel.mixture.volumeL * 1000).toFixed(2)
          : (vessel.mixture.volumeL * 1000).toFixed(0);
      const phVal = this.getCachedPh(vessel).toFixed(1);
      ctx.fillText(`${volML}mL · ${tempC}°C · pH ${phVal}`, cx, badgeY + 26);
    }
    ctx.restore();
  }

  public getCachedPh(vessel: LabVessel): number {
    const keys = Object.keys(vessel.mixture.moles);
    if (keys.length === 0) return 7.0;
    let sig = `${vessel.mixture.volumeL.toFixed(6)}:`;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      sig += `${k}=${(vessel.mixture.moles[k] ?? 0).toFixed(6)},`;
    }
    const cache = vessel as LabVessel & { _phSig?: string; _phVal?: number };
    if (cache._phSig === sig && cache._phVal !== undefined) {
      return cache._phVal;
    }
    const computed = pH(vessel.mixture);
    cache._phSig = sig;
    cache._phVal = computed;
    return computed;
  }

  private renderTool(ctx: CanvasRenderingContext2D, tool: LabTool): void {
    const { x, y, width: w, height: h, toolType } = tool;
    ctx.save();

    if (toolType === 'burner') {
      const cx = x + w * 0.5;
      const bottomY = y + h;
      const nozzleTopY = y + 36;

      if (tool.active) {
        this.effects.renderBurnerFlame(ctx, cx, nozzleTopY, this.animTimeSec);
      }

      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.roundRect(x + 14, bottomY - 12, w - 28, 12, 4);
      ctx.fill();

      ctx.fillStyle = '#475569';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(cx - 7, nozzleTopY, 14, h - 48, 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = tool.active ? '#f59e0b' : '#b45309';
      ctx.fillRect(cx - 9, bottomY - 24, 18, 8);

      ctx.fillStyle = tool.active ? '#fb923c' : '#94a3b8';
      ctx.font = '600 9.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(tool.active ? 'BURNER ON' : 'BURNER OFF', cx, bottomY + 13);
    } else if (toolType === 'scale') {
      let weighedMassG = 0;
      const sCx = x + w * 0.5;
      for (const v of this.getVessels()) {
        const vCx = v.x + v.width * 0.5;
        if (Math.abs(vCx - sCx) < 75) {
          weighedMassG += v.mixture.totalMass();
        }
      }

      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y + 10, w, h - 10, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.beginPath();
      ctx.roundRect(x + 12, y + 3, w - 24, 7, 3);
      ctx.fill();

      ctx.fillStyle = '#062c30';
      ctx.strokeStyle = '#0891b2';
      ctx.beginPath();
      ctx.roundRect(x + 22, y + 18, w - 44, 24, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#22d3ee';
      ctx.font = '700 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${weighedMassG.toFixed(2)} g`, x + w * 0.5, y + 35);
    } else if (toolType === 'thermometer') {
      const target = this.findNearestVessel(x + w * 0.5, y + h * 0.5) ?? this.getSelectedVessel();
      const tempK = target ? target.mixture.tempK : 298.15;
      const tempC = tempK - 273.15;

      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 42, 6);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.5, y + 42);
      ctx.lineTo(x + w * 0.5, y + h - 8);
      ctx.stroke();

      ctx.fillStyle = tempC > 50 ? '#fb923c' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(x + w * 0.5, y + h - 6, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 10.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${tempC.toFixed(1)}°C`, x + w * 0.5, y + 18);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.fillText(`${tempK.toFixed(1)}K`, x + w * 0.5, y + 33);
    } else if (toolType === 'ph_meter') {
      const target = this.findNearestVessel(x + w * 0.5, y + h * 0.5) ?? this.getSelectedVessel();
      const val = target ? this.getCachedPh(target) : 7.0;
      const phColor = val < 6.5 ? '#f43f5e' : val > 7.5 ? '#38bdf8' : '#10b981';

      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = phColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 46, 6);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.5, y + 46);
      ctx.lineTo(x + w * 0.5, y + h - 8);
      ctx.stroke();

      ctx.fillStyle = phColor;
      ctx.beginPath();
      ctx.arc(x + w * 0.5, y + h - 6, 4.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('pH METER', x + w * 0.5, y + 14);

      ctx.fillStyle = phColor;
      ctx.font = '700 12.5px "JetBrains Mono", monospace';
      ctx.fillText(val.toFixed(2), x + w * 0.5, y + 34);
    } else if (toolType === 'pipette') {
      const cx = x + w * 0.5;
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.roundRect(cx - 9, y, 18, 26, 8);
      ctx.fill();

      ctx.strokeStyle = 'rgba(226, 232, 240, 0.8)';
      ctx.fillStyle = 'rgba(186, 230, 253, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(cx - 4.5, y + 24, 9, h - 34, 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Pipette', cx, y + h + 10);
    }

    ctx.restore();
  }

  private findNearestVessel(x: number, y: number): LabVessel | null {
    let best: LabVessel | null = null;
    let bestDist = 135;
    for (const v of this.getVessels()) {
      const d = Math.hypot(v.x + v.width * 0.5 - x, v.y + v.height * 0.5 - y);
      if (d < bestDist) {
        bestDist = d;
        best = v;
      }
    }
    return best;
  }
}
