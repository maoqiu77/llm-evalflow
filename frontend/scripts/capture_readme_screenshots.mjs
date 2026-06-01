import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const tabs = [
  { key: 'dashboard', label: '总览', file: 'dashboard.png', clip: { x: 0, y: 0, width: 1120, height: 760 } },
  { key: 'compare', label: '模型对比', file: 'compare.png', clip: { x: 0, y: 0, width: 1120, height: 900 } },
  { key: 'badcase', label: 'Badcase', file: 'badcase.png', clip: { x: 0, y: 0, width: 1120, height: 860 } },
  { key: 'report', label: '报告', file: 'report.png', clip: { x: 0, y: 0, width: 1120, height: 760 } },
];

function getArg(name, fallback) {
  const match = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : fallback;
}

async function waitForApp(page) {
  await page.goto(getArg('--base-url', 'http://127.0.0.1:5173'), { waitUntil: 'networkidle' });
  await page.locator('.shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200);
}

async function prepareTab(page, tab) {
  const button = page.getByRole('button', { name: new RegExp(tab.label) }).first();
  await button.click();
  await page.waitForTimeout(1200);
}

async function captureTab(page, tab, outputDir) {
  await prepareTab(page, tab);
  const target = page.locator('.main');
  await target.screenshot({
    path: path.join(outputDir, tab.file),
    animations: 'disabled',
    clip: tab.clip,
  });
}

async function main() {
  const outputDir = getArg('--output-dir', path.resolve(process.cwd(), '../docs/screenshots'));
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });

  try {
    await waitForApp(page);
    for (const tab of tabs) {
      await captureTab(page, tab, outputDir);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
