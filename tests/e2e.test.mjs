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
    return {
      present: true,
      shown: getComputedStyle(host).display !== 'none',
      text: root.querySelector('.text').textContent,
      bar: visible('.bar'),
      menu: visible('.menu'),
      editor: visible('.editor'),
      pill: visible('.pill'),
      top: Math.round(rect.top),
      rightGap: Math.round(window.innerWidth - rect.right),
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

const showsTask = (title) => (s) => s.shown && s.bar && !s.pill && s.text === `正在做：${title}`;
const showsPill = (s) => s.shown && s.pill && !s.bar;
const hidden = (s) => !s.shown;

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
  assert.equal(await popup.$eval('#submit', (el) => el.textContent), '开始');
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

test('start in popup, then sync, edit, collapse, persist and complete across tabs', async (t) => {
  const pageA = await openPage('a');
  const pageB = await openPage('b');

  await t.test('start from popup shows the bar in every open tab', async () => {
    const popup = await openPopup();
    await popup.type('#title', '  写周报  ');
    await popup.keyboard.press('Enter');
    await popup.waitForFunction(() => document.getElementById('current-title').textContent === '写周报');
    assert.equal(await popup.$eval('#submit', (el) => el.textContent), '修改');
    assert.equal(await popup.evaluate(() => chrome.action.getBadgeText({})), '•');
    await popup.close();

    await waitForOverlay(pageA, showsTask('写周报'), 'tab A after start');
    await waitForOverlay(pageB, showsTask('写周报'), 'tab B after start');
  });

  await t.test('a newly opened tab shows the current task', async () => {
    const pageC = await openPage('c');
    await waitForOverlay(pageC, showsTask('写周报'), 'new tab C');
    await pageC.close();
  });

  await t.test('bar stays pinned to the top-right while scrolling', async () => {
    await pageA.bringToFront();
    await pageA.evaluate(() => window.scrollTo(0, 3000));
    const s = await waitForOverlay(pageA, showsTask('写周报'), 'after scroll');
    assert.equal(await pageA.evaluate(() => Math.round(window.scrollY)), 3000);
    assert.equal(s.top, 12);
    assert.equal(s.rightGap, 12);
  });

  await t.test('edit from the page bar updates the other tab', async () => {
    await pageA.bringToFront();
    await pageA.click(pierce('.bar'));
    await waitForOverlay(pageA, (s) => s.menu, 'menu open');
    await pageA.click(pierce('[data-action="edit"]'));
    await waitForOverlay(pageA, (s) => s.editor && !s.bar, 'editor open');

    const keydownsBefore = await pageA.evaluate(() => window.pageKeydowns);
    // The editor opens with the old title selected, so typing replaces it.
    await pageA.keyboard.type('整理会议纪要');
    await pageA.keyboard.press('Enter');
    assert.equal(await pageA.evaluate(() => window.pageKeydowns), keydownsBefore,
      'typing in the editor must not reach page keyboard handlers');

    await waitForOverlay(pageA, showsTask('整理会议纪要'), 'tab A after edit');
    await waitForOverlay(pageB, showsTask('整理会议纪要'), 'tab B after edit');

    const popup = await openPopup();
    assert.equal(await popup.$eval('#current-title', (el) => el.textContent), '整理会议纪要');
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
    await waitForOverlay(pageA, (s) => !s.menu && showsTask('整理会议纪要')(s), 'menu closed by outside click');
  });

  await t.test('collapse in one tab collapses everywhere; expand from the marker', async () => {
    await pageB.bringToFront();
    await pageB.click(pierce('.bar'));
    await pageB.click(pierce('[data-action="collapse"]'));
    await waitForOverlay(pageB, showsPill, 'tab B collapsed');
    await waitForOverlay(pageA, showsPill, 'tab A collapsed');

    const popup = await openPopup();
    assert.equal(await popup.$eval('#expand', (el) => el.hidden), false);
    await popup.close();

    await pageA.bringToFront();
    await pageA.click(pierce('.pill'));
    await waitForOverlay(pageA, showsTask('整理会议纪要'), 'tab A expanded');
    await waitForOverlay(pageB, showsTask('整理会议纪要'), 'tab B expanded');
  });

  await t.test('reloading a page keeps the task', async () => {
    await pageA.reload();
    await pageA.waitForSelector(HOST);
    await waitForOverlay(pageA, showsTask('整理会议纪要'), 'tab A after reload');
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
    await popup.type('#title', '临时任务');
    await popup.click('#submit');
    await waitForOverlay(pageA, showsTask('临时任务'), 'tab A after second start');
    await popup.click('#complete');
    await waitForOverlay(pageA, hidden, 'tab A after popup complete');
    await waitForOverlay(pageB, hidden, 'tab B after popup complete');
    await popup.close();
  });

  await pageA.close();
  await pageB.close();
});

test('the task survives a browser restart', async () => {
  const popup = await openPopup();
  await popup.type('#title', '复习算法');
  await popup.click('#submit');
  await popup.waitForFunction(() => document.getElementById('current-title').textContent === '复习算法');
  await popup.close();

  await browser.close();
  await launch();

  const page = await openPage('after-restart');
  await waitForOverlay(page, showsTask('复习算法'), 'page after restart');
  const popupAgain = await openPopup();
  assert.equal(await popupAgain.$eval('#current-title', (el) => el.textContent), '复习算法');
  await popupAgain.close();
  await page.close();
});
