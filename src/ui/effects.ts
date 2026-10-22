import { LabVessel } from './equipment';

export interface BubbleParticle {
  vesselId: string;
  xOffset: number; // -0.4 to 0.4 of vessel width
  yProgress: number; // 0 (bottom) to 1 (liquid surface)
  radius: number;
  speed: number;
  wobblePhase: number;
  color: string;
}

export interface PrecipitateParticle {
  vesselId: string;
  xOffset: number;
  yProgress: number; // 1 (surface) down to 0.05 (sediment bed)
  size: number;
  speed: number;
  color: string;
}

export interface VaporParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface IgnitionFlare {
  vesselId: string;
  x: number;
  y: number;
  intensity: number; // 0 to 1
  color: string;
  sparks: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    color: string;
  }>;
}

export interface ShockwaveRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: string;
}

export interface PourStreamEffect {
  vesselId: string;
  color: string;
  phase: 'g' | 'l' | 's' | 'aq';
  timer: number; // seconds remaining
  label: string;
}

export class EffectsManager {
  public bubbles: BubbleParticle[] = [];
  public precipitates: PrecipitateParticle[] = [];
  public vapors: VaporParticle[] = [];
  public flares: IgnitionFlare[] = [];
  public shockwaves: ShockwaveRing[] = [];
  public pourStreams: PourStreamEffect[] = [];

  public flashAlpha = 0;
  public shakeIntensity = 0;
  public shakeOffsetX = 0;
  public shakeOffsetY = 0;

  public triggerGasEvolution(vessel: LabVessel, count = 16, color = 'rgba(225, 248, 255, 0.78)'): void {
    for (let i = 0; i < count; i++) {
      if (this.bubbles.length > 220) break;
      this.bubbles.push({
        vesselId: vessel.id,
        xOffset: (Math.random() - 0.5) * 0.62,
        yProgress: Math.random() * 0.35,
        radius: 1.8 + Math.random() * 3.4,
        speed: 0.45 + Math.random() * 0.75,
        wobblePhase: Math.random() * Math.PI * 2,
        color,
      });
    }
  }

  public triggerPrecipitate(vessel: LabVessel, color = 'rgba(245, 247, 250, 0.9)', count = 22): void {
    for (let i = 0; i < count; i++) {
      if (this.precipitates.length > 240) break;
      this.precipitates.push({
        vesselId: vessel.id,
        xOffset: (Math.random() - 0.5) * 0.64,
        yProgress: 0.25 + Math.random() * 0.72,
        size: 1.6 + Math.random() * 2.4,
        speed: 0.18 + Math.random() * 0.28,
        color,
      });
    }
  }

  public triggerCondensationAndVapor(vessel: LabVessel, count = 12, color = 'rgba(216, 238, 255, 0.38)'): void {
    const cx = vessel.x + vessel.width * 0.5;
    const topY = vessel.y + vessel.height * 0.28;
    for (let i = 0; i < count; i++) {
      if (this.vapors.length > 160) break;
      this.vapors.push({
        x: cx + (Math.random() - 0.5) * vessel.width * 0.42,
        y: topY + (Math.random() - 0.5) * 16,
        vx: (Math.random() - 0.5) * 14,
        vy: -18 - Math.random() * 26,
        radius: 6 + Math.random() * 10,
        alpha: 0.42,
        life: 0,
        maxLife: 1.2 + Math.random() * 1.1,
        color,
      });
    }
  }

