# CHEM-LAB // Virtual Stoichiometric & Thermodynamic Chemistry Bench

A browser-based chemistry laboratory simulator built with a standalone, reference-backed chemical engine (`src/engine`), an interactive Canvas 2D laboratory bench (`src/ui`), and a persistent auto-logging lab notebook with live telemetry graphs (`src/notebook`).

---

## Quick Start

### Prerequisites
- Node.js 18+ and npm

### Install & Run
```bash
# Install dependencies
npm install

# Start development server (Vite)
npm run dev

# Run the automated test suite (Vitest)
npm test

# Type-check and build production bundle
npm run build
```

---

## Architecture

### 1. Pure Chemistry Engine (`src/engine/`)
The engine contains zero DOM imports and is independently testable:
- **`src/engine/data/species.ts`** (`SPECIES`): 62 chemical species across gases (`H2`, `O2`, `N2`, `Cl2`, `CO2`, `CO`, `NH3`, `CH4`, `SO2`, `NO2`, `H2S`, `NH2Cl`, etc.), acids (`HCl`, `H2SO4`, `HNO3`, `CH3COOH`, `H2CO3`, `H3PO4`, `HF`), bases (`NaOH`, `KOH`, `NH3(aq)`, `Ca(OH)2`, `Ba(OH)2`, `Mg(OH)2`), metals/solids (`Na`, `K`, `Ca`, `Mg`, `Al`, `Zn`, `Fe`, `Cu`, `Ag`, `C`, `S`), salts/precipitates (`NaCl`, `AgNO3`, `AgCl`, `BaCl2`, `BaSO4`, `CuSO4`, `NaHCO3`, `NaOCl`, etc.), oxides, and organics (`C2H5OH`, `C6H12O6`, `CH3OH`, `C3H8`, `C2H4`). Every entry includes reference thermodynamics ($\Delta H_f^\circ$, $S^\circ$, $C_p$) sourced from the **NIST Chemistry WebBook (SRD 69)** or **CRC Handbook of Chemistry and Physics (104th Ed.)**.
- **`src/engine/data/reactions.ts`** (`REACTIONS`) & **`src/engine/formula.ts`** (`parseFormula`): 42 curated reactions verified automatically for:
  - Exact elemental atom conservation and charge balance.
  - **Hess's Law consistency**: stored $\Delta H_{\text{rxn}}^\circ$ matches $\sum \nu_p \Delta H_f^\circ(\text{products}) - \sum \nu_r \Delta H_f^\circ(\text{reactants})$ within $\le 1\text{ kJ/mol}$.
  - Activation energy ($E_a$), reaction conditions (`ignition`, `minTempK`, `catalyst`), reversibility ($K_{\text{eq}}$), and safety hazard flags (`explosive`, `toxic`, `flammable`, `corrosive`, `oxidizer`).
- **`src/engine/mixture.ts`** (`Mixture`): Tracks molar composition (`moles`), solution/condensed volume (`volumeL`), temperature (`tempK`), total mass conservation (`totalMass()`), and mixture heat capacity (`heatCapacity()`).
- **`src/engine/thermo.ts`**: Ideal gas law headspace pressure ($P = n_{\text{gas}} R T / V_{\text{vessel}}$), reaction enthalpy ($\Delta H$), entropy ($\Delta S$), and Gibbs free energy ($\Delta G = \Delta H - T\Delta S$).
- **`src/engine/solution.ts`** (`pH`): Solves aqueous $[\text{H}^+]$ numerically via charge balance and bisection over $\log_{10}[\text{H}^+]$, accounting for water auto-ionization ($K_w = 10^{-14}$), strong electrolytes, weak monoprotic/diprotic acids ($K_a, K_{a2}$), and weak bases ($K_b$).
- **`src/engine/simulator.ts`** (`Simulator`): Time-stepped kinetic & thermodynamic simulator using fixed 50 ms sub-steps:
  - Deterministic reaction ordering (sorted by activation energy $E_a$, then reaction ID).
  - Arrhenius rate law $k = A \exp(-E_a / RT)$ with ignition spark support (`ignite()`) and thermal input (`heat(joules)`).
  - Limiting reagent stoichiometry for irreversible reactions and numeric reaction-quotient relaxation toward $K_{\text{eq}}$ for reversible reactions.
  - Closed-vessel gas overpressure monitoring (`burst` hazard emitted when internal pressure exceeds vessel rating).

