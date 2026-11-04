// End-to-end tests: load the unpacked extension into Chrome for Testing and drive it like a user.
// Run with `npm test` (first time: `npx puppeteer browsers install chrome`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';

const EXTENSION_PATH = path.resolve(import.meta.dirname, '../extension');
const HOST = '#task-reminder-ext-root';
const pierce = (selector) => `${HOST} >>> ${selector}`;

let server;
let baseUrl;
let userDataDir;
let browser;
let extensionId;

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>page</title></head>
<body style="margin:0"><div style="height:5000px;background:linear-gradient(#fff,#ccc)">content</div>
<script>window.pageKeydowns = 0; document.addEventListener('keydown', () => window.pageKeydowns++);</script>
</body></html>`;

async function launch() {
  browser = await puppeteer.launch({
    headless: true,
    userDataDir,
    pipe: true,
    enableExtensions: [EXTENSION_PATH],
    args: ['--enable-unsafe-extension-debugging'], // lets tests reload the extension
    defaultViewport: { width: 1000, height: 700 },
  });
  const worker = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().endsWith('/service-worker.js'),
    { timeout: 10000 },
  );
  extensionId = new URL(worker.url()).host;
}

async function openPage(name) {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/${name}`);
  await page.waitForSelector(HOST, { timeout: 5000 });
  return page;
}

async function openPopup() {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForFunction(() => document.getElementById('submit').textContent.length > 0);
  return page;
}

function overlayState(page) {
  return page.evaluate((hostSelector) => {
    const host = document.querySelector(hostSelector);
    if (!host) return { present: false, shown: false };
    const root = host.shadowRoot;
    const visible = (sel) => {
      const el = root.querySelector(sel);
      return !!el && !el.hidden && el.getBoundingClientRect().width > 0;
    };
    const rect = host.getBoundingClientRect();
    const viewport = document.documentElement;
    return {
      present: true,
      shown: getComputedStyle(host).display !== 'none',
      text: root.querySelector('.text').textContent,
      bar: visible('.bar'),
      menu: visible('.menu'),
      editor: visible('.editor'),
      pill: visible('.pill'),
      resetItem: visible('[data-action="reset-position"]'),
      top: Math.round(rect.top),
      rightGap: Math.round(viewport.clientWidth - rect.right),
      bottomGap: Math.round(viewport.clientHeight - rect.bottom),
      left: Math.round(rect.left),
    };
  }, HOST);
}

async function waitForOverlay(page, predicate, label) {
  const deadline = Date.now() + 5000;
  let last;
  while (Date.now() < deadline) {
    last = await overlayState(page);
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`${label}: overlay never matched, last state ${JSON.stringify(last)}`);
}

async function drag(page, selector, dx, dy) {
  const box = await (await page.$(pierce(selector))).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

const showsTask = (title) => (s) => s.shown && s.bar && !s.pill && s.text === `Working on: ${title}`;
const showsPill = (s) => s.shown && s.pill && !s.bar;
const hidden = (s) => !s.shown;
const at = (top, rightGap) => (s) => s.shown && s.top === top && s.rightGap === rightGap;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE_HTML);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-reminder-profile-'));
  await launch();
});

