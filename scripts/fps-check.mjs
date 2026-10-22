#!/usr/bin/env node
import { spawn } from 'node:child_process';
import http from 'node:http';

const DEFAULT_URL = process.env.CHEM_LAB_URL || 'http://localhost:5173/';
const MIN_REQUIRED_FPS = 45;

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return await import(
      '/Users/nersibayat/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs'
    );
  }
}

function checkServerAlive(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', (err) => {
      if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
        reject(err);
      } else {
        resolve(false);
      }
    });
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureDevServer(url) {
  if (await checkServerAlive(url)) {
    return { proc: null, url };
  }

  const proc = spawn('npx', ['vite', '--port', '5173'], {
    stdio: 'ignore',
    detached: false,
  });

  for (let i = 0; i < 40; i++) {
    if (await checkServerAlive(url)) {
      return { proc, url };
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  proc.kill('SIGTERM');
  throw new Error(`Timed out waiting for Vite dev server at ${url}`);
}

async function launchBrowser(chromium) {
  const args = ['--use-gl=angle', '--use-angle=swiftshader'];
  try {
    return await chromium.launch({ headless: true, args });
  } catch {
    return await chromium.launch({
      headless: true,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args,
    });
  }
}

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
    // Let initial first paint settle
    await page.waitForTimeout(500);

    // 1. Measure idle rAF FPS over 3 seconds
    const idleResult = await measureRafFps(page, 3000);

    // 2. Run make-water scenario (2H2 + O2 -> 2H2O) + ignite (Spark)
    await page.click('[data-preset="make_water"]');
    await page.click('#btn-global-ignite');

    // 3. Measure post-ignition rAF FPS over 3 seconds
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
      passed:
        idleResult.fps >= MIN_REQUIRED_FPS &&
        afterIgniteResult.fps >= MIN_REQUIRED_FPS &&
        synthesizedWater &&
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
  console.error('FPS check failed:', err);
  process.exit(1);
});