### 2. Interactive Bench UI (`src/ui/`)
- **`src/ui/bench.ts`** (`LabBench`): HiDPI Canvas 2D renderer and pointer/drag controller with walnut butcher-block benchtop, brushed steel backsplash, borosilicate glassware (Beaker, Erlenmeyer Flask, Test Tube), Bunsen burner, analytical scale, digital thermometer, pH electrode meter, and graduated pipette.
- **`src/ui/equipment.ts`**: Pour calculation math (`mL`, `g`, `mol`), vessel capacity overflow clamping, vessel-to-vessel pouring transfers, dynamic species color blending, precipitate sediment calculation, and chemical category classification.
- **`src/ui/effects.ts`** (`EffectsManager`): Real-time particle effects for gas evolution bubbles, settling precipitate crystals, steam/condensation plumes, dual-cone Bunsen flame, ignition sparks, and explosion white flash + camera shake + shockwave.
- **`src/ui/toolbar.ts`** (`ToolbarAndInspectorUI`): Bottom reagent drawer (search + category tabs + hold-to-pour & fixed `+10 mL` / `+1 g` / `+1 mol` controls), speed selector (`1×`, `10×`, `100×`), scenario presets, hazard warning banner, and floating Vessel Inspector card.

### 3. Lab Notebook & Telemetry (`src/notebook/`)
- **`src/notebook/notebook.ts`** (`Notebook`): Auto-logs bench actions, reactions, and hazards; persists automatically to `localStorage` (`Notebook.load()` / `notebook.save()`) with safe fallback if storage is corrupted.
- **`src/notebook/graph.ts`** (`LiveTelemetryGraphs`, `TimeSeriesSampler`): Live Canvas 2D line/area charts for **Temperature (°C) vs Time** and **Solution pH vs Time**.
- **`src/notebook/export.ts`**: One-click export of notebook logs to **JSON** and **CSV**.

---

## Try These Scenarios in the Browser

1. **Synthesize Water ($2\text{H}_2 + \text{O}_2 \rightarrow 2\text{H}_2\text{O}$)**:
   - Click the **`2H₂ + O₂ → 2H₂O`** scenario button in the top bar (or stopper a vessel, add `2 mol H2` and `1 mol O2` from the **Gases** tab).
   - Observe that no reaction occurs at room temperature without activation.
   - Click **`⚡ Spark / Ignite`** — the mixture ignites with a flash, forming `2.0000 mol H2O(l)`, releasing `~571.7 kJ` of heat, and condensing liquid water in the vessel.
2. **Acid–Base Neutralization ($\text{HCl} + \text{NaOH} \rightarrow \text{NaCl} + \text{H}_2\text{O}$)**:
   - Click **`HCl + NaOH`** (or add `10 mL` of `HCl` from the **Acids** tab, check pH `~0–1`, then add `10 mL` of `NaOH` from the **Bases** tab).
   - Watch the neutralization reaction fire immediately, bringing the solution to **pH 7.00** and raising the temperature by exothermic heat of neutralization ($\Delta H = -56.9\text{ kJ/mol}$).
3. **Closed-Vessel Gas Heating & Burst**:
   - Click **`Closed Gas Burst`** (or toggle **`🔒 Stoppered`** on a vessel, add `N2` or `CO2` gas, and click **`🔥 Heat +5 kJ`** or drag the **Bunsen Burner** underneath and click the burner to ignite it).
   - Watch internal gas pressure (kPa) climb according to $PV = nRT$ until the vessel exceeds `300 kPa` and triggers a **BURST** hazard with flash, shake, and safety banner.
4. **Hazardous Reactions ($\text{Na} + \text{H}_2\text{O}$ or $\text{NaOCl} + \text{NH}_3$)**:
   - Click **`Na + H₂O Hazard`** or **`NaOCl + NH₃`** to observe vigorous gas evolution, exothermic temperature jump, explosion/toxic gas warnings, and automatic hazard logging in the Lab Notebook.
5. **Carbonyl Reduction ($\text{Propiophenone} + \text{NaBH}_4$)**:
   - Click **`Propiophenone + NaBH4`** to set up 0.04 mol propiophenone, 0.01 mol NaBH₄, and 0.02 mol H₂O in a beaker.
   - Observe immediate reduction to 0.04 mol 1-phenyl-1-propanol and 0.01 mol NaBO₂ with strong exothermic warming, reaction equation display in the Inspector, and notebook logging.