  public triggerIgnitionFlare(vessel: LabVessel, fiery = false): void {
    const cx = vessel.x + vessel.width * 0.5;
    const cy = vessel.y + vessel.height * 0.48;
    const sparks = [];
    const sparkCount = fiery ? 28 : 14;
    for (let i = 0; i < sparkCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 35 + Math.random() * (fiery ? 140 : 75);
      sparks.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        life: 0.4 + Math.random() * 0.5,
        color: i % 2 === 0 ? '#fde047' : '#fb923c',
      });
    }
    this.flares.push({
      vesselId: vessel.id,
      x: cx,
      y: cy,
      intensity: 1.0,
      color: fiery ? '#f97316' : '#38bdf8',
      sparks,
    });
  }

  public triggerExplosion(vessel: LabVessel): void {
    this.flashAlpha = 0.92;
    this.shakeIntensity = 18;
    const cx = vessel.x + vessel.width * 0.5;
    const cy = vessel.y + vessel.height * 0.52;
    this.shockwaves.push({
      x: cx,
      y: cy,
      radius: 12,
      maxRadius: 220,
      alpha: 0.95,
      color: '#fef08a',
    });
    this.triggerIgnitionFlare(vessel, true);
    this.triggerCondensationAndVapor(vessel, 22, 'rgba(255, 240, 220, 0.55)');
  }

  public triggerPourStream(
    vessel: LabVessel,
    color: string,
    phase: 'g' | 'l' | 's' | 'aq',
    label: string,
    duration = 0.45
  ): void {
    const existing = this.pourStreams.find((p) => p.vesselId === vessel.id);
    if (existing) {
      existing.color = color;
      existing.phase = phase;
      existing.label = label;
      existing.timer = Math.max(existing.timer, duration);
    } else {
      this.pourStreams.push({
        vesselId: vessel.id,
        color,
        phase,
        timer: duration,
        label,
      });
    }
  }

  public update(dtRealSeconds: number, vessels: LabVessel[]): void {
    const dt = Math.min(0.1, Math.max(0.001, dtRealSeconds));

    // Ambient boiling / hot vapor and gas bubbles
    for (const v of vessels) {
      const hasLiquid = v.mixture.volumeL > 0.001;
      if (hasLiquid && v.mixture.tempK >= 368) {
        if (Math.random() < 0.45) {
          this.triggerGasEvolution(v, 2, 'rgba(235, 250, 255, 0.72)');
        }
        if (Math.random() < 0.35) {
          this.triggerCondensationAndVapor(v, 1, 'rgba(220, 240, 255, 0.32)');
        }
      } else if (hasLiquid && v.mixture.tempK >= 330 && Math.random() < 0.15) {
        this.triggerCondensationAndVapor(v, 1, 'rgba(210, 235, 255, 0.22)');
      }
    }

    // Update bubbles
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.yProgress += b.speed * dt;
      b.wobblePhase += dt * 7;
      if (b.yProgress >= 1.0) {
        this.bubbles.splice(i, 1);
      }
    }

    // Update precipitates
    for (let i = this.precipitates.length - 1; i >= 0; i--) {
      const p = this.precipitates[i];
      p.yProgress -= p.speed * dt;
      if (p.yProgress <= 0.06) {
        this.precipitates.splice(i, 1);
      }
    }

    // Update vapor plumes
    for (let i = this.vapors.length - 1; i >= 0; i--) {
      const vp = this.vapors[i];
      vp.life += dt;
      vp.x += vp.vx * dt;
      vp.y += vp.vy * dt;
      vp.radius += dt * 11;
      if (vp.life >= vp.maxLife) {
        this.vapors.splice(i, 1);
      }
    }

    // Update flares
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const fl = this.flares[i];
      fl.intensity -= dt * 1.65;
      for (const sp of fl.sparks) {
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.vy += 180 * dt;
        sp.life -= dt;
      }
      if (fl.intensity <= 0) {
        this.flares.splice(i, 1);
      }
    }

    // Update shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += (sw.maxRadius - sw.radius) * Math.min(1, dt * 8);
      sw.alpha -= dt * 1.9;
      if (sw.alpha <= 0) {
        this.shockwaves.splice(i, 1);
      }
    }

    // Update pour streams
    for (let i = this.pourStreams.length - 1; i >= 0; i--) {
      this.pourStreams[i].timer -= dt;
      if (this.pourStreams[i].timer <= 0) {
        this.pourStreams.splice(i, 1);
      }
    }

    // Update white flash & camera shake
    if (this.flashAlpha > 0) {
      this.flashAlpha = Math.max(0, this.flashAlpha - dt * 2.2);
    }
    if (this.shakeIntensity > 0.2) {
      this.shakeOffsetX = (Math.random() - 0.5) * 2 * this.shakeIntensity;
      this.shakeOffsetY = (Math.random() - 0.5) * 2 * this.shakeIntensity;
      this.shakeIntensity *= Math.pow(0.04, dt);
    } else {
      this.shakeIntensity = 0;
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }
  }

  public renderVesselInternalEffects(
    ctx: CanvasRenderingContext2D,
    vessel: LabVessel,
    liquidTopY: number,
    liquidBottomY: number
  ): void {
    const cx = vessel.x + vessel.width * 0.5;
    const liquidHeight = Math.max(0, liquidBottomY - liquidTopY);

    // Render pour stream if active for this vessel
    const stream = this.pourStreams.find((p) => p.vesselId === vessel.id);
    if (stream) {
      ctx.save();
      const startY = vessel.y - 26;
      const endY = liquidHeight > 4 ? liquidTopY + 2 : liquidBottomY - 4;
      if (stream.phase === 's') {
        // Granular solid powder stream
        ctx.fillStyle = stream.color || '#e2e8f0';
        for (let i = 0; i < 9; i++) {
          const py = startY + ((i / 9 + ( performance.now() * 0.005 ) % 1) % 1) * (endY - startY);
          const px = cx + Math.sin(i * 2.1 + performance.now() * 0.02) * 3.5;
          ctx.beginPath();
          ctx.arc(px, py, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (stream.phase === 'g') {
        // Pressurized gas jet
        const grad = ctx.createLinearGradient(cx, startY, cx, endY);
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.55)');
        grad.addColorStop(1, 'rgba(56, 189, 248, 0.05)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 6;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, startY);
        ctx.lineTo(cx, endY);
        ctx.stroke();
      } else {
        // Smooth laminar liquid stream
        ctx.strokeStyle = stream.color || 'rgba(186, 230, 253, 0.85)';
        ctx.lineWidth = 4.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, startY);
        ctx.lineTo(cx, endY);
        ctx.stroke();

        // Splash crown at meniscus
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(cx, endY, 7 + Math.sin(performance.now() * 0.03) * 2, 2.2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (liquidHeight > 3) {
      // Render falling precipitate particles
      for (const p of this.precipitates) {
        if (p.vesselId !== vessel.id) continue;
        const px = cx + p.xOffset * (vessel.width * 0.65);
        const py = liquidBottomY - p.yProgress * liquidHeight;
        ctx.save();
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Render rising gas bubbles
      for (const b of this.bubbles) {
        if (b.vesselId !== vessel.id) continue;
        const wobble = Math.sin(b.wobblePhase) * 2.5;
        const bx = cx + b.xOffset * (vessel.width * 0.62) + wobble;
        const by = liquidBottomY - b.yProgress * liquidHeight;
        ctx.save();
        ctx.strokeStyle = b.color;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(bx, by, b.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Specular highlight dot on bubble
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(bx - b.radius * 0.3, by - b.radius * 0.3, b.radius * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  public renderOverlayEffects(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void {
    // Vapor / condensation plumes
    for (const vp of this.vapors) {
      const progress = vp.life / vp.maxLife;
      const alpha = vp.alpha * (1 - progress);
      if (alpha <= 0.01) continue;
      ctx.save();
      const grad = ctx.createRadialGradient(vp.x, vp.y, 1, vp.x, vp.y, vp.radius);
      grad.addColorStop(0, `rgba(226, 242, 255, ${alpha.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(226, 242, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(vp.x, vp.y, vp.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Ignition & combustion flares
    for (const fl of this.flares) {
      ctx.save();
      const radius = 44 * fl.intensity;
      const grad = ctx.createRadialGradient(fl.x, fl.y, 2, fl.x, fl.y, Math.max(4, radius));
      grad.addColorStop(0, `rgba(255, 255, 255, ${Math.min(1, fl.intensity * 1.1).toFixed(2)})`);
      grad.addColorStop(0.35, `rgba(251, 191, 36, ${fl.intensity.toFixed(2)})`);
      grad.addColorStop(0.7, `rgba(249, 115, 22, ${(fl.intensity * 0.65).toFixed(2)})`);
      grad.addColorStop(1, 'rgba(249, 115, 22, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(fl.x, fl.y, Math.max(4, radius), 0, Math.PI * 2);
      ctx.fill();

      for (const sp of fl.sparks) {
        if (sp.life <= 0) continue;
        ctx.fillStyle = sp.color;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Shockwave rings
    for (const sw of this.shockwaves) {
      ctx.save();
      ctx.strokeStyle = `rgba(254, 240, 138, ${Math.max(0, sw.alpha).toFixed(2)})`;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Full-bench white explosion flash
    if (this.flashAlpha > 0.01) {
      ctx.save();
      ctx.fillStyle = `rgba(255, 252, 245, ${this.flashAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.restore();
    }
  }

  public renderBurnerFlame(
    ctx: CanvasRenderingContext2D,
    cx: number,
    nozzleTopY: number,
    timeSec: number
  ): void {
    ctx.save();
    const flicker1 = Math.sin(timeSec * 24) * 2.2 + Math.cos(timeSec * 37) * 1.4;
    const flicker2 = Math.cos(timeSec * 19) * 1.8;
    const flameHeight = 44 + Math.sin(timeSec * 31) * 3.5;

    // Ambient thermal glow
    const glow = ctx.createRadialGradient(
      cx,
      nozzleTopY - flameHeight * 0.45,
      3,
      cx,
      nozzleTopY - flameHeight * 0.45,
      46
    );
    glow.addColorStop(0, 'rgba(56, 189, 248, 0.34)');
    glow.addColorStop(0.55, 'rgba(251, 146, 60, 0.14)');
    glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, nozzleTopY - flameHeight * 0.45, 46, 0, Math.PI * 2);
    ctx.fill();

    // Outer oxidizing mantle (translucent blue-amber)
    const outerGrad = ctx.createLinearGradient(cx, nozzleTopY, cx, nozzleTopY - flameHeight);
    outerGrad.addColorStop(0, 'rgba(14, 165, 233, 0.85)');
    outerGrad.addColorStop(0.55, 'rgba(56, 189, 248, 0.75)');
    outerGrad.addColorStop(0.85, 'rgba(251, 146, 60, 0.65)');
    outerGrad.addColorStop(1, 'rgba(253, 224, 71, 0)');

    ctx.fillStyle = outerGrad;
    ctx.beginPath();
    ctx.moveTo(cx - 10, nozzleTopY);
    ctx.quadraticCurveTo(cx - 15 + flicker2, nozzleTopY - flameHeight * 0.5, cx + flicker1, nozzleTopY - flameHeight);
    ctx.quadraticCurveTo(cx + 15 - flicker2, nozzleTopY - flameHeight * 0.5, cx + 10, nozzleTopY);
    ctx.closePath();
    ctx.fill();

    // Inner blue reducing cone
    const innerHeight = flameHeight * 0.56;
    const innerGrad = ctx.createLinearGradient(cx, nozzleTopY, cx, nozzleTopY - innerHeight);
    innerGrad.addColorStop(0, 'rgba(224, 242, 254, 0.95)');
    innerGrad.addColorStop(0.6, 'rgba(56, 189, 248, 0.92)');
    innerGrad.addColorStop(1, 'rgba(14, 165, 233, 0.1)');

    ctx.fillStyle = innerGrad;
    ctx.beginPath();
    ctx.moveTo(cx - 5.5, nozzleTopY);
    ctx.quadraticCurveTo(cx - 7, nozzleTopY - innerHeight * 0.45, cx + flicker2 * 0.4, nozzleTopY - innerHeight);
    ctx.quadraticCurveTo(cx + 7, nozzleTopY - innerHeight * 0.45, cx + 5.5, nozzleTopY);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}
