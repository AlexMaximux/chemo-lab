#!/usr/bin/env node
import {
  VIEWPORTS,
  ensureDevServer,
  launchBrowser,
  loadPlaywright,
  runLayoutSuite,
} from './layout-check.mjs';

const DEFAULT_URL = process.env.CHEM_LAB_URL || 'http://localhost:5173/';
const MIN_REQUIRED_FPS = 45;

async function measureRafFps(page, durationMs = 3000) {
  return await page.evaluate((ms) => {
    return new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      function step(now) {
        frames++;
        if (now - start < ms) {
          requestAnimationFrame(step);
        } else {
          const elapsedSec = (now - start) / 1000;
          resolve({
            frames,
            elapsedSec: Number(elapsedSec.toFixed(3)),
            fps: Number((frames / elapsedSec).toFixed(1)),
            frameTimeMs: Number(((now - start) / frames).toFixed(2)),
          });
        }
      }
      requestAnimationFrame(step);
    });
  }, durationMs);
}

async function main() {
  const { proc, url } = await ensureDevServer(DEFAULT_URL);
  const { chromium } = await loadPlaywright();
  const browser = await launchBrowser(chromium);

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#bench-canvas', { state: 'visible' });

    // 1. Verify layout invariants across 1280x720, 1366x768, and 1440x900
    const rawLayout = await runLayoutSuite(page, VIEWPORTS);
    const layoutSummary = {};
    for (const [vpKey, data] of Object.entries(rawLayout)) {
      layoutSummary[vpKey] = {
        toolbarHeight: data.toolbarHeight,
        equipStripHeight: data.equipStripHeight,
        equipCardCount: data.equipCardCount,
        minEquipCardHeight: data.minEquipCardHeight,
        maxEquipCardHeight: data.maxEquipCardHeight,
        allCardsUnder100px: data.allCardsUnder100px,
        allIconsInViewport: data.allIconsInViewport,
        allNamesInViewport: data.allNamesInViewport,
        docScrollHeight: data.docScrollHeight,
        viewportHeight: data.viewportHeight,
        noPageScroll: data.noPageScroll,
        chemGridClientHeight: data.chemGridClientHeight,
        chemGridScrollHeight: data.chemGridScrollHeight,
        chemDrawerScrollsInternally: data.chemDrawerScrollsInternally,
        noHorizontalClip: data.noHorizontalClip,
        horizontallyClippedCount: data.horizontallyClippedCount,
        passed: data.passed,
      };
    }
    const allLayoutsPassed = Object.values(rawLayout).every((r) => r.passed);

    // Return to 1280x720 for FPS benchmark
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(300);

    // 2. Measure idle rAF FPS over 3 seconds
    const idleResult = await measureRafFps(page, 3000);

    // 3. Run make-water scenario (2H2 + O2 -> 2H2O) + ignite (Spark)
    await page.click('[data-preset="make_water"]');
    await page.click('#btn-global-ignite');

    // 4. Measure post-ignition rAF FPS over 3 seconds
    const afterIgniteResult = await measureRafFps(page, 3000);

    // Verify water was synthesized in inspector
    const inspectorText = await page.locator('#vessel-inspector-card').innerText();
    const synthesizedWater =
      inspectorText.includes('H₂O') && inspectorText.includes('0.0200');

    const report = {
      viewport: '1280x720',
      idle: idleResult,
      afterIgnition: afterIgniteResult,
      minRequiredFps: MIN_REQUIRED_FPS,
      synthesizedWater,
      consoleErrors: consoleErrors.length,
      layoutChecks: layoutSummary,
      allLayoutsPassed,
      passed:
        idleResult.fps >= MIN_REQUIRED_FPS &&
        afterIgniteResult.fps >= MIN_REQUIRED_FPS &&
        synthesizedWater &&
        allLayoutsPassed &&
        consoleErrors.length === 0,
    };

    console.log(JSON.stringify(report, null, 2));

    if (!report.passed) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    if (proc) {
      proc.kill('SIGTERM');
    }
  }
}

main().catch((err) => {
  console.error('FPS & layout check failed:', err);
  process.exit(1);
});
