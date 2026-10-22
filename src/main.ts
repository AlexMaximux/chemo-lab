import './styles.css';
import { pH } from './engine/solution';
import { downloadTextFile } from './notebook/export';
import { LiveTelemetryGraphs } from './notebook/graph';
import { Entry, Notebook } from './notebook/notebook';
import { LabBench } from './ui/bench';
import { ToolbarAndInspectorUI } from './ui/toolbar';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function bootstrapApp(rootEl: HTMLElement): {
  bench: LabBench;
  ui: ToolbarAndInspectorUI;
  notebook: Notebook;
} {
  rootEl.innerHTML = `
    <header class="lab-header" id="lab-header"></header>
    <main class="bench-stage" id="bench-stage">
      <canvas id="bench-canvas" aria-label="Interactive Chemistry Lab Bench"></canvas>
      <div class="bench-overlay" id="bench-overlay"></div>
    </main>
    <footer class="lab-toolbar" id="lab-toolbar"></footer>
    <aside class="lab-notebook" id="lab-notebook" aria-label="Vessel Inspector, Live Telemetry and Lab Notebook">
      <section class="vessel-inspector" id="vessel-inspector-card" aria-label="Selected Vessel Inspector"></section>

      <div class="notebook-header">
        <span class="notebook-title">LAB NOTEBOOK & TELEMETRY</span>
        <div class="notebook-export-btns">
          <button type="button" class="nb-btn" id="btn-export-json" title="Export notebook entries as JSON">JSON</button>
          <button type="button" class="nb-btn" id="btn-export-csv" title="Export notebook entries as CSV">CSV</button>
          <button type="button" class="nb-btn" id="btn-clear-notebook" title="Clear saved notebook entries">Clear</button>
        </div>
      </div>

      <section class="notebook-graphs-section" aria-label="Live Telemetry Charts">
        <div class="graph-card">
          <div class="graph-card-header">
            <span>TEMPERATURE vs TIME</span>
            <span id="graph-temp-readout">25.0 °C</span>
          </div>
          <canvas class="graph-canvas" id="graph-temp-canvas"></canvas>
        </div>

        <div class="graph-card">
          <div class="graph-card-header">
            <span>SOLUTION pH vs TIME</span>
            <span id="graph-ph-readout">pH 7.00</span>
          </div>
          <canvas class="graph-canvas" id="graph-ph-canvas"></canvas>
        </div>
      </section>

      <section class="notebook-log-section" aria-label="Notebook Activity Log">
        <div class="pane-header">
          <span class="section-label">AUTO-LOGGED ACTIONS</span>
          <span class="pane-hint" id="notebook-entry-count">0 entries</span>
        </div>
        <div class="notebook-log-list" id="notebook-log-list"></div>
      </section>
    </aside>
  `;

  const headerEl = rootEl.querySelector('#lab-header') as HTMLElement;
  const canvasEl = rootEl.querySelector('#bench-canvas') as HTMLCanvasElement;
  const overlayEl = rootEl.querySelector('#bench-overlay') as HTMLElement;
  const dockedInspectorEl = rootEl.querySelector('#vessel-inspector-card') as HTMLElement;
  const toolbarEl = rootEl.querySelector('#lab-toolbar') as HTMLElement;
  const logListEl = rootEl.querySelector('#notebook-log-list') as HTMLElement;
  const countEl = rootEl.querySelector('#notebook-entry-count') as HTMLElement;

  const tempCanvas = rootEl.querySelector('#graph-temp-canvas') as HTMLCanvasElement;
  const phCanvas = rootEl.querySelector('#graph-ph-canvas') as HTMLCanvasElement;
  const tempReadout = rootEl.querySelector('#graph-temp-readout') as HTMLElement;
  const phReadout = rootEl.querySelector('#graph-ph-readout') as HTMLElement;

  const notebook = Notebook.load();
  const graphs = new LiveTelemetryGraphs(tempCanvas, phCanvas, tempReadout, phReadout);
  let uiRef: ToolbarAndInspectorUI | null = null;

  const renderNotebookList = (): void => {
    const all = notebook.entries();
    countEl.textContent = `${all.length} ${all.length === 1 ? 'entry' : 'entries'}`;
    if (all.length === 0) {
      logListEl.innerHTML = `
        <div class="contents-empty">
          No actions logged yet. Pour reagents, ignite, or heat a vessel to record observations.
        </div>
      `;
      return;
    }

    const recent = [...all].reverse().slice(0, 80);
    logListEl.innerHTML = recent
      .map((entry) => {
        const isRxn = entry.action === 'reaction';
        const isHazard =
          entry.action === 'hazard' ||
          entry.action === 'overflow' ||
          (entry.hazards && entry.hazards.length > 0);
        const cls = isHazard
          ? 'nb-entry nb-entry-hazard'
          : isRxn
            ? 'nb-entry nb-entry-reaction'
            : 'nb-entry';

        const timeLabel = new Date(entry.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        const metricsPill =
          entry.tempK !== undefined && entry.pH !== undefined
            ? ` · ${(entry.tempK - 273.15).toFixed(1)}°C · pH ${entry.pH.toFixed(2)}`
            : '';

        return `
          <div class="${cls}">
            <div class="nb-entry-top">
              <span>${escapeHtml(entry.action.toUpperCase())}${escapeHtml(metricsPill)}</span>
              <span>${escapeHtml(timeLabel)}</span>
            </div>
            <div class="nb-entry-details">${escapeHtml(entry.details)}</div>
          </div>
        `;
      })
      .join('');
  };

  renderNotebookList();

  let benchRef: LabBench | null = null;
  let lastSampleTempK = Number.NaN;
  let lastSamplePh = Number.NaN;
  let lastSamplePressure = Number.NaN;

  const bench = new LabBench(canvasEl, {
    onSelectVessel: (vessel) => {
      uiRef?.updateInspector(vessel);
      if (vessel) {
        lastSampleTempK = vessel.mixture.tempK;
        lastSamplePh = benchRef ? benchRef.getCachedPh(vessel) : 7.0;
        lastSamplePressure = vessel.lastStepResult.pressureKPa;
      }
    },
    onLogEvent: (action, details, vessel, extra) => {
      const currentPh = vessel ? (benchRef ? benchRef.getCachedPh(vessel) : pH(vessel.mixture)) : undefined;
      const simTime = benchRef ? benchRef.simElapsedSeconds : 0;
      const entry: Entry = {
        timestamp: Date.now(),
        simTime,
        action,
        vesselId: vessel?.id,
        details,
        reaction: extra?.reaction,
        tempK: vessel?.mixture.tempK,
        pH: currentPh,
        pressureKPa: vessel?.lastStepResult.pressureKPa,
        hazards: extra?.hazards,
      };
      notebook.log(entry);
      notebook.save();
      renderNotebookList();
      uiRef?.updateSimClock(simTime);
      if (vessel && currentPh !== undefined && benchRef) {
        lastSampleTempK = vessel.mixture.tempK;
        lastSamplePh = currentPh;
        lastSamplePressure = vessel.lastStepResult.pressureKPa;
        graphs.sample(simTime, vessel.mixture.tempK, currentPh, true);
      }
    },
    onHazard: (hazards, message, vessel) => {
      uiRef?.showHazardBanner(hazards, message, vessel);
    },
    onNotice: (message, level) => {
      uiRef?.showNotice(message, level);
    },
    onSimSample: (simTime, vessel) => {
      if (!vessel) return;
      const currentPh = benchRef ? benchRef.getCachedPh(vessel) : pH(vessel.mixture);
      const tempChanged =
        Number.isNaN(lastSampleTempK) || Math.abs(vessel.mixture.tempK - lastSampleTempK) > 2.5;
      const phChanged =
        Number.isNaN(lastSamplePh) || Math.abs(currentPh - lastSamplePh) > 0.02;
      const pressureChanged =
        Number.isNaN(lastSamplePressure) ||
        Math.abs(vessel.lastStepResult.pressureKPa - lastSamplePressure) > 2.0;

      // Only touch DOM panels & telemetry charts when physical/chemical state changes significantly
      if (tempChanged || phChanged || pressureChanged) {
        lastSampleTempK = vessel.mixture.tempK;
        lastSamplePh = currentPh;
        lastSamplePressure = vessel.lastStepResult.pressureKPa;
        uiRef?.updateSimClock(simTime);
        graphs.sample(simTime, vessel.mixture.tempK, currentPh);
      }
    },
  });

  benchRef = bench;

  const ui = new ToolbarAndInspectorUI(bench);
  uiRef = ui;

  ui.mountHeader(headerEl);
  ui.mountBannersAndInspector(overlayEl, dockedInspectorEl);
  ui.mountBottomToolbar(toolbarEl);

  rootEl.querySelector('#btn-export-json')?.addEventListener('click', () => {
    downloadTextFile('chem-lab-notebook.json', notebook.toJSON(), 'application/json');
    ui.showNotice('Exported lab notebook as chem-lab-notebook.json', 'info');
  });

  rootEl.querySelector('#btn-export-csv')?.addEventListener('click', () => {
    downloadTextFile('chem-lab-notebook.csv', notebook.toCSV(), 'text/csv;charset=utf-8');
    ui.showNotice('Exported lab notebook as chem-lab-notebook.csv', 'info');
  });

  rootEl.querySelector('#btn-clear-notebook')?.addEventListener('click', () => {
    notebook.clear();
    notebook.save();
    graphs.reset();
    renderNotebookList();
    ui.showNotice('Cleared lab notebook and live telemetry charts.', 'info');
  });

  const initVessel = bench.getSelectedVessel();
  if (initVessel) {
    const initPh = bench.getCachedPh(initVessel);
    lastSampleTempK = initVessel.mixture.tempK;
    lastSamplePh = initPh;
    lastSamplePressure = initVessel.lastStepResult.pressureKPa;
    graphs.sample(0, initVessel.mixture.tempK, initPh, false);
    graphs.sample(0.05, initVessel.mixture.tempK, initPh, true);
  } else {
    graphs.render();
  }

  let lastTime = performance.now();
  const loop = (now: number) => {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    bench.tick(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return { bench, ui, notebook };
}

const appRoot = document.getElementById('app');
if (appRoot) {
  bootstrapApp(appRoot);
}