---

## Estimated Thermodynamic Data

When experimental thermodynamic data is unavailable in the NIST Chemistry WebBook (SRD 69), species entries are annotated with the `estimated` field listing which parameters are derived. In the UI, these species display an `est.` badge in the chemical drawer card and an `Estimated thermodynamic data (±10 kJ/mol)` indicator in the active vessel inspector.

* **PROPIOPHENONE** ($\text{C}_9\text{H}_{10}\text{O}$, liquid, CAS 93-55-0):
  * $\Delta_f H^\circ = -167.2\text{ kJ/mol}$ — NIST SRD 69 experimental liquid value (Colomina, Latorre, et al., 1961).
  * $S^\circ = 268.0\text{ J/(mol}\cdot\text{K)}$ *(estimated)* — Scaled from NIST ethylbenzene liquid ($S^\circ = 255.01\text{ J/(mol}\cdot\text{K)}$) plus the NIST methylene ($-\text{CH}_2-$) increment ($+32.8\text{ J/(mol}\cdot\text{K)}$, from propylbenzene vs ethylbenzene and 1-propanol vs ethanol) minus liquid ketone dipole ordering penalty (~$19.8\text{ J/(mol}\cdot\text{K)}$).
  * $C_p = 240.0\text{ J/(mol}\cdot\text{K)}$ *(estimated)* — Richard Fuchs (1980, *Can. J. Chem.* 58: 2305) measured $238.1\text{ J/(mol}\cdot\text{K)}$; analog scaling from NIST acetophenone ($C_p = 227.6\text{ J/(mol}\cdot\text{K)}$) plus $-\text{CH}_2-$ increment (~$12.4\text{ J/(mol}\cdot\text{K)}$) gives $240.0\text{ J/(mol}\cdot\text{K)}$.
* **PHENYLPROPANOL** ($\text{C}_9\text{H}_{12}\text{O}$, liquid, CAS 93-54-9, 1-phenyl-1-propanol):
  * $\Delta_f H^\circ = -235.20\text{ kJ/mol}$ *(estimated)* — Calculated from propiophenone ($-167.20\text{ kJ/mol}$) minus $68.00\text{ kJ/mol}$ for ketone $\rightarrow$ sec-alcohol reduction, calibrated from NIST analogs acetone $\rightarrow$ isopropanol ($-69.70\text{ kJ/mol}$) and cyclohexanone $\rightarrow$ cyclohexanol ($-75.90\text{ kJ/mol}$).
  * $S^\circ = 247.0\text{ J/(mol}\cdot\text{K)}$ *(estimated)* — Calculated from propiophenone ($268.0\text{ J/(mol}\cdot\text{K)}$) minus $21.0\text{ J/(mol}\cdot\text{K)}$ for liquid alcohol hydrogen-bond ordering, calibrated from acetone $\rightarrow$ isopropanol ($-19.8\text{ J/(mol}\cdot\text{K)}$) and cyclohexanone $\rightarrow$ cyclohexanol ($-25.2\text{ J/(mol}\cdot\text{K)}$).
  * $C_p = 268.0\text{ J/(mol}\cdot\text{K)}$ *(estimated)* — Calculated from propiophenone ($240.0\text{ J/(mol}\cdot\text{K)}$) plus $28.0\text{ J/(mol}\cdot\text{K)}$ for secondary alcohol librational mode, calibrated from acetone $\rightarrow$ isopropanol ($+28.1\text{ J/(mol}\cdot\text{K)}$) and consistent with 3-phenyl-1-propanol NIST liquid $C_p = 280.74\text{ J/(mol}\cdot\text{K)}$ minus branching offset.
* **Reaction $\Delta H$**:
  * `propiophenone_nabh4_reduction`: $\Delta H = -524.23\text{ kJ/mol}$ (by Hess's law).
  * Per-ketone enthalpy: $-131.06\text{ kJ/mol}$, within $1.70\text{ kJ/mol}$ of the acetone reduction analog ($-132.76\text{ kJ/mol}$, well within the $\pm 20\text{ kJ/mol}$ sanity threshold).
