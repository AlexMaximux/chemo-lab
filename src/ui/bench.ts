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
  formatFormula,
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
  transferBetweenVessels,
} from './equipment';

export interface BenchCallbacks {
  onSelectVessel: (vessel: LabVessel | null) => void;
  onLogEvent: (action: string, details: string, vessel?: LabVessel, extra?: { reaction?: string; hazards?: string[] }) => void;
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

  private width = 860;
  private height = 520;
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

    const beaker1 = createVessel('beaker', 180, 228, 'Beaker A (250mL)');
    const flask1 = createVessel('flask', 370, 220, 'Flask B (250mL)');
    const tube1 = createVessel('test_tube', 560, 224, 'Tube C (50mL)');

    const burner = createTool('burner', 384, 344);
    burner.active = false; // Off initially until user toggles or heats

    const scale = createTool('scale', 162, 356);
    const phMeter = createTool('ph_meter', 675, 246);
    const thermometer = createTool('thermometer', 758, 238);

    this.items.push(scale, burner, beaker1, flask1, tube1, phMeter, thermometer);
    this.selectedVesselId = beaker1.id;
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
    this.callbacks.onSelectVessel(this.getSelectedVessel());
  }

  public addEquipment(type: EquipmentType, clientX?: number, clientY?: number): BenchItem {
    const rect = this.canvas.getBoundingClientRect();
    let x = this.width * 0.45 + (Math.random() - 0.5) * 120;
    let y = this.getBenchSurfaceY() - 140;

    if (clientX !== undefined && clientY !== undefined && rect.width > 0) {
      x = Math.max(40, Math.min(this.width - 140, clientX - rect.left - 50));
      y = Math.max(60, Math.min(this.getBenchSurfaceY() - 60, clientY - rect.top - 70));
    }

    if (isVesselType(type)) {
      const count = this.getVessels().filter((v) => v.vesselType === type).length + 1;
      const prefix = type === 'beaker' ? 'Beaker' : type === 'flask' ? 'Flask' : 'Test Tube';
      const cap = type === 'test_tube' ? '50mL' : '250mL';
      const vessel = createVessel(type, x, this.getBenchSurfaceY() - 142, `${prefix} #${count} (${cap})`);
      this.items.push(vessel);
      this.selectVessel(vessel.id);
      this.callbacks.onLogEvent('equipment', `Placed ${vessel.label} on the bench`, vessel);
      return vessel;
    } else {
      const tool = createTool(type, x, this.getBenchSurfaceY() - 115);
      this.items.push(tool);
      this.callbacks.onLogEvent('equipment', `Placed ${tool.label} on the bench`);
      return tool;
    }
  }

  public removeVessel(vesselId: string): void {
    const idx = this.items.findIndex((i) => i.id === vesselId);
    if (idx >= 0) {
      const removed = this.items[idx];
      this.items.splice(idx, 1);
      this.callbacks.onLogEvent('equipment', `Removed ${removed.label} from the bench`);
      if (this.selectedVesselId === vesselId) {
        const next = this.getVessels()[0] ?? null;
        this.selectVessel(next ? next.id : null);
      }
    }
  }

  public rinseVessel(vessel: LabVessel): void {
    vessel.mixture.moles = {};
    vessel.mixture.volumeL = 0;
    vessel.mixture.tempK = 298.15;
    vessel.overflowWarning = false;
    vessel.burst = false;
    vessel.lastReactionsFired = [];
    vessel.lastStepResult = {
      reactionsFired: [],
      heatJ: 0,
      tempK: 298.15,
      pressureKPa: 0,
      hazards: [],
    };
    this.callbacks.onLogEvent('rinse', `Rinsed and emptied ${vessel.label}`, vessel);
    this.callbacks.onNotice(`Rinsed ${vessel.label} (25.0 °C, empty).`, 'info');
    this.callbacks.onSelectVessel(vessel);
  }

  public toggleVesselStopper(vessel: LabVessel, closed?: boolean): void {
    vessel.closed = closed ?? !vessel.closed;
    vessel.simulator.closed = vessel.closed;
    this.callbacks.onLogEvent(
      'stopper',
      `${vessel.closed ? 'Stoppered (closed)' : 'Unstoppered (open)'} ${vessel.label}`,
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

    // Step simulation briefly to trigger immediate fast reactions
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
    target.simulator.ignite();
    this.effects.triggerIgnitionFlare(target, false);
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
    this.callbacks.onLogEvent('transfer', res.message, target);
    this.stepVesselSimulation(target, 0.1);
    this.selectVessel(target.id);
  }

  public tick(dtRealSeconds: number): void {
    this.animTimeSec += dtRealSeconds;

    if (!this.paused) {
      const simDt = Math.min(0.2, dtRealSeconds) * this.speedMultiplier;
      this.simElapsedSeconds += simDt;

      // Active burners heat vessels directly above or near them
      const burners = this.getTools().filter((t) => t.toolType === 'burner' && t.active);
      const vessels = this.getVessels();

      for (const burner of burners) {
        const bCx = burner.x + burner.width * 0.5;
        const bTop = burner.y;
        for (const v of vessels) {
          const vCx = v.x + v.width * 0.5;
          const vBottom = v.y + v.height;
          if (Math.abs(vCx - bCx) < 88 && Math.abs(vBottom - bTop) < 120) {
            v.simulator.heat(burner.powerWatts * simDt);
          }
        }
      }

      for (const v of vessels) {
        this.stepVesselSimulation(v, simDt);
      }

      this.callbacks.onSimSample(this.simElapsedSeconds, this.getSelectedVessel());
    }

    this.effects.update(dtRealSeconds, this.getVessels());
    this.render();
  }

  private stepVesselSimulation(vessel: LabVessel, simDt: number): void {
    vessel.simulator.vesselL = vessel.capacityL;
    vessel.simulator.closed = vessel.closed;

    const beforeGasMoles = getHeadspaceGasInfo(vessel.mixture).moles;
    const beforePrecipMass = getPrecipitateInfo(vessel.mixture).massG;

    const result = vessel.simulator.step(simDt);
    vessel.lastStepResult = result;

    // Clamp liquid volume if reaction produced liquid exceeding capacity
    if (vessel.mixture.volumeL > vessel.capacityL) {
      vessel.mixture.volumeL = vessel.capacityL;
      vessel.overflowWarning = true;
    }

    if (result.reactionsFired.length > 0) {
      vessel.lastReactionsFired = result.reactionsFired;

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
          // Check for gas evolution
          const producesGas = Object.keys(rxn.products).some(
            (pId) => SPECIES[pId]?.phase === 'g'
          );
          if (producesGas) {
            this.effects.triggerGasEvolution(vessel, 22);
          }

          // Check for precipitate formation
          const precipSpId = Object.keys(rxn.products).find(
            (pId) => SPECIES[pId]?.phase === 's'
          );
          if (precipSpId) {
            const pColor = SPECIES[precipSpId]?.color ?? '#f3f4f6';
            this.effects.triggerPrecipitate(vessel, pColor, 26);
          }

          // Check for water / steam condensation or high exothermic heat
          if (rxn.products.H2O || rxn.products['H2O(g)'] || rxn.dH < -150) {
            this.effects.triggerCondensationAndVapor(vessel, 16);
          }

          // Check for combustion / ignition flame
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

    if (result.hazards.length > 0) {
      const isExplosiveOrBurst =
        result.hazards.includes('explosive') || result.hazards.includes('burst');
      if (isExplosiveOrBurst) {
        if (result.hazards.includes('burst')) {
          vessel.burst = true;
          vessel.closed = false;
          vessel.simulator.closed = false;
        }
        this.effects.triggerExplosion(vessel);
      }

      const eqSummary =
        result.reactionsFired.length > 0
          ? result.reactionsFired.map((id) => formatReactionEquation(id)).join(' ; ')
          : result.hazards.includes('burst')
            ? `Internal gas pressure (${result.pressureKPa.toFixed(0)} kPa) ruptured ${vessel.label}!`
            : `Hazardous condition in ${vessel.label}`;

      this.callbacks.onHazard(result.hazards, eqSummary, vessel);
    }
  }

  public resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(520, Math.floor(rect.width));
    this.height = Math.max(340, Math.floor(rect.height));

    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Keep equipment resting nicely near bench surface if viewport resized
    const surfaceY = this.getBenchSurfaceY();
    for (const item of this.items) {
      item.x = Math.max(16, Math.min(this.width - item.width - 16, item.x));
      item.y = Math.max(32, Math.min(surfaceY - item.height + 24, item.y));
    }
    this.render();
  }

  public getBenchSurfaceY(): number {
    return Math.floor(this.height * 0.74);
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

      if (Math.hypot(x - this.dragStartX, y - this.dragStartY) > 5) {
        this.pointerDownMoved = true;
      }

      this.canvas.style.cursor = 'grabbing';
      const surfaceY = this.getBenchSurfaceY();
      this.draggingItem.x = Math.max(
        12,
        Math.min(this.width - this.draggingItem.width - 12, x - this.dragOffsetX)
      );
      this.draggingItem.y = Math.max(
        20,
        Math.min(surfaceY - this.draggingItem.height + 28, y - this.dragOffsetY)
      );

      // Highlight target vessel if dragging a vessel or pipette over another vessel
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
        // Ignore if not captured
      }

      if (!this.pointerDownMoved && item.kind === 'tool' && item.toolType === 'burner') {
        item.active = !item.active;
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
          // Pour 25 mL from dragged vessel into target vessel, then snap dragged vessel alongside it
          this.transferVessels(item, target, 25);
          item.x = Math.max(20, target.x - item.width - 18);
          item.y = this.getBenchSurfaceY() - item.height + 8;
        }
      }
      this.hoveredDropVesselId = null;
    };

    this.canvas.addEventListener('pointerup', finishPointer);
    this.canvas.addEventListener('pointercancel', finishPointer);

    // HTML5 Drag & Drop from bottom toolbar (equipment or chemical card)
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
          const defaultAmt = sp?.phase === 's' ? 1 : sp?.phase === 'g' ? 0.5 : 10;
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
    // Check top-most items first
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

    // Apply explosion shake transform if active
    if (this.effects.shakeIntensity > 0.1) {
      ctx.translate(this.effects.shakeOffsetX, this.effects.shakeOffsetY);
    }

    // 1. Dark Instrument-Panel Back Wall + Overhead Spotlight
    const wallGrad = ctx.createLinearGradient(0, 0, 0, surfaceY);
    wallGrad.addColorStop(0, '#090d15');
    wallGrad.addColorStop(0.65, '#0f1623');
    wallGrad.addColorStop(1, '#141d2e');
    ctx.fillStyle = wallGrad;
    ctx.fillRect(0, 0, w, surfaceY);

    // Subtle technical calibration grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.045)';
    ctx.lineWidth = 1;
    const gridStep = 40;
    for (let gx = 0; gx < w; gx += gridStep) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, surfaceY);
      ctx.stroke();
    }
    for (let gy = 0; gy < surfaceY; gy += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    // Overhead laboratory spotlight cone
    const spotGrad = ctx.createRadialGradient(w * 0.48, 20, 10, w * 0.48, surfaceY * 0.65, w * 0.6);
    spotGrad.addColorStop(0, 'rgba(34, 211, 238, 0.065)');
    spotGrad.addColorStop(0.6, 'rgba(15, 23, 42, 0.02)');
    spotGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = spotGrad;
    ctx.fillRect(0, 0, w, surfaceY);

    // 2. Brushed Steel Backsplash Trim & Wooden Lab Bench Surface
    // Backsplash ledge
    const railGrad = ctx.createLinearGradient(0, surfaceY - 14, 0, surfaceY);
    railGrad.addColorStop(0, '#1e293b');
    railGrad.addColorStop(0.5, '#334155');
    railGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = railGrad;
    ctx.fillRect(0, surfaceY - 12, w, 12);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.moveTo(0, surfaceY - 12);
    ctx.lineTo(w, surfaceY - 12);
    ctx.stroke();

    // Warm dark walnut / teak butcher-block bench surface
    const woodGrad = ctx.createLinearGradient(0, surfaceY, 0, h);
    woodGrad.addColorStop(0, '#3b2618');
    woodGrad.addColorStop(0.18, '#4a3020');
    woodGrad.addColorStop(0.55, '#362215');
    woodGrad.addColorStop(0.66, '#24150c');
    woodGrad.addColorStop(0.7, '#1b2432'); // Under-bench steel cabinet fascia
    woodGrad.addColorStop(1, '#0b1019');
    ctx.fillStyle = woodGrad;
    ctx.fillRect(0, surfaceY, w, h - surfaceY);

    // Butcher-block horizontal plank seams & subtle grain
    const benchFrontEdgeY = surfaceY + Math.min(74, (h - surfaceY) * 0.64);
    ctx.strokeStyle = 'rgba(15, 8, 4, 0.35)';
    ctx.lineWidth = 1;
    const plankCount = 4;
    for (let p = 1; p < plankCount; p++) {
      const py = surfaceY + ((benchFrontEdgeY - surfaceY) * p) / plankCount;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    // Specular varnish sheen across wooden benchtop
    const sheenGrad = ctx.createLinearGradient(0, surfaceY, w, benchFrontEdgeY);
    sheenGrad.addColorStop(0, 'rgba(255, 255, 255, 0.02)');
    sheenGrad.addColorStop(0.45, 'rgba(255, 248, 235, 0.065)');
    sheenGrad.addColorStop(1, 'rgba(255, 255, 255, 0.015)');
    ctx.fillStyle = sheenGrad;
    ctx.fillRect(0, surfaceY, w, benchFrontEdgeY - surfaceY);

    // Brushed steel front bullnose edge strip
    const edgeGrad = ctx.createLinearGradient(0, benchFrontEdgeY - 4, 0, benchFrontEdgeY + 6);
    edgeGrad.addColorStop(0, '#64748b');
    edgeGrad.addColorStop(0.4, '#94a3b8');
    edgeGrad.addColorStop(1, '#1e293b');
    ctx.fillStyle = edgeGrad;
    ctx.fillRect(0, benchFrontEdgeY - 3, w, 8);

    // 3. Render Tools first (scales, burners), then Vessels, then Probe Tools
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

    // 4. Render overlay particle effects (vapors, flares, shockwaves, explosion flash)
    this.effects.renderOverlayEffects(ctx, w, h);

    ctx.restore();
  }

  private renderVessel(ctx: CanvasRenderingContext2D, vessel: LabVessel): void {
    const { x, y, width: w, height: h, vesselType } = vessel;
    const isSelected = vessel.id === this.selectedVesselId;
    const isDropTarget = vessel.id === this.hoveredDropVesselId;

    ctx.save();

    // Contact shadow on bench surface
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.beginPath();
    ctx.ellipse(x + w * 0.5, y + h + 3, w * 0.44, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Selection or drop-target ring around base
    if (isSelected || isDropTarget) {
      ctx.strokeStyle = isDropTarget ? '#34d399' : '#22d3ee';
      ctx.lineWidth = isDropTarget ? 2.5 : 1.8;
      ctx.setLineDash(isDropTarget ? [5, 3] : []);
      ctx.beginPath();
      ctx.ellipse(x + w * 0.5, y + h + 3, w * 0.52, 11, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const fillRatio = Math.max(0, Math.min(1, vessel.mixture.volumeL / vessel.capacityL));
    const innerTopY = y + 18;
    const innerBottomY = vesselType === 'test_tube' ? y + h - 14 : y + h - 8;
    const usableHeight = innerBottomY - innerTopY;
    const liquidHeight = fillRatio * usableHeight;
    const liquidTopY = innerBottomY - liquidHeight;

    // Build interior clip path for glassware
    ctx.save();
    this.traceVesselPath(ctx, vessel, true);
    ctx.clip();

    // Headspace gas tint
    const gasInfo = getHeadspaceGasInfo(vessel.mixture);
    if (gasInfo.moles > 0) {
      ctx.fillStyle = gasInfo.color;
      ctx.fillRect(x, innerTopY, w, usableHeight);
    }

    // Liquid body with animated wave meniscus
    if (fillRatio > 0.002) {
      const liquidColor = blendMixtureColor(vessel.mixture);
      ctx.fillStyle = liquidColor;
      ctx.beginPath();
      const waveAmp = Math.min(2.8, 0.8 + (vessel.mixture.tempK > 350 ? 2.0 : 0.6));
      const steps = 16;
      ctx.moveTo(x, innerBottomY + 10);
      ctx.lineTo(x, liquidTopY);
      for (let i = 0; i <= steps; i++) {
        const px = x + (w * i) / steps;
        const wy =
          liquidTopY +
          Math.sin((i / steps) * Math.PI * 2 + this.animTimeSec * 4.2) * waveAmp;
        ctx.lineTo(px, wy);
      }
      ctx.lineTo(x + w, innerBottomY + 10);
      ctx.closePath();
      ctx.fill();

      // Bright meniscus surface highlight
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x + w * 0.5, liquidTopY, w * 0.42, 3.2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Solid / Precipitate sediment bed at the bottom of the vessel
    const precip = getPrecipitateInfo(vessel.mixture);
    if (precip.massG > 0.001) {
      const sedHeight = Math.min(usableHeight * 0.28, 5 + Math.log10(1 + precip.massG * 6) * 9);
      ctx.fillStyle = precip.color;
      ctx.beginPath();
      ctx.ellipse(
        x + w * 0.5,
        innerBottomY - sedHeight * 0.35,
        w * 0.42,
        sedHeight,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    // Internal bubbles, falling precipitate, and pour stream
    this.effects.renderVesselInternalEffects(ctx, vessel, liquidTopY, innerBottomY);
    ctx.restore(); // End vessel interior clip

    // Test tube rack if test_tube
    if (vesselType === 'test_tube') {
      this.renderTestTubeRack(ctx, vessel);
    }

    // Glassware outer walls & rim highlights
    this.traceVesselPath(ctx, vessel, false);
    const glassFill = ctx.createLinearGradient(x, y, x + w, y);
    glassFill.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
    glassFill.addColorStop(0.2, 'rgba(255, 255, 255, 0.03)');
    glassFill.addColorStop(0.82, 'rgba(255, 255, 255, 0.02)');
    glassFill.addColorStop(1, 'rgba(186, 230, 253, 0.16)');
    ctx.fillStyle = glassFill;
    ctx.fill();

    ctx.strokeStyle = isSelected
      ? 'rgba(34, 211, 238, 0.85)'
      : vessel.burst
        ? 'rgba(248, 113, 113, 0.85)'
        : 'rgba(226, 232, 240, 0.58)';
    ctx.lineWidth = isSelected ? 2.2 : 1.6;
    ctx.stroke();

    // Specular vertical glass reflection streak
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (vesselType === 'beaker') {
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

    // Volumetric graduation ticks
    this.renderGraduations(ctx, vessel, innerTopY, innerBottomY);

    // Rubber Stopper if vessel is closed
    if (vessel.closed) {
      const neckW = vesselType === 'flask' ? w * 0.34 : vesselType === 'test_tube' ? w * 0.46 : w * 0.82;
      const sx = x + (w - neckW) * 0.5;
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(sx, y + 4, neckW, 13, 3);
      ctx.fill();
      ctx.stroke();
    }

    // Floating Telemetry Label Pill below vessel
    this.renderVesselBadge(ctx, vessel, isSelected);

    ctx.restore();
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
      ctx.moveTo(left - 4, top); // Pouring lip flare
      ctx.lineTo(left, top + 6);
      ctx.lineTo(left, bottom - 10);
      ctx.quadraticCurveTo(left, bottom, left + 10, bottom);
      ctx.lineTo(right - 10, bottom);
      ctx.quadraticCurveTo(right, bottom, right, bottom - 10);
      ctx.lineTo(right, top);
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
      // test_tube
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

    // Base & upper support bar
    ctx.beginPath();
    ctx.roundRect(x + 4, y + h - 10, w - 8, 8, 3);
    ctx.roundRect(x + 6, y + h * 0.46, w - 12, 6, 2);
    ctx.fill();
    ctx.stroke();

    // Side pillars
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

    const marks = vessel.vesselType === 'test_tube' ? [10, 20, 30, 40] : [50, 100, 150, 200];
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
    const badgeY = vessel.y + vessel.height + 12;
    const tempC = (vessel.mixture.tempK - 273.15).toFixed(1);
    const volML = (vessel.mixture.volumeL * 1000).toFixed(0);
    const hasContents = Object.keys(vessel.mixture.moles).length > 0;
    const phVal = hasContents ? pH(vessel.mixture).toFixed(1) : '7.0';

    ctx.save();
    const badgeW = 128;
    const badgeH = 34;
    ctx.fillStyle = isSelected ? 'rgba(15, 23, 42, 0.92)' : 'rgba(15, 23, 42, 0.78)';
    ctx.strokeStyle = isSelected ? 'rgba(34, 211, 238, 0.65)' : 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(cx - badgeW * 0.5, badgeY, badgeW, badgeH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isSelected ? '#22d3ee' : '#e2e8f0';
    ctx.font = '600 10.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(vessel.label, cx, badgeY + 13);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 9.5px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(`${volML}mL · ${tempC}°C · pH ${phVal}`, cx, badgeY + 27);
    ctx.restore();
  }

  private renderTool(ctx: CanvasRenderingContext2D, tool: LabTool): void {
    const { x, y, width: w, height: h, toolType } = tool;
    ctx.save();

    if (toolType === 'burner') {
      const cx = x + w * 0.5;
      const bottomY = y + h;
      const nozzleTopY = y + 36;

      // Render flame if active
      if (tool.active) {
        this.effects.renderBurnerFlame(ctx, cx, nozzleTopY, this.animTimeSec);
      }

      // Base
      const baseGrad = ctx.createLinearGradient(x + 12, bottomY - 14, x + w - 12, bottomY);
      baseGrad.addColorStop(0, '#334155');
      baseGrad.addColorStop(0.5, '#64748b');
      baseGrad.addColorStop(1, '#1e293b');
      ctx.fillStyle = baseGrad;
      ctx.beginPath();
      ctx.roundRect(x + 14, bottomY - 12, w - 28, 12, 4);
      ctx.fill();

      // Chimney barrel
      ctx.fillStyle = '#475569';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(cx - 7, nozzleTopY, 14, h - 48, 2);
      ctx.fill();
      ctx.stroke();

      // Brass air collar
      ctx.fillStyle = tool.active ? '#f59e0b' : '#b45309';
      ctx.fillRect(cx - 9, bottomY - 24, 18, 8);

      // Status pill
      ctx.fillStyle = tool.active ? '#fb923c' : '#94a3b8';
      ctx.font = '600 9.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(tool.active ? 'BURNER ON' : 'BURNER OFF', cx, bottomY + 13);
    } else if (toolType === 'scale') {
      // Find any vessel sitting near/on top of the scale
      let weighedMassG = 0;
      const sCx = x + w * 0.5;
      for (const v of this.getVessels()) {
        const vCx = v.x + v.width * 0.5;
        if (Math.abs(vCx - sCx) < 75) {
          weighedMassG += v.mixture.totalMass();
        }
      }

      // Metallic body
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y + 10, w, h - 10, 6);
      ctx.fill();
      ctx.stroke();

      // Stainless weighing pan
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath();
      ctx.roundRect(x + 12, y + 3, w - 24, 7, 3);
      ctx.fill();

      // Backlit LCD screen
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

      // Digital probe head
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 42, 6);
      ctx.fill();
      ctx.stroke();

      // Probe stem
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
      const hasContents = target && Object.keys(target.mixture.moles).length > 0;
      const val = hasContents && target ? pH(target.mixture) : 7.0;
      const phColor = val < 6.5 ? '#f43f5e' : val > 7.5 ? '#38bdf8' : '#10b981';

      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = phColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 46, 6);
      ctx.fill();
      ctx.stroke();

      // Electrode shaft
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
      // Rubber bulb
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.roundRect(cx - 9, y, 18, 26, 8);
      ctx.fill();

      // Glass stem
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
