export interface TelemetrySample {
  simTime: number;
  tempK: number;
  tempC: number;
  pH: number;
}

export class TimeSeriesSampler {
  private readonly maxPoints: number;
  private points: TelemetrySample[] = [];

  constructor(maxPoints = 180) {
    this.maxPoints = Math.max(2, maxPoints);
  }

  public record(simTime: number, tempK: number, pHVal: number): void {
    if (!Number.isFinite(simTime) || !Number.isFinite(tempK) || !Number.isFinite(pHVal)) {
      return;
    }
    const last = this.points[this.points.length - 1];
    if (last && Math.abs(simTime - last.simTime) < 0.04) {
      // Update latest tick sample in place if within 40ms
      last.tempK = tempK;
      last.tempC = tempK - 273.15;
      last.pH = pHVal;
      return;
    }

    this.points.push({
      simTime,
      tempK,
      tempC: tempK - 273.15,
      pH: pHVal,
    });

    if (this.points.length > this.maxPoints) {
      this.points.splice(0, this.points.length - this.maxPoints);
    }
  }

  public getPoints(): TelemetrySample[] {
    return [...this.points];
  }

  public clear(): void {
    this.points = [];
  }
}

export class LiveTelemetryGraphs {
  public readonly sampler = new TimeSeriesSampler(180);
  private readonly tempCanvas: HTMLCanvasElement;
  private readonly phCanvas: HTMLCanvasElement;
  private readonly tempReadoutEl: HTMLElement | null;
  private readonly phReadoutEl: HTMLElement | null;

  constructor(
    tempCanvas: HTMLCanvasElement,
    phCanvas: HTMLCanvasElement,
    tempReadoutEl?: HTMLElement | null,
    phReadoutEl?: HTMLElement | null
  ) {
    this.tempCanvas = tempCanvas;
    this.phCanvas = phCanvas;
    this.tempReadoutEl = tempReadoutEl ?? null;
    this.phReadoutEl = phReadoutEl ?? null;
  }

  public sample(simTime: number, tempK: number, phVal: number): void {
    this.sampler.record(simTime, tempK, phVal);
    if (this.tempReadoutEl) {
      this.tempReadoutEl.textContent = `${(tempK - 273.15).toFixed(1)} °C`;
    }
    if (this.phReadoutEl) {
      this.phReadoutEl.textContent = `pH ${phVal.toFixed(2)}`;
    }
    this.render();
  }

  public reset(): void {
    this.sampler.clear();
    this.render();
  }

  public render(): void {
    const pts = this.sampler.getPoints();
    this.drawChart(
      this.tempCanvas,
      pts.map((p) => ({ t: p.simTime, v: p.tempC })),
      {
        strokeColor: '#fb923c',
        fillTop: 'rgba(251, 146, 60, 0.28)',
        fillBottom: 'rgba(251, 146, 60, 0.0)',
        minRange: [15, 45],
        unit: '°C',
      }
    );

    this.drawChart(
      this.phCanvas,
      pts.map((p) => ({ t: p.simTime, v: p.pH })),
      {
        strokeColor: '#22d3ee',
        fillTop: 'rgba(34, 211, 238, 0.25)',
        fillBottom: 'rgba(34, 211, 238, 0.0)',
        fixedRange: [0, 14],
        referenceLine: 7.0,
        unit: '',
      }
    );
  }

  private drawChart(
    canvas: HTMLCanvasElement,
    data: Array<{ t: number; v: number }>,
    opts: {
      strokeColor: string;
      fillTop: string;
      fillBottom: string;
      minRange?: [number, number];
      fixedRange?: [number, number];
      referenceLine?: number;
      unit: string;
    }
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(220, Math.floor(rect.width || 280));
    const h = Math.max(64, Math.floor(rect.height || 82));

    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padLeft = 32;
    const padRight = 8;
    const padTop = 8;
    const padBottom = 14;
    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    // Determine Y bounds
    let yMin = opts.fixedRange ? opts.fixedRange[0] : opts.minRange ? opts.minRange[0] : 0;
    let yMax = opts.fixedRange ? opts.fixedRange[1] : opts.minRange ? opts.minRange[1] : 100;

    if (!opts.fixedRange && data.length > 0) {
      for (const pt of data) {
        if (pt.v < yMin) yMin = Math.floor(pt.v - 5);
        if (pt.v > yMax) yMax = Math.ceil(pt.v + 5);
      }
    }
    const ySpan = Math.max(1e-3, yMax - yMin);

    // Subtle horizontal grid lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 2; i++) {
      const gy = padTop + (plotH * i) / 2;
      ctx.beginPath();
      ctx.moveTo(padLeft, gy);
      ctx.lineTo(w - padRight, gy);
      ctx.stroke();

      const labelVal = yMax - (ySpan * i) / 2;
      ctx.fillStyle = '#64748b';
      ctx.font = '500 8.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${labelVal.toFixed(0)}${opts.unit}`, padLeft - 4, gy + 3);
    }

    // Optional reference line (e.g. pH 7.0 neutral line)
    if (opts.referenceLine !== undefined) {
      const ry = padTop + plotH * (1 - (opts.referenceLine - yMin) / ySpan);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padLeft, ry);
      ctx.lineTo(w - padRight, ry);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (data.length >= 2) {
      const tMin = data[0].t;
      const tMax = Math.max(tMin + 0.1, data[data.length - 1].t);
      const tSpan = tMax - tMin;

      const toX = (t: number) => padLeft + ((t - tMin) / tSpan) * plotW;
      const toY = (v: number) =>
        padTop + Math.max(0, Math.min(plotH, plotH * (1 - (v - yMin) / ySpan)));

      // Area fill under curve
      const areaGrad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
      areaGrad.addColorStop(0, opts.fillTop);
      areaGrad.addColorStop(1, opts.fillBottom);
      ctx.fillStyle = areaGrad;
      ctx.beginPath();
      ctx.moveTo(toX(data[0].t), padTop + plotH);
      for (const pt of data) {
        ctx.lineTo(toX(pt.t), toY(pt.v));
      }
      ctx.lineTo(toX(data[data.length - 1].t), padTop + plotH);
      ctx.closePath();
      ctx.fill();

      // Line stroke
      ctx.strokeStyle = opts.strokeColor;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      data.forEach((pt, idx) => {
        const px = toX(pt.t);
        const py = toY(pt.v);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Latest sample dot
      const last = data[data.length - 1];
      ctx.fillStyle = opts.strokeColor;
      ctx.beginPath();
      ctx.arc(toX(last.t), toY(last.v), 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
