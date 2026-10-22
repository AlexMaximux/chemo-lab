#!/usr/bin/env node
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const DEFAULT_URL = process.env.CHEM_LAB_URL || 'http://localhost:5173/';
export const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
];

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return await import(
      '/Users/nersibayat/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs'
    );
  }
}

export function checkServerAlive(url) {
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

export async function ensureDevServer(url = DEFAULT_URL) {
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

export async function launchBrowser(chromium) {
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

export async function measureLayoutAtViewport(page, viewport) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(150);

  return await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const docScrollHeight = document.documentElement.scrollHeight;
    const bodyScrollHeight = document.body.scrollHeight;
    const docScrollWidth = document.documentElement.scrollWidth;

    const toolbar = document.querySelector('.lab-toolbar');
    const toolbarRect = toolbar.getBoundingClientRect();

    const equipPane = document.querySelector('.toolbar-equipment-pane');
    const equipPaneRect = equipPane.getBoundingClientRect();

    const equipStrip = document.querySelector('#equipment-strip');
    const equipStripRect = equipStrip.getBoundingClientRect();

    const chemPane = document.querySelector('.toolbar-chemicals-pane');
    const chemPaneRect = chemPane.getBoundingClientRect();

    const chemGrid = document.querySelector('#chem-drawer-grid');
    const chemGridRect = chemGrid.getBoundingClientRect();

    const equipCards = Array.from(document.querySelectorAll('.equip-card')).map((card) => {
      const r = card.getBoundingClientRect();
      const icon = card.querySelector('.equip-icon');
      const svg = card.querySelector('.equip-icon svg');
      const nameEl = card.querySelector('.equip-name');
      const ir = icon ? icon.getBoundingClientRect() : null;
      const sr = svg ? svg.getBoundingClientRect() : null;
      const nr = nameEl ? nameEl.getBoundingClientRect() : null;

      const iconInViewport =
        !!ir &&
        ir.width > 0 &&
        ir.height > 0 &&
        ir.top >= 0 &&
        ir.left >= 0 &&
        ir.bottom <= vh &&
        ir.right <= vw;

      const iconInsideCard =
        !!ir &&
        ir.top >= r.top - 0.5 &&
        ir.left >= r.left - 0.5 &&
        ir.bottom <= r.bottom + 0.5 &&
        ir.right <= r.right + 0.5;

      const nameInViewport =
        !!nr &&
        nr.width > 0 &&
        nr.height > 0 &&
        nr.top >= 0 &&
        nr.left >= 0 &&
        nr.bottom <= vh &&
        nr.right <= vw;

      const nameInsideCard =
        !!nr &&
        nr.top >= r.top - 0.5 &&
        nr.left >= r.left - 0.5 &&
        nr.bottom <= r.bottom + 0.5 &&
        nr.right <= r.right + 0.5;

      return {
        type: card.getAttribute('data-equip-type'),
        label: nameEl ? nameEl.textContent.trim() : '',
        cardWidth: Number(r.width.toFixed(1)),
        cardHeight: Number(r.height.toFixed(1)),
        cardTop: Number(r.top.toFixed(1)),
        cardBottom: Number(r.bottom.toFixed(1)),
        iconWidth: ir ? Number(ir.width.toFixed(1)) : 0,
        iconHeight: ir ? Number(ir.height.toFixed(1)) : 0,
        svgWidth: sr ? Number(sr.width.toFixed(1)) : 0,
        svgHeight: sr ? Number(sr.height.toFixed(1)) : 0,
        iconBox: ir
          ? {
              top: Number(ir.top.toFixed(1)),
              bottom: Number(ir.bottom.toFixed(1)),
              left: Number(ir.left.toFixed(1)),
              right: Number(ir.right.toFixed(1)),
            }
          : null,
        nameBox: nr
          ? {
              top: Number(nr.top.toFixed(1)),
              bottom: Number(nr.bottom.toFixed(1)),
              left: Number(nr.left.toFixed(1)),
              right: Number(nr.right.toFixed(1)),
            }
          : null,
        iconInViewport,
        iconInsideCard,
        nameInViewport,
        nameInsideCard,
      };
    });

    // Check every element in .lab-toolbar for horizontal clipping
    const toolbarEls = Array.from(toolbar.querySelectorAll('*'));
    const horizontallyClipped = [];
    for (const el of toolbarEls) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;

      // Ignore offscreen vertically scrolled cards inside #chem-drawer-grid
      const insideChemGrid = chemGrid.contains(el) && el !== chemGrid;
      const outOfToolbarBounds =
        r.left < toolbarRect.left - 1 ||
        r.right > toolbarRect.right + 1 ||
        r.left < -1 ||
        r.right > vw + 1;

      const overflowScrollClipped =
        el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;

      if (outOfToolbarBounds || overflowScrollClipped) {
        horizontallyClipped.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: typeof el.className === 'string' ? el.className : undefined,
          text: (el.textContent || '').trim().slice(0, 30),
          insideChemGrid,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          left: Number(r.left.toFixed(1)),
          right: Number(r.right.toFixed(1)),
        });
      }
    }

    const maxEquipCardHeight = Math.max(...equipCards.map((c) => c.cardHeight));
    const minEquipCardHeight = Math.min(...equipCards.map((c) => c.cardHeight));
    const allCardsUnder100px = equipCards.length === 10 && equipCards.every((c) => c.cardHeight < 100 && c.cardHeight >= 60);
    const allIconsInViewport = equipCards.length === 10 && equipCards.every((c) => c.iconInViewport && c.iconInsideCard);
    const allNamesInViewport = equipCards.length === 10 && equipCards.every((c) => c.nameInViewport && c.nameInsideCard);
    const noPageScroll = docScrollHeight === vh && bodyScrollHeight === vh && docScrollWidth === vw;
    const chemDrawerScrollsInternally =
      chemGrid.clientHeight > 0 &&
      chemGrid.scrollHeight > chemGrid.clientHeight &&
      chemGridRect.bottom <= toolbarRect.bottom + 0.5;
    const noHorizontalClip = horizontallyClipped.length === 0;

    return {
      viewport: `${vw}x${vh}`,
      viewportWidth: vw,
      viewportHeight: vh,
      docScrollHeight,
      bodyScrollHeight,
      docScrollWidth,
      toolbarHeight: Number(toolbarRect.height.toFixed(1)),
      equipPaneHeight: Number(equipPaneRect.height.toFixed(1)),
      equipStripHeight: Number(equipStripRect.height.toFixed(1)),
      chemPaneHeight: Number(chemPaneRect.height.toFixed(1)),
      chemGridClientHeight: chemGrid.clientHeight,
      chemGridScrollHeight: chemGrid.scrollHeight,
      equipCardCount: equipCards.length,
      minEquipCardHeight,
      maxEquipCardHeight,
      allCardsUnder100px,
      allIconsInViewport,
      allNamesInViewport,
      noPageScroll,
      chemDrawerScrollsInternally,
      noHorizontalClip,
      horizontallyClippedCount: horizontallyClipped.length,
      horizontallyClipped,
      equipCards,
      passed:
        allCardsUnder100px &&
        allIconsInViewport &&
        allNamesInViewport &&
        noPageScroll &&
        chemDrawerScrollsInternally &&
        noHorizontalClip,
    };
  });
}

export async function runLayoutSuite(page, viewports = VIEWPORTS) {
  const results = {};
  for (const vp of viewports) {
    const res = await measureLayoutAtViewport(page, vp);
    results[res.viewport] = res;
  }
  return results;
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
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#bench-canvas', { state: 'visible' });

    const layoutByViewport = await runLayoutSuite(page, VIEWPORTS);
    const allPassed = Object.values(layoutByViewport).every((r) => r.passed);

    // Print concise summary + detailed card metrics
    const summary = {};
    for (const [vpKey, data] of Object.entries(layoutByViewport)) {
      const { equipCards, ...rest } = data;
      summary[vpKey] = {
        ...rest,
        sampleCardBounds: equipCards.map((c) => ({
          type: c.type,
          label: c.label,
          size: `${c.cardWidth}x${c.cardHeight}`,
          iconBox: c.iconBox,
          iconInViewport: c.iconInViewport,
        })),
      };
    }

    console.log(JSON.stringify({ passed: allPassed, viewports: summary }, null, 2));

    if (!allPassed) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    if (proc) {
      proc.kill('SIGTERM');
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Layout check failed:', err);
    process.exit(1);
  });
}