after(async () => {
  await browser?.close();
  server?.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

test('no task: no bar on pages, popup shows empty state', async () => {
  const page = await openPage('a');
  await waitForOverlay(page, hidden, 'empty page');
  const popup = await openPopup();
  assert.equal(await popup.$eval('#empty', (el) => el.hidden), false);
  assert.equal(await popup.$eval('#submit', (el) => el.textContent), 'Start');
  await page.close();
  await popup.close();
});

test('popup rejects an empty task name', async () => {
  const popup = await openPopup();
  await popup.type('#title', '   ');
  await popup.click('#submit');
  assert.equal(await popup.$eval('#error', (el) => el.hidden), false);
  const stored = await popup.evaluate(() => chrome.storage.local.get('task'));
  assert.equal(stored.task ?? null, null);
  await popup.close();
});

test('start in popup, then sync, edit, collapse, drag, persist and complete across tabs', async (t) => {
  const pageA = await openPage('a');
  const pageB = await openPage('b');

  await t.test('start from popup shows the bar in every open tab', async () => {
    const popup = await openPopup();
    await popup.type('#title', '  Write the weekly report  ');
    await popup.keyboard.press('Enter');
    await popup.waitForFunction(() => document.getElementById('current-title').textContent === 'Write the weekly report');
    assert.equal(await popup.$eval('#submit', (el) => el.textContent), 'Update');
    assert.equal(await popup.evaluate(() => chrome.action.getBadgeText({})), '•');
    await popup.close();

    await waitForOverlay(pageA, showsTask('Write the weekly report'), 'tab A after start');
    await waitForOverlay(pageB, showsTask('Write the weekly report'), 'tab B after start');
  });

  await t.test('a newly opened tab shows the current task', async () => {
    const pageC = await openPage('c');
    await waitForOverlay(pageC, showsTask('Write the weekly report'), 'new tab C');
    await pageC.close();
  });

  await t.test('bar stays pinned to the top-right while scrolling', async () => {
    await pageA.bringToFront();
    await pageA.evaluate(() => window.scrollTo(0, 3000));
    const s = await waitForOverlay(pageA, showsTask('Write the weekly report'), 'after scroll');
    assert.equal(await pageA.evaluate(() => Math.round(window.scrollY)), 3000);
    assert.equal(s.top, 12);
    assert.equal(s.rightGap, 12);
    assert.equal(s.resetItem, false);
  });

  await t.test('edit from the page bar updates the other tab', async () => {
    await pageA.bringToFront();
    await pageA.click(pierce('.bar'));
    await waitForOverlay(pageA, (s) => s.menu, 'menu open');
    await pageA.click(pierce('[data-action="edit"]'));
    await waitForOverlay(pageA, (s) => s.editor && !s.bar, 'editor open');

    const keydownsBefore = await pageA.evaluate(() => window.pageKeydowns);
    // The editor opens with the old title selected, so typing replaces it.
    await pageA.keyboard.type('Clean up meeting notes');
    await pageA.keyboard.press('Enter');
    assert.equal(await pageA.evaluate(() => window.pageKeydowns), keydownsBefore,
      'typing in the editor must not reach page keyboard handlers');

    await waitForOverlay(pageA, showsTask('Clean up meeting notes'), 'tab A after edit');
    await waitForOverlay(pageB, showsTask('Clean up meeting notes'), 'tab B after edit');

    const popup = await openPopup();
    assert.equal(await popup.$eval('#current-title', (el) => el.textContent), 'Clean up meeting notes');
    await popup.close();
  });

  await t.test('Escape and outside clicks close the menu without changing the task', async () => {
    await pageA.bringToFront();
    await pageA.click(pierce('.bar'));
    await waitForOverlay(pageA, (s) => s.menu, 'menu open');
    await pageA.keyboard.press('Escape');
    await waitForOverlay(pageA, (s) => !s.menu && s.bar, 'menu closed by Escape');

    await pageA.click(pierce('.bar'));
    await waitForOverlay(pageA, (s) => s.menu, 'menu reopened');
    await pageA.mouse.click(200, 300);
    await waitForOverlay(pageA, (s) => !s.menu && showsTask('Clean up meeting notes')(s), 'menu closed by outside click');
  });

  await t.test('dragging moves the bar, does not open the menu, and syncs to other tabs', async () => {
    await pageA.bringToFront();
    await drag(pageA, '.bar', -300, 200);
    const moved = await waitForOverlay(pageA, at(212, 312), 'tab A after drag');
    assert.equal(moved.menu, false, 'a drag must not count as a click');

    const popup = await openPopup();
    assert.deepEqual(
      (await popup.evaluate(() => chrome.storage.local.get('position'))).position,
      { top: 212, right: 312 },
    );
    await popup.close();

    await waitForOverlay(pageB, at(212, 312), 'tab B follows the drag');
  });

  await t.test('a plain click still opens the menu after a drag, and offers Reset position', async () => {
    await pageA.bringToFront();
    await pageA.click(pierce('.bar'));
    await waitForOverlay(pageA, (s) => s.menu && s.resetItem, 'menu with reset item');
    await pageA.keyboard.press('Escape');
  });

  await t.test('the bar cannot be dragged out of the viewport', async () => {
    await pageA.bringToFront();
    await drag(pageA, '.bar', 5000, 5000);
    const s = await waitForOverlay(pageA, (o) => o.rightGap === 0 && o.bottomGap === 0, 'dragged to bottom-right');
    assert.ok(s.top > 0);

    await drag(pageA, '.bar', -5000, -5000);
    await waitForOverlay(pageA, (o) => o.top === 0 && o.left === 0, 'dragged to top-left');

    // The menu opens downward; near the bottom the whole bar shifts up so the menu stays visible.
    await drag(pageA, '.bar', 0, 5000);
    await pageA.click(pierce('.bar'));
    await waitForOverlay(pageA, (o) => o.menu && o.bottomGap === 0, 'menu fits at the bottom');
    await pageA.keyboard.press('Escape');
  });

  await t.test('collapse in one tab collapses everywhere; the marker keeps the position and expands', async () => {
    await pageA.bringToFront();
    await drag(pageA, '.bar', 0, -5000);
    await waitForOverlay(pageA, (o) => o.top === 0 && o.left === 0, 'back to top-left');

    await pageB.bringToFront();
    await waitForOverlay(pageB, (o) => o.top === 0 && o.left === 0, 'tab B at top-left');
    await pageB.click(pierce('.bar'));
    await pageB.click(pierce('[data-action="collapse"]'));
    await waitForOverlay(pageB, (o) => showsPill(o) && o.top === 0, 'tab B collapsed');
    await waitForOverlay(pageA, showsPill, 'tab A collapsed');

    const popup = await openPopup();
    assert.equal(await popup.$eval('#expand', (el) => el.hidden), false);
    await popup.close();

    await pageA.bringToFront();
    await pageA.click(pierce('.pill'));
    await waitForOverlay(pageA, showsTask('Clean up meeting notes'), 'tab A expanded');
    await waitForOverlay(pageB, showsTask('Clean up meeting notes'), 'tab B expanded');
  });

  await t.test('reloading a page keeps the task and the position', async () => {
    await pageA.reload();
    await pageA.waitForSelector(HOST);
    await waitForOverlay(pageA, (o) => showsTask('Clean up meeting notes')(o) && o.top === 0 && o.left === 0,
      'tab A after reload');
  });

  await t.test('Reset position puts the bar back in the top-right corner everywhere', async () => {
    await pageA.bringToFront();
    await pageA.click(pierce('.bar'));
    await pageA.click(pierce('[data-action="reset-position"]'));
    await waitForOverlay(pageA, at(12, 12), 'tab A after reset');
    await waitForOverlay(pageB, at(12, 12), 'tab B after reset');
    await pageA.click(pierce('.bar'));
    await waitForOverlay(pageA, (o) => o.menu && !o.resetItem, 'reset item hidden at default position');
    await pageA.keyboard.press('Escape');
  });

  await t.test('complete from the page bar hides it in every tab', async () => {
    await pageB.bringToFront();
    await pageB.click(pierce('.bar'));
    await pageB.click(pierce('[data-action="complete"]'));
    await waitForOverlay(pageB, hidden, 'tab B after complete');
    await waitForOverlay(pageA, hidden, 'tab A after complete');

    const popup = await openPopup();
    assert.equal(await popup.$eval('#empty', (el) => el.hidden), false);
    assert.equal(await popup.evaluate(() => chrome.action.getBadgeText({})), '');
    await popup.close();
  });

  await t.test('completing from the popup also hides the bar', async () => {
    const popup = await openPopup();
    await popup.type('#title', 'Quick errand');
    await popup.click('#submit');
    await waitForOverlay(pageA, showsTask('Quick errand'), 'tab A after second start');
    await popup.click('#complete');
    await waitForOverlay(pageA, hidden, 'tab A after popup complete');
    await waitForOverlay(pageB, hidden, 'tab B after popup complete');
    await popup.close();
  });

  await pageA.close();
  await pageB.close();
});

test('the task and bar position survive a browser restart', async () => {
  const page = await openPage('before-restart');
  const popup = await openPopup();
  await popup.type('#title', 'Review algorithms');
  await popup.click('#submit');
  await popup.waitForFunction(() => document.getElementById('current-title').textContent === 'Review algorithms');
  await popup.close();

  await page.bringToFront();
  await waitForOverlay(page, showsTask('Review algorithms'), 'before restart');
  await drag(page, '.bar', -100, 50);
  await waitForOverlay(page, at(62, 112), 'moved before restart');

  await browser.close();
  await launch();

  const after = await openPage('after-restart');
  await waitForOverlay(after, (o) => showsTask('Review algorithms')(o) && o.top === 62 && o.rightGap === 112,
    'page after restart');
  const popupAgain = await openPopup();
  assert.equal(await popupAgain.$eval('#current-title', (el) => el.textContent), 'Review algorithms');
  await popupAgain.close();
  await after.close();
});

test('reloading the extension leaves exactly one bar in already-open tabs', async () => {
  const visibleHosts = (page) => page.evaluate(() =>
    [...document.querySelectorAll('[id^="task-reminder-ext-root"]')]
      .filter((h) => getComputedStyle(h).display !== 'none').length);

  const page = await openPage('before-extension-reload');
  const popup = await openPopup();
  await popup.evaluate(() => chrome.storage.local.set({ position: null, collapsed: true }));
  await popup.close();
  await waitForOverlay(page, (o) => showsPill(o) && o.top === 12, 'collapsed before reload');

  // Reinstalling an unpacked extension from the same folder is what the reload button does.
  await browser.installExtension(EXTENSION_PATH);
  await new Promise((r) => setTimeout(r, 1500));

  const popupAfter = await openPopup();
  await popupAfter.evaluate(() => chrome.storage.local.set({ position: { top: 200, right: 300 }, collapsed: false }));
  await popupAfter.close();

  await page.bringToFront();
  await waitForOverlay(page, (o) => showsTask('Review algorithms')(o) && o.top === 200 && o.rightGap === 300,
    'new bar follows the new position');
  assert.equal(await visibleHosts(page), 1, 'the previous version left a visible copy behind');

  await drag(page, '.bar', -50, 50);
  await waitForOverlay(page, at(250, 350), 'dragged after reload');
  assert.equal(await visibleHosts(page), 1);
  await page.close();
});
