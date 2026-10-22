import { SPECIES, Species } from '../engine/data/species';
import { pH } from '../engine/solution';
import { LabBench } from './bench';
import {
  ChemicalCategory,
  EQUIPMENT_CATALOG,
  formatFormula,
  formatReactionEquation,
  getSpeciesCategory,
  LabVessel,
  PourUnit,
} from './equipment';

const CATEGORY_LABELS: Array<{ id: ChemicalCategory; label: string }> = [
  { id: 'all', label: 'All Species' },
  { id: 'gases', label: 'Gases' },
  { id: 'acids', label: 'Acids' },
  { id: 'bases', label: 'Bases' },
  { id: 'salts', label: 'Salts & Ions' },
  { id: 'metals', label: 'Metals & Solids' },
  { id: 'organics', label: 'Organics' },
  { id: 'liquids_oxides', label: 'Liquids & Oxides' },
];

export class ToolbarAndInspectorUI {
  private readonly bench: LabBench;
  private activeCategory: ChemicalCategory = 'all';
  private searchQuery = '';
  private holdIntervalId: number | null = null;
  private flowRateMultiplier = 1.0;

  private inspectorContainer!: HTMLElement;
  private warningBannerEl!: HTMLElement;
  private noticeToastEl!: HTMLElement;
  private chemGridEl!: HTMLElement;
  private chemCountBadgeEl!: HTMLElement;
  private simClockEl!: HTMLElement;

  constructor(bench: LabBench) {
    this.bench = bench;
  }

