# Chemistry Lab Simulator: Design

## Intent
A professional-feeling virtual chemistry lab in the browser. The user stands at a lab bench, picks equipment (beakers, flasks, test tubes, burner, scale, pipette, thermometer, pH meter) and chemicals (e.g. hydrogen, oxygen), combines them, and sees chemically correct results, for example H2 + O2 -> H2O when ignited. The user is a hobbyist/learner who wants "a real chemistry engine", not a school-level toy.

Process note: the user acts as manager. Claude supervises and reviews. Antigravity (`agy` CLI) writes all code. Claude writes no product code.

## Goals
- Real chemistry engine: balanced equations, stoichiometry and limiting reagent, mass and atom conservation, thermodynamics (dH, dS, dG for spontaneity, heat released, temperature change), ideal gas law, acid/base pH, simple kinetics with activation energy (H2 + O2 needs a spark or heat).
- Large chemical library (target 60+ species: common gases, acids, bases, salts, metals, organics like ethanol/methane) and 40+ reactions.
- Realistic bench: drag equipment from a toolbar, pour/transfer chemicals, heat, stir, measure. Visual effects: bubbles, color change, precipitate, flame, condensation, glow.
- Pro look: dark, clean, instrument-panel UI. Right-side lab notebook auto-logs every action and result, with live graphs (temperature vs time, pH vs time) and export.
- Safety behavior: dangerous mixes produce visible warnings and effects (explosion, toxic gas), never crashes.

## Non-goals
- No backend, accounts, or multiplayer.
- No 3D. No quantum chemistry or molecular dynamics.
- No claim of lab-safety training value.

## Anti-goals (user: "I would wince at all of these")
- Wrong chemistry: unbalanced equations, mass not conserved, wrong enthalpy values.
- Ugly or toy-like UI.
- Too few chemicals or reactions to feel like a lab.
A build that passes tests but looks amateur, or looks nice but gives wrong chemistry, is a failure.

## Decided by the user
- Web app, runs in a browser.
- Real chemistry engine (not simplified school mode).
- Bench-centered layout with toolbar. User delegated the rest.

## Claude's calls (user has not confirmed; change if wrong)
- Stack: TypeScript, Vite, Canvas 2D for the bench, Vitest for tests. No framework requirement for UI beyond what the builder judges sensible.
- Layout "C": bench center, bottom toolbar (vessels | chemicals | heat | meters), right-side lab notebook.
- Engine is a standalone module with no UI imports, so it is testable alone.
- Data (species, reactions) lives in plain JSON/TS data files, sourced from standard reference values (NIST/CRC-style), with the source noted per dataset.
- Staged delivery, each stage must pass its gate before the next starts: (1) engine + data + tests, (2) bench UI and interactions, (3) notebook, graphs, effects, polish.

## Engine model (Claude's calls, added after builder check)
- Reactions come from a fixed, curated reaction table (each with balanced equation, conditions such as ignition/catalyst/temperature, dH, activation energy, rate law, phase info, hazard flags). The engine does not invent products. A mix with no matching reaction returns "no reaction".
- Mixtures hold species in moles with phase and volume. Aqueous solutions track concentration and ions. Strong acids/bases dissociate fully; weak acids/bases use Ka/Kb equilibrium. pH is computed from real [H+], not from a shortcut.
- Reactions run by a time-stepped simulation (fixed tick, e.g. 50 ms simulated step). Kinetics use Arrhenius rate; heating adds energy, temperature follows heat capacity. Reactions that go to near-completion may use full conversion with limiting reagent; reversible ones (weak acids, some gas reactions) use equilibrium constants.
- Hazards are data flags on table reactions plus a small list of known dangerous pairs (e.g. bleach + ammonia -> chloramine gas, listed as reactions). Explosion/toxic effects are visual warnings and also real chemistry outputs (heat, gas moles, pressure rise). Unlisted dangerous mixes simply do "no reaction"; stage 1 must include at least 8 hazardous reactions.
- UI interaction: pouring is continuous (hold to pour, flow rate adjustable) or fixed-quantity buttons (e.g. 10 mL, 1 g). Simulation time runs in real time with a speed control (1x, 10x, 100x); temperature and pH graphs sample each tick.

## Data sourcing (Claude's call)
Builder may fetch reference values from the web (NIST Chemistry WebBook, PubChem, CRC-style tables) and must record the source per species/reaction in the data files. Required extra test: Hess's-law consistency (reaction dH computed from species formation enthalpies must match the stored reaction dH within 1 kJ/mol). The manager spot-checks at least 15 values against an independent source.

## Targets (Claude's call)
Modern Chrome and Safari at laptop width (1280x720 and up). Notebook persists in localStorage across reloads; export as JSON and CSV.

## Acceptance gates (what the manager checks)
Engine: `npm test` passes. Tests must include: every reaction in data is atom- and charge-balanced (automatic check); mass conserved in every simulated mix; formation of liquid water dH ~ -285.8 kJ/mol; H2 + O2 without ignition does not react, with ignition forms H2O with correct 2:1 stoichiometry and limiting reagent; NaOH + HCl neutralization gives pH ~7 at equivalence; unknown/unreactive mixes return "no reaction", not an error.
UI: app builds with `npm run build`; manager opens it in a browser and performs scripted scenarios (make water; neutralize acid; heat a mixture; try a dangerous mix); no console errors; looks professional at laptop size.
Final: README with run instructions, engine documented, all tests green.

## Left to the builder
Module structure, rendering approach, exact visual style, chemical and reaction selection beyond the minimums, test layout.
