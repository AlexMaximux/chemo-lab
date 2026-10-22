import './styles.css';
import { LabBench } from './ui/bench';
import { ToolbarAndInspectorUI } from './ui/toolbar';

export function bootstrapApp(rootEl: HTMLElement): { bench: LabBench; ui: ToolbarAndInspectorUI } {
  rootEl.innerHTML = `
    <header class="lab-header" id="lab-header"></header>
    <main class="bench-stage" id="bench-stage">
      <canvas id="bench-canvas" aria-label="Interactive Chemistry Lab Bench"></canvas>
      <div class="bench-overlay" id="bench-overlay"></div>
    </main>
    <footer class="lab-toolbar" id="lab-toolbar"></footer>
    <aside class="lab-notebook" id="lab-notebook">
      <div class="notebook-header">
        <span class="notebook-title">LAB NOTEBOOK & TELEMETRY</span>
      </div>
      <div class="notebook-log-section">
        <div class="section-label">ACTIVITY LOG</div>
        <div class="notebook-log-list" id="notebook-log-list"></div>
      </div>
    </aside>
  `;

  const headerEl = rootEl.querySelector('#lab-header') as HTMLElement;
  const canvasEl = rootEl.querySelector('#bench-canvas') as HTMLCanvasElement;
  const overlayEl = rootEl.querySelector('#bench-overlay') as HTMLElement;
  const toolbarEl = rootEl.querySelector('#lab-toolbar') as HTMLElement;
  const logListEl = rootEl.querySelector('#notebook-log-list') as HTMLElement;

  let uiRef: ToolbarAndInspectorUI | null = null;

  const bench = new LabBench(canvasEl, {
    onSelectVessel: (vessel) => {
      uiRef?.updateInspector(vessel);
    },
    onLogEvent: (action, details) => {
      if (logListEl) {
        const entryEl = document.createElement('div');
        entryEl.className = `nb-entry ${action === 'reaction' ? 'nb-entry-reaction' : ''}`;
        entryEl.innerHTML = `
          <div class="nb-entry-top">
            <span>${action.toUpperCase()}</span>
            <span>${new Date().toLocaleTimeString()}</span>
          </div>
          <div class="nb-entry-details">${details}</div>
        `;
        logListEl.prepend(entryEl);
      }
    },
    onHazard: (hazards, message, vessel) => {
      uiRef?.showHazardBanner(hazards, message, vessel);
    },
    onNotice: (message, level) => {
      uiRef?.showNotice(message, level);
    },
    onSimSample: (simTime, vessel) => {
      uiRef?.updateSimClock(simTime);
      if (vessel && Math.floor(simTime * 10) % 5 === 0) {
        uiRef?.updateInspector(vessel);
      }
    },
  });

  const ui = new ToolbarAndInspectorUI(bench);
  uiRef = ui;

  ui.mountHeader(headerEl);
  ui.mountBannersAndInspector(overlayEl);
  ui.mountBottomToolbar(toolbarEl);

  let lastTime = performance.now();
  const loop = (now: number) => {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    bench.tick(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return { bench, ui };
}

const appRoot = document.getElementById('app');
if (appRoot) {
  bootstrapApp(appRoot);
}