  public mountHeader(container: HTMLElement): void {
    container.innerHTML = `
      <div class="header-brand">
        <div class="brand-emblem" aria-hidden="true">
          <span class="emblem-dot"></span>
          <span class="emblem-ring"></span>
        </div>
        <div>
          <h1 class="brand-title">CHEM-LAB <span class="brand-version">PRO ENGINE</span></h1>
          <p class="brand-subtitle">Stoichiometric · Thermodynamic · Kinetic Simulator</p>
        </div>
      </div>

      <div class="header-presets" role="group" aria-label="Quick Lab Scenarios">
        <span class="control-group-label">SCENARIOS</span>
        <button type="button" class="btn-chip" data-preset="make_water" title="Load 2 mol H2 + 1 mol O2 in Flask, ready to ignite">
          2H₂ + O₂ → 2H₂O
        </button>
        <button type="button" class="btn-chip" data-preset="neutralize" title="Mix 50 mL 1M HCl + 50 mL 1M NaOH">
          HCl + NaOH
        </button>
        <button type="button" class="btn-chip" data-preset="heat_gas" title="Heat closed vessel with N2 gas until burst pressure">
          Closed Gas Burst
        </button>
        <button type="button" class="btn-chip btn-chip-danger" data-preset="hazard_na" title="Drop metallic Sodium into Water (explosive hazard)">
          Na + H₂O Hazard
        </button>
        <button type="button" class="btn-chip btn-chip-danger" data-preset="hazard_chloramine" title="Mix Bleach (NaOCl) + Ammonia (toxic chloramine gas)">
          NaOCl + NH₃
        </button>
      </div>

      <div class="header-controls">
        <div class="sim-clock-pill" title="Simulated elapsed time">
          <span class="clock-label">SIM TIME</span>
          <span class="clock-value" id="sim-clock-readout">0.0s</span>
        </div>

        <div class="speed-segmented" role="group" aria-label="Simulation speed">
          <button type="button" class="speed-btn active" data-speed="1">1×</button>
          <button type="button" class="speed-btn" data-speed="10">10×</button>
          <button type="button" class="speed-btn" data-speed="100">100×</button>
          <button type="button" class="speed-btn" id="btn-pause-sim" title="Pause or resume simulation">⏸</button>
        </div>

        <button type="button" class="btn-action btn-ignite" id="btn-global-ignite" title="Apply ignition spark to selected vessel">
          ⚡ Spark / Ignite
        </button>
        <button type="button" class="btn-action btn-heat" id="btn-global-heat" title="Add 5 kJ thermal energy to selected vessel">
          🔥 Heat +5 kJ
        </button>
        <button type="button" class="btn-action btn-ghost" id="btn-reset-bench" title="Reset bench equipment to clean starter state">
          ↺ Reset Bench
        </button>
      </div>
    `;

    this.simClockEl = container.querySelector('#sim-clock-readout') as HTMLElement;

    // Speed buttons
    const speedBtns = container.querySelectorAll<HTMLButtonElement>('button[data-speed]');
    speedBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        speedBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const spd = Number(btn.dataset.speed) as 1 | 10 | 100;
        this.bench.speedMultiplier = spd;
      });
    });

    const pauseBtn = container.querySelector('#btn-pause-sim') as HTMLButtonElement;
    pauseBtn.addEventListener('click', () => {
      this.bench.paused = !this.bench.paused;
      pauseBtn.textContent = this.bench.paused ? '▶' : '⏸';
      pauseBtn.classList.toggle('active', this.bench.paused);
    });

    container.querySelector('#btn-global-ignite')?.addEventListener('click', () => {
      this.bench.igniteVessel();
    });

    container.querySelector('#btn-global-heat')?.addEventListener('click', () => {
      this.bench.heatVessel(5000);
    });

    container.querySelector('#btn-reset-bench')?.addEventListener('click', () => {
      this.clearWarningBanner();
      this.bench.setupStarterBench();
      this.showNotice('Bench reset to clean starter configuration.', 'info');
    });

    // Preset scenario buttons
    container.querySelectorAll<HTMLButtonElement>('button[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.runScenarioPreset(btn.dataset.preset || '');
      });
    });
  }

  public mountBannersAndInspector(benchOverlayContainer: HTMLElement): void {
    benchOverlayContainer.innerHTML = `
      <div class="warning-banner hidden" id="hazard-warning-banner" role="alert" aria-live="assertive">
        <div class="warning-banner-content">
          <span class="warning-icon">⚠</span>
          <div class="warning-text-block">
            <div class="warning-title" id="hazard-banner-title">HAZARD DETECTED</div>
            <div class="warning-detail" id="hazard-banner-detail"></div>
          </div>
        </div>
        <button type="button" class="warning-dismiss" id="btn-dismiss-hazard" aria-label="Dismiss hazard warning">✕</button>
      </div>

      <div class="notice-toast hidden" id="bench-notice-toast" role="status" aria-live="polite"></div>

      <aside class="vessel-inspector" id="vessel-inspector-card" aria-label="Selected Vessel Inspector">
      </aside>
    `;

    this.warningBannerEl = benchOverlayContainer.querySelector('#hazard-warning-banner') as HTMLElement;
    this.noticeToastEl = benchOverlayContainer.querySelector('#bench-notice-toast') as HTMLElement;
    this.inspectorContainer = benchOverlayContainer.querySelector('#vessel-inspector-card') as HTMLElement;

    benchOverlayContainer.querySelector('#btn-dismiss-hazard')?.addEventListener('click', () => {
      this.clearWarningBanner();
    });

    this.updateInspector(this.bench.getSelectedVessel());
  }

  public mountBottomToolbar(container: HTMLElement): void {
    const allSpeciesCount = Object.keys(SPECIES).length;

    container.innerHTML = `
      <div class="toolbar-layout">
        <!-- Left Section: Draggable Equipment & Meters -->
        <section class="toolbar-equipment-pane" aria-label="Equipment & Meters">
          <div class="pane-header">
            <span class="pane-title">LABWARE & INSTRUMENTS</span>
            <span class="pane-hint">Drag onto bench or click to place</span>
          </div>
          <div class="equipment-strip" id="equipment-strip">
            ${EQUIPMENT_CATALOG.map(
              (item) => `
              <button
                type="button"
                class="equip-card"
                draggable="true"
                data-equip-type="${item.type}"
                title="Drag onto bench or click to add ${item.label}"
              >
                <span class="equip-icon" data-icon="${item.type}">${this.getEquipmentSvgIcon(item.type)}</span>
                <span class="equip-name">${item.label}</span>
                <span class="equip-sub">${item.subtitle}</span>
              </button>
            `
            ).join('')}
          </div>
        </section>

        <!-- Right Section: 60+ Chemical Library Drawer with Search, Category Tabs & Pour Controls -->
        <section class="toolbar-chemicals-pane" aria-label="Chemical Reagent Drawer">
          <div class="chem-drawer-controls">
            <div class="chem-search-wrap">
              <span class="search-icon" aria-hidden="true">⌕</span>
              <input
                type="search"
                id="chem-search-input"
                class="chem-search-input"
                placeholder="Search ${allSpeciesCount} chemicals (e.g. H2, O2, HCl, NaOH, CuSO4, NaOCl)..."
                aria-label="Search chemicals by formula, name, or hazard"
                autocomplete="off"
              />
              <span class="chem-count-badge" id="chem-count-badge">${allSpeciesCount}</span>
            </div>

            <div class="chem-category-tabs" role="tablist" aria-label="Chemical categories">
              ${CATEGORY_LABELS.map(
                (cat) => `
                <button
                  type="button"
                  role="tab"
                  aria-selected="${cat.id === this.activeCategory}"
                  class="cat-tab ${cat.id === this.activeCategory ? 'active' : ''}"
                  data-cat="${cat.id}"
                >
                  ${cat.label}
                </button>
              `
              ).join('')}
            </div>

            <div class="pour-rate-control" title="Adjust continuous hold-to-pour flow speed">
              <label for="pour-rate-slider" class="rate-label">Hold Flow:</label>
              <input
                type="range"
                id="pour-rate-slider"
                min="0.25"
                max="3.0"
                step="0.25"
                value="1.0"
              />
              <span class="rate-val" id="pour-rate-val">1.0×</span>
            </div>
          </div>

          <div class="chem-grid" id="chem-drawer-grid" role="region" aria-label="Chemical species cards">
          </div>
        </section>
      </div>
    `;

    this.chemGridEl = container.querySelector('#chem-drawer-grid') as HTMLElement;
    this.chemCountBadgeEl = container.querySelector('#chem-count-badge') as HTMLElement;

    // Bind equipment drag & click
    container.querySelectorAll<HTMLButtonElement>('.equip-card').forEach((card) => {
      const eqType = card.dataset.equipType as any;
      card.addEventListener('dragstart', (e) => {
        if (e.dataTransfer) {
          e.dataTransfer.setData('application/x-chemlab-equipment', eqType);
          e.dataTransfer.effectAllowed = 'copy';
        }
      });
      card.addEventListener('click', () => {
        this.bench.addEquipment(eqType);
      });
    });

    // Search input
    const searchInput = container.querySelector('#chem-search-input') as HTMLInputElement;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.trim().toLowerCase();
      this.renderChemicalGrid();
    });

    // Category tabs
    const catTabs = container.querySelectorAll<HTMLButtonElement>('.cat-tab');
    catTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        catTabs.forEach((t) => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        this.activeCategory = (tab.dataset.cat as ChemicalCategory) || 'all';
        this.renderChemicalGrid();
      });
    });

    // Pour flow rate slider
    const rateSlider = container.querySelector('#pour-rate-slider') as HTMLInputElement;
    const rateVal = container.querySelector('#pour-rate-val') as HTMLElement;
    rateSlider.addEventListener('input', () => {
      this.flowRateMultiplier = parseFloat(rateSlider.value) || 1.0;
      rateVal.textContent = `${this.flowRateMultiplier.toFixed(2).replace(/\.00$/, '.0')}×`;
    });

    this.renderChemicalGrid();
  }

  private renderChemicalGrid(): void {
    const allSpecies = Object.values(SPECIES);
    const filtered = allSpecies.filter((sp) => {
      if (this.activeCategory !== 'all' && getSpeciesCategory(sp) !== this.activeCategory) {
        return false;
      }
      if (!this.searchQuery) return true;
      const hay = `${sp.id} ${sp.formula} ${sp.name} ${(sp.hazard || []).join(' ')}`.toLowerCase();
      return hay.includes(this.searchQuery);
    });

    this.chemCountBadgeEl.textContent = `${filtered.length}`;

    if (filtered.length === 0) {
      this.chemGridEl.innerHTML = `
        <div class="chem-empty-state">
          No chemicals match "${this.escapeHtml(this.searchQuery)}" in this category.
        </div>
      `;
      return;
    }

    this.chemGridEl.innerHTML = filtered
      .map((sp) => this.renderChemicalCardHtml(sp))
      .join('');

    // Wire fixed pour and hold-to-pour events
    this.chemGridEl.querySelectorAll<HTMLElement>('.chem-card').forEach((card) => {
      const spId = card.dataset.speciesId!;
      card.addEventListener('dragstart', (e) => {
        if (e.dataTransfer) {
          e.dataTransfer.setData('application/x-chemlab-species', spId);
          e.dataTransfer.effectAllowed = 'copy';
        }
      });

      card.querySelectorAll<HTMLButtonElement>('button[data-pour-fixed]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const amt = parseFloat(btn.dataset.amount || '10');
          const unit = (btn.dataset.unit || 'mL') as PourUnit;
          this.bench.pourIntoSelected(spId, amt, unit);
        });
      });

      const holdBtn = card.querySelector<HTMLButtonElement>('button[data-pour-hold]');
      if (holdBtn) {
        const startHold = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          this.stopHoldPour();
          const sp = SPECIES[spId];
          if (!sp) return;
          const unit: PourUnit = sp.phase === 's' ? 'g' : sp.phase === 'g' ? 'mol' : 'mL';
          const stepAmt =
            (sp.phase === 's' ? 0.25 : sp.phase === 'g' ? 0.1 : 2.5) * this.flowRateMultiplier;

          this.bench.pourIntoSelected(spId, stepAmt, unit);
          this.holdIntervalId = window.setInterval(() => {
            this.bench.pourIntoSelected(spId, stepAmt, unit);
          }, 120);
        };

        holdBtn.addEventListener('pointerdown', startHold);
        holdBtn.addEventListener('pointerup', () => this.stopHoldPour());
        holdBtn.addEventListener('pointerleave', () => this.stopHoldPour());
        holdBtn.addEventListener('pointercancel', () => this.stopHoldPour());
      }
    });
  }

  private stopHoldPour(): void {
    if (this.holdIntervalId !== null) {
      window.clearInterval(this.holdIntervalId);
      this.holdIntervalId = null;
    }
  }

  private renderChemicalCardHtml(sp: Species): string {
    const swatchColor =
      sp.color ??
      (sp.phase === 'g'
        ? '#38bdf8'
        : sp.phase === 'aq'
          ? '#a5f3fc'
          : sp.phase === 'l'
            ? '#60a5fa'
            : '#cbd5e1');

    const hazards = sp.hazard ?? [];
    const hazardBadge =
      hazards.length > 0
        ? `<span class="chem-hazard-dot" title="Hazards: ${hazards.join(', ')}">⚠ ${hazards[0]}</span>`
        : '';

    // Provide 10 mL, 1 g, and (for gases/stoichiometry) 1 mol fixed buttons + Hold button
    const thirdBtn =
      sp.phase === 'g'
        ? `<button type="button" class="pour-btn" data-pour-fixed="true" data-amount="1" data-unit="mol" title="Inject 1.0 mol gas">+1 mol</button>`
        : `<button type="button" class="pour-btn pour-btn-hold" data-pour-hold="true" title="Press and hold to pour continuously">Hold</button>`;

    const holdForGas =
      sp.phase === 'g'
        ? `<button type="button" class="pour-btn pour-btn-hold" data-pour-hold="true" title="Hold to inject gas stream">Hold</button>`
        : '';

    return `
      <div class="chem-card" draggable="true" data-species-id="${sp.id}">
        <div class="chem-card-top">
          <div class="chem-formula-group">
            <span class="chem-swatch" style="background:${swatchColor}"></span>
            <span class="chem-formula">${formatFormula(sp.formula)}</span>
            <span class="chem-phase phase-${sp.phase}">${sp.phase}</span>
          </div>
          ${hazardBadge}
        </div>
        <div class="chem-name" title="${this.escapeHtml(sp.name)} (${sp.molarMass.toFixed(2)} g/mol)">
          ${this.escapeHtml(sp.name)}
        </div>
        <div class="chem-meta">
          <span>${sp.molarMass.toFixed(1)} g/mol</span>
          <span>ΔHf ${sp.dHf > 0 ? '+' : ''}${sp.dHf.toFixed(0)}</span>
        </div>
        <div class="chem-actions">
          <button type="button" class="pour-btn" data-pour-fixed="true" data-amount="10" data-unit="mL" title="Add 10 mL">+10 mL</button>
          <button type="button" class="pour-btn" data-pour-fixed="true" data-amount="1" data-unit="g" title="Add 1 gram">+1 g</button>
          ${thirdBtn}
          ${holdForGas}
        </div>
      </div>
    `;
  }

  public updateSimClock(simSeconds: number): void {
    if (this.simClockEl) {
      this.simClockEl.textContent = `${simSeconds.toFixed(1)}s`;
    }
  }

  public updateInspector(vessel: LabVessel | null): void {
    if (!this.inspectorContainer) return;

    if (!vessel) {
      this.inspectorContainer.innerHTML = `
        <div class="inspector-empty">
          <div class="inspector-title">NO VESSEL SELECTED</div>
          <p>Click a vessel on the bench or drag a new Beaker/Flask from the bottom toolbar.</p>
        </div>
      `;
      return;
    }

    const entries = Object.entries(vessel.mixture.moles).filter(([, n]) => n > 1e-9);
    const hasContents = entries.length > 0;
    const tempC = vessel.mixture.tempK - 273.15;
    const phVal = hasContents ? pH(vessel.mixture) : 7.0;
    const volML = vessel.mixture.volumeL * 1000;
    const maxML = vessel.capacityL * 1000;
    const fillPct = Math.min(100, (volML / maxML) * 100);
    const totalMassG = vessel.mixture.totalMass();
    const pressureKPa = vessel.lastStepResult.pressureKPa;

    const phClass = phVal < 6.5 ? 'metric-acid' : phVal > 7.5 ? 'metric-base' : 'metric-neutral';

    let reactionDisplay = `<span class="rxn-none">No reaction</span>`;
    if (vessel.lastReactionsFired.length > 0) {
      reactionDisplay = vessel.lastReactionsFired
        .map((rId) => `<div class="rxn-equation">${formatReactionEquation(rId)}</div>`)
        .join('');
    }

    const otherVessels = this.bench.getVessels().filter((v) => v.id !== vessel.id);

    this.inspectorContainer.innerHTML = `
      <div class="inspector-header">
        <div>
          <div class="inspector-eyebrow">ACTIVE VESSEL TELEMETRY</div>
          <h2 class="inspector-vessel-name">${this.escapeHtml(vessel.label)}</h2>
        </div>
        <button
          type="button"
          class="btn-stopper ${vessel.closed ? 'stoppered' : ''}"
          id="btn-toggle-stopper"
          title="Toggle rubber stopper to test open vs closed gas pressure"
        >
          ${vessel.closed ? '🔒 Stoppered' : '🔓 Open Top'}
        </button>
      </div>

      <div class="inspector-metrics-grid">
        <div class="metric-box">
          <span class="metric-label">TEMPERATURE</span>
          <span class="metric-value">${tempC.toFixed(1)} °C</span>
          <span class="metric-sub">${vessel.mixture.tempK.toFixed(1)} K</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">SOLUTION pH</span>
          <span class="metric-value ${phClass}">${phVal.toFixed(2)}</span>
          <span class="metric-sub">${phVal < 6.5 ? 'Acidic' : phVal > 7.5 ? 'Basic' : 'Neutral'}</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">VOLUME / CAP</span>
          <span class="metric-value">${volML.toFixed(1)} mL</span>
          <span class="metric-sub">${fillPct.toFixed(0)}% of ${maxML.toFixed(0)} mL</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">MASS & GAS P</span>
          <span class="metric-value">${totalMassG.toFixed(2)} g</span>
          <span class="metric-sub">${pressureKPa.toFixed(1)} kPa</span>
        </div>
      </div>

      <div class="inspector-section">
        <div class="section-label">REACTION STATUS</div>
        <div class="rxn-status-box">
          ${reactionDisplay}
        </div>
      </div>

      <div class="inspector-section">
        <div class="section-label">SPECIES CONTENTS (${entries.length})</div>
        ${
          entries.length === 0
            ? `<div class="contents-empty">Vessel is empty. Pour reagents from the bottom drawer.</div>`
            : `<div class="contents-table-wrap">
                <table class="contents-table">
                  <thead>
                    <tr>
                      <th>Species</th>
                      <th>Moles</th>
                      <th>Mass</th>
                      <th>Vol / Conc</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${entries
                      .map(([spId, moles]) => {
                        const sp = SPECIES[spId];
                        if (!sp) return '';
                        const mass = moles * sp.molarMass;
                        const volOrConc =
                          sp.phase === 'aq' && vessel.mixture.volumeL > 0
                            ? `${(moles / vessel.mixture.volumeL).toFixed(2)} M`
                            : sp.phase === 'l'
                              ? `${((mass / (sp.density ?? 1.0))).toFixed(1)} mL`
                              : sp.phase === 'g'
                                ? 'gas'
                                : 'solid';
                        return `
                          <tr>
                            <td>
                              <span class="tbl-formula">${formatFormula(sp.formula)}</span>
                              <span class="chem-phase phase-${sp.phase}">${sp.phase}</span>
                            </td>
                            <td class="num-col">${moles.toFixed(4)} mol</td>
                            <td class="num-col">${mass.toFixed(2)} g</td>
                            <td class="num-col">${volOrConc}</td>
                          </tr>
                        `;
                      })
                      .join('')}
                  </tbody>
                </table>
              </div>`
        }
      </div>

      <div class="inspector-actions">
        <button type="button" class="insp-btn insp-btn-ignite" id="insp-btn-ignite">⚡ Spark</button>
        <button type="button" class="insp-btn insp-btn-heat" id="insp-btn-heat">🔥 +5 kJ</button>
        ${
          otherVessels.length > 0
            ? `<button type="button" class="insp-btn" id="insp-btn-transfer" title="Pour 25 mL into ${this.escapeHtml(otherVessels[0].label)}">
                ⇄ Pour → ${this.escapeHtml(otherVessels[0].label.split(' ')[0])}
              </button>`
            : ''
        }
        <button type="button" class="insp-btn insp-btn-muted" id="insp-btn-rinse">💧 Rinse</button>
      </div>
    `;

    this.inspectorContainer.querySelector('#btn-toggle-stopper')?.addEventListener('click', () => {
      this.bench.toggleVesselStopper(vessel);
    });
    this.inspectorContainer.querySelector('#insp-btn-ignite')?.addEventListener('click', () => {
      this.bench.igniteVessel(vessel);
    });
    this.inspectorContainer.querySelector('#insp-btn-heat')?.addEventListener('click', () => {
      this.bench.heatVessel(5000, vessel);
    });
    this.inspectorContainer.querySelector('#insp-btn-transfer')?.addEventListener('click', () => {
      if (otherVessels[0]) {
        this.bench.transferVessels(vessel, otherVessels[0], 25);
      }
    });
    this.inspectorContainer.querySelector('#insp-btn-rinse')?.addEventListener('click', () => {
      this.bench.rinseVessel(vessel);
    });
  }

  public showHazardBanner(hazards: string[], detailMessage: string, vessel: LabVessel): void {
    if (!this.warningBannerEl) return;
    const titleEl = this.warningBannerEl.querySelector('#hazard-banner-title') as HTMLElement;
    const detailEl = this.warningBannerEl.querySelector('#hazard-banner-detail') as HTMLElement;

    const badges = hazards.map((h) => h.toUpperCase()).join(' · ');
    titleEl.textContent = `SAFETY HAZARD WARNING [${badges}] — ${vessel.label.toUpperCase()}`;
    detailEl.textContent = detailMessage;
    this.warningBannerEl.classList.remove('hidden');
  }

  public clearWarningBanner(): void {
    if (this.warningBannerEl) {
      this.warningBannerEl.classList.add('hidden');
    }
  }

  public showNotice(message: string, level: 'info' | 'warn' | 'danger' = 'info'): void {
    if (!this.noticeToastEl) return;
    this.noticeToastEl.textContent = message;
    this.noticeToastEl.className = `notice-toast notice-${level}`;
    window.clearTimeout((this.noticeToastEl as any)._hideTimer);
    (this.noticeToastEl as any)._hideTimer = window.setTimeout(() => {
      this.noticeToastEl.classList.add('hidden');
    }, 4200);
  }

  private runScenarioPreset(preset: string): void {
    const vessel = this.bench.getSelectedVessel();
    if (!vessel) return;

    this.clearWarningBanner();
    this.bench.rinseVessel(vessel);

    if (preset === 'make_water') {
      this.bench.toggleVesselStopper(vessel, true);
      this.bench.pourIntoVessel(vessel, 'H2', 2.0, 'mol');
      this.bench.pourIntoVessel(vessel, 'O2', 1.0, 'mol');
      this.showNotice(
        'Loaded 2 mol H₂ + 1 mol O₂ in stoppered vessel. Click "⚡ Spark / Ignite" to synthesize 2 mol H₂O!',
        'info'
      );
    } else if (preset === 'neutralize') {
      this.bench.pourIntoVessel(vessel, 'HCl', 50, 'mL', { molarity: 1.0 });
      this.bench.pourIntoVessel(vessel, 'NaOH', 50, 'mL', { molarity: 1.0 });
      this.showNotice('Mixed 50 mL 1.0M HCl + 50 mL 1.0M NaOH → Neutralized to NaCl + H₂O (pH 7.00)!', 'info');
    } else if (preset === 'heat_gas') {
      this.bench.toggleVesselStopper(vessel, true);
      this.bench.pourIntoVessel(vessel, 'N2', 2.5, 'mol');
      this.bench.heatVessel(65000, vessel);
    } else if (preset === 'hazard_na') {
      this.bench.pourIntoVessel(vessel, 'H2O', 80, 'mL');
      this.bench.pourIntoVessel(vessel, 'Na', 3.0, 'g');
    } else if (preset === 'hazard_chloramine') {
      this.bench.pourIntoVessel(vessel, 'NaOCl', 40, 'mL', { molarity: 1.0 });
      this.bench.pourIntoVessel(vessel, 'NH3(aq)', 40, 'mL', { molarity: 1.0 });
    }
  }

  private getEquipmentSvgIcon(type: string): string {
    switch (type) {
      case 'beaker':
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 4h14l-1 15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 4z"/><path d="M6 12h12"/></svg>`;
      case 'flask':
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3h6m-5 0v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/></svg>`;
      case 'test_tube':
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3h8m-7 0v14a3 3 0 0 0 6 0V3"/></svg>`;
      case 'burner':
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3c2 3 4 5 4 8a4 4 0 0 1-8 0c0-3 2-5 4-8z"/><path d="M7 21h10m-5-6v6"/></svg>`;
      case 'scale':
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="12" width="18" height="8" rx="2"/><path d="M6 8h12m-6 0v4"/></svg>`;
      case 'thermometer':
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 14.76V5a2 2 0 0 0-4 0v9.76a4 4 0 1 0 4 0z"/></svg>`;
      case 'ph_meter':
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="6" y="3" width="12" height="7" rx="1.5"/><path d="M12 10v11"/><circle cx="12" cy="19" r="2"/></svg>`;
      default:
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 3h2v6l2 10-3 2-3-2 2-10V3z"/></svg>`;
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
