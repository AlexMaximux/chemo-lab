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
  private tempSvgEl: SVGSVGElement | null = null;
  private phSvgEl: SVGSVGElement | null = null;

  private lastTempText = '';
  private lastPhText = '';
  private lastRenderedTempK = Number.NaN;
  private lastRenderedPh = Number.NaN;
  private renderedSampleCount = 0;

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
    this.mountSvgOverlays();
  }

  private mountSvgOverlays(): void {
    if (typeof document === 'undefined') return;
    this.tempSvgEl = this.createSvgOverlayForCanvas(this.tempCanvas);
    this.phSvgEl = this.createSvgOverlayForCanvas(this.phCanvas);
  }

  private createSvgOverlayForCanvas(canvas: HTMLCanvasElement): SVGSVGElement | null {
    const parent = canvas.parentElement;
    if (!parent) return null;
    canvas.style.display = 'none';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 280 62');
    svg.setAttribute('class', 'graph-canvas');
    svg.style.width = '100%';
    svg.style.height = '62px';
    svg.style.display = 'block';
    parent.appendChild(svg);
    return svg;
  }

  public sample(simTime: number, tempK: number, phVal: number, forceRender = false): void {
    this.sampler.record(simTime, tempK, phVal);

    const tempStr = `${(tempK - 273.15).toFixed(1)} °C`;
    if (this.tempReadoutEl && tempStr !== this.lastTempText) {
      this.lastTempText = tempStr;
      this.tempReadoutEl.textContent = tempStr;
    }

    const phStr = `pH ${phVal.toFixed(2)}`;
    if (this.phReadoutEl && phStr !== this.lastPhText) {
      this.lastPhText = phStr;
      this.phReadoutEl.textContent = phStr;
    }

    const tempChanged =
      Number.isNaN(this.lastRenderedTempK) || Math.abs(tempK - this.lastRenderedTempK) > 0.05;
    const phChanged =
      Number.isNaN(this.lastRenderedPh) || Math.abs(phVal - this.lastRenderedPh) > 0.01;
    const needsInitialPlot = this.renderedSampleCount < 2 && this.sampler.getPoints().length >= 2;

    if (forceRender || tempChanged || phChanged || needsInitialPlot) {
      this.lastRenderedTempK = tempK;
      this.lastRenderedPh = phVal;
      this.renderedSampleCount = this.sampler.getPoints().length;
      this.render();
    }
  }

  public reset(): void {
    this.sampler.clear();
    this.lastRenderedTempK = Number.NaN;
    this.lastRenderedPh = Number.NaN;
    this.renderedSampleCount = 0;
    this.render();
  }

  public render(): void {
    const pts = this.sampler.getPoints();
    this.drawSvgChart(
      this.tempSvgEl,
      pts.map((p) => ({ t: p.simTime, v: p.tempC })),
      {
        strokeColor: '#fb923c',
        fillColor: 'rgba(251, 146, 60, 0.18)',
        minRange: [15, 45],
        unit: '°C',
      }
    );

    this.drawSvgChart(
      this.phSvgEl,
      pts.map((p) => ({ t: p.simTime, v: p.pH })),
      {
        strokeColor: '#22d3ee',
        fillColor: 'rgba(34, 211, 238, 0.16)',
        fixedRange: [0, 14],
        referenceLine: 7.0,
        unit: '',
      }
    );
  }

  private drawSvgChart(
    svg: SVGSVGElement | null,
    data: Array<{ t: number; v: number }>,
    opts: {
      strokeColor: string;
      fillColor: string;
      minRange?: [number, number];
      fixedRange?: [number, number];
      referenceLine?: number;
      unit: string;
    }
  ): void {
    if (!svg) return;
    const w = 280;
    const h = 62;
    const padLeft = 32;
    const padRight = 8;
    const padTop = 7;
    const padBottom = 11;
    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    let yMin = opts.fixedRange ? opts.fixedRange[0] : opts.minRange ? opts.minRange[0] : 0;
    let yMax = opts.fixedRange ? opts.fixedRange[1] : opts.minRange ? opts.minRange[1] : 100;

    if (!opts.fixedRange && data.length > 0) {
      for (const pt of data) {
        if (pt.v < yMin) yMin = Math.floor(pt.v - 5);
        if (pt.v > yMax) yMax = Math.ceil(pt.v + 5);
      }
    }
    const ySpan = Math.max(1e-3, yMax - yMin);

    const parts: string[] = [];
    for (let i = 0; i <= 2; i++) {
      const gy = (padTop + (plotH * i) / 2).toFixed(1);
      const labelVal = (yMax - (ySpan * i) / 2).toFixed(0);
      parts.push(
        `<line x1="${padLeft}" y1="${gy}" x2="${w - padRight}" y2="${gy}" stroke="rgba(148,163,184,0.12)" stroke-width="1"/>`,
        `<text x="${padLeft - 4}" y="${Number(gy) + 3}" fill="#64748b" font-family="JetBrains Mono, monospace" font-size="8.5" text-anchor="end">${labelVal}${opts.unit}</text>`
      );
    }

    if (opts.referenceLine !== undefined) {
      const ry = (padTop + plotH * (1 - (opts.referenceLine - yMin) / ySpan)).toFixed(1);
      parts.push(
        `<line x1="${padLeft}" y1="${ry}" x2="${w - padRight}" y2="${ry}" stroke="rgba(16,185,129,0.35)" stroke-width="1" stroke-dasharray="3 3"/>`
      );
    }

    if (data.length >= 2) {
      const tMin = data[0].t;
      const tMax = Math.max(tMin + 0.1, data[data.length - 1].t);
      const tSpan = tMax - tMin;

      const toX = (t: number) => padLeft + ((t - tMin) / tSpan) * plotW;
      const toY = (v: number) =>
        padTop + Math.max(0, Math.min(plotH, plotH * (1 - (v - yMin) / ySpan)));

      const lineCoords = data.map((pt) => `${toX(pt.t).toFixed(1)},${toY(pt.v).toFixed(1)}`).join(' ');
      const firstX = toX(data[0].t).toFixed(1);
      const lastPt = data[data.length - 1];
      const lastX = toX(lastPt.t).toFixed(1);
      const lastY = toY(lastPt.v).toFixed(1);
      const bottomY = (padTop + plotH).toFixed(1);

      parts.push(
        `<polygon points="${firstX},${bottomY} ${lineCoords} ${lastX},${bottomY}" fill="${opts.fillColor}"/>`,
        `<polyline points="${lineCoords}" fill="none" stroke="${opts.strokeColor}" stroke-width="1.8" stroke-linejoin="round"/>`,
        `<circle cx="${lastX}" cy="${lastY}" r="2.6" fill="${opts.strokeColor}"/>`
      );
    }

    svg.innerHTML = parts.join('');
  }
}
