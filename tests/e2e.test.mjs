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
const row = (n) => pierce(`.row:nth-child(${n})`);

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
  await page.waitForFunction(() => document.readyState === 'complete');
  await new Promise((r) => setTimeout(r, 100));
  return page;
}

// Reads or writes extension storage from an extension page.
async function withExtensionPage(fn, arg) {
  const page = await openPopup();
  try {
    return await page.evaluate(fn, arg);
  } finally {
    await page.close();
  }
}

const storedTitles = () => withExtensionPage(async () => (await TaskStore.get()).tasks.map((t) => t.title));
const resetStorage = (values) => withExtensionPage((v) => chrome.storage.local.clear().then(() => chrome.storage.local.set(v)), values);

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
      count: visible('.count') ? root.querySelector('.count').textContent : '',
      bar: visible('.bar'),
      panel: visible('.panel'),
      editing: visible('.row-edit'),
      rows: [...root.querySelectorAll('.row')].map((r) =>
        `${r.querySelector('.marker').textContent} ${r.querySelector('.row-title')?.textContent ?? '(editing)'}`),
      pill: visible('.pill'),
      emptyMarker: visible('.pill.empty'),
      emptyNote: visible('.empty-note'),
      addFocused: root.activeElement === root.querySelector('.add input'),
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

async function openPanel(page) {
  await page.bringToFront();
  const s = await overlayState(page);
  if (!s.panel) await page.click(pierce('.bar'));
  await waitForOverlay(page, (o) => o.panel, 'panel open');
}

async function addFromWidget(page, title) {
  await page.click(pierce('.add input'));
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
}

const showsTask = (title, count = '') => (s) =>
  s.shown && s.bar && !s.pill && s.text === `Working on: ${title}` && s.count === count;
const showsPill = (s) => s.shown && s.pill && !s.emptyMarker && !s.bar;
const showsEmpty = (s) => s.shown && s.emptyMarker && !s.bar;
const at = (top, rightGap) => (s) => s.shown && s.top === top && s.rightGap === rightGap;
const listIs = (...rows) => (s) => s.panel && JSON.stringify(s.rows) === JSON.stringify(rows);

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

async function popupStatus(popup) {
  return popup.evaluate(() => ({
    caption: document.getElementById('caption').textContent,
    title: document.getElementById('current-title').textContent,
    queued: document.getElementById('queued').textContent,
    enabled: document.getElementById('enabled').checked,
    state: document.getElementById('toggle-state').textContent,
    empty: document.getElementById('status').classList.contains('empty'),
    off: document.getElementById('status').classList.contains('off'),
  }));
}

test('no tasks: pages show only the empty marker, popup is off-idle', async () => {
  const page = await openPage('a');
  await waitForOverlay(page, (s) => showsEmpty(s) && !s.panel && s.top === 12 && s.rightGap === 12, 'empty page');
  const popup = await openPopup();
  assert.deepEqual(await popupStatus(popup), {
    caption: 'No current task', title: '', queued: '', enabled: true, state: 'On', empty: true, off: false,
  });
  await page.close();
  await popup.close();
});

test('the empty marker opens the panel ready to add the first task', async () => {
  const page = await openPage('empty-marker');
  const other = await openPage('empty-marker-other');
  await page.bringToFront();
  await page.click(pierce('.pill'));
  const s = await waitForOverlay(page, (o) => o.panel && o.emptyNote && o.addFocused, 'empty panel');
  assert.deepEqual(s.rows, []);
  assert.equal(await page.$eval(pierce('[data-action="collapse"]'), (el) => el.hidden), true,
    'nothing to collapse without a task');

  await page.keyboard.type('First task from the marker');
  await page.keyboard.press('Enter');
  await waitForOverlay(page, (o) => showsTask('First task from the marker')(o) && o.panel && !o.emptyNote,
    'bar appears, panel stays open');
  await waitForOverlay(other, showsTask('First task from the marker'), 'other tab shows the new task');

  // Completing the last task returns to the empty state with the add box focused.
  await page.click(`${row(1)} [data-action="complete"]`);
  await waitForOverlay(page, (o) => showsEmpty(o) && o.panel && o.emptyNote && o.addFocused, 'back to empty');
  await waitForOverlay(other, showsEmpty, 'other tab back to empty');
  await page.keyboard.press('Escape');
  await waitForOverlay(page, (o) => showsEmpty(o) && !o.panel, 'panel closed');

  await drag(page, '.pill', -200, 100);
  await waitForOverlay(page, (o) => showsEmpty(o) && o.top === 112 && !o.panel, 'empty marker is draggable');
  await withExtensionPage(() => TaskStore.resetPosition());
  await page.close();
  await other.close();
});

test('turning the widget off in the popup hides it on every tab', async () => {
  const pageA = await openPage('toggle-a');
  const pageB = await openPage('toggle-b');
  await withExtensionPage(() => TaskStore.addTask('Keep this'));
  await waitForOverlay(pageA, showsTask('Keep this'), 'tab A before off');
  await waitForOverlay(pageB, showsTask('Keep this'), 'tab B before off');

  const popup = await openPopup();
  const before = await popupStatus(popup);
  assert.equal(before.title, 'Keep this');
  assert.equal(before.enabled, true);
  await popup.click('#enabled');
  await popup.waitForFunction(() => document.getElementById('toggle-state').textContent === 'Off');
  const after = await popupStatus(popup);
  assert.equal(after.enabled, false);
  assert.equal(after.off, true);
  assert.equal(after.title, 'Keep this', 'turning off must not clear the queue');
  await popup.close();

  const hidden = (s) => !s.shown;
  await waitForOverlay(pageA, hidden, 'tab A hidden');
  await waitForOverlay(pageB, hidden, 'tab B hidden');
  assert.deepEqual(await storedTitles(), ['Keep this']);

  const popupOn = await openPopup();
  await popupOn.click('#enabled');
  await popupOn.waitForFunction(() => document.getElementById('toggle-state').textContent === 'On');
  await popupOn.close();
  await waitForOverlay(pageA, showsTask('Keep this'), 'tab A restored');
  await waitForOverlay(pageB, showsTask('Keep this'), 'tab B restored');

  await resetStorage({});
  await waitForOverlay(pageA, showsEmpty, 'cleared');
  await pageA.close();
  await pageB.close();
});

test('task queue: add, edit, reorder, complete and remove, synced across tabs', async (t) => {
  const pageA = await openPage('a');
  const pageB = await openPage('b');

  await t.test('adding a task shows the bar in every open tab', async () => {
    await withExtensionPage(() => TaskStore.addTask('  Write the weekly report  '));
    const popup = await openPopup();
    assert.equal((await popupStatus(popup)).title, 'Write the weekly report');
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
  });

  await t.test('tasks added from the widget queue up behind the current one', async () => {
    await openPanel(pageA);
    await waitForOverlay(pageA, listIs('Now Write the weekly report'), 'initial list');

    const keydownsBefore = await pageA.evaluate(() => window.pageKeydowns);
    await addFromWidget(pageA, 'Review the pull request');
    await addFromWidget(pageA, 'Plan next sprint');
    assert.equal(await pageA.evaluate(() => window.pageKeydowns), keydownsBefore,
      'typing in the widget must not reach page keyboard handlers');

    await waitForOverlay(pageA,
      listIs('Now Write the weekly report', '2 Review the pull request', '3 Plan next sprint'), 'list after adding');
    await waitForOverlay(pageA, showsTask('Write the weekly report', '+2'), 'tab A count');
    await waitForOverlay(pageB, showsTask('Write the weekly report', '+2'), 'tab B count');
  });

  await t.test('editing a queued task updates storage and the other tab', async () => {
    await openPanel(pageA);
    await pageA.click(`${row(2)} [data-action="edit"]`);
    await waitForOverlay(pageA, (s) => s.editing, 'editing row 2');
    await pageA.keyboard.type('Review PR #42');
    await pageA.keyboard.press('Enter');
    await waitForOverlay(pageA,
      listIs('Now Write the weekly report', '2 Review PR #42', '3 Plan next sprint'), 'list after edit');
    assert.deepEqual(await storedTitles(), ['Write the weekly report', 'Review PR #42', 'Plan next sprint']);

    await openPanel(pageB);
    await waitForOverlay(pageB,
      listIs('Now Write the weekly report', '2 Review PR #42', '3 Plan next sprint'), 'tab B list after edit');
    await pageB.keyboard.press('Escape');
  });

  await t.test('Escape cancels an edit without saving, then closes the panel', async () => {
    await openPanel(pageA);
    await pageA.click(`${row(1)} [data-action="edit"]`);
    await waitForOverlay(pageA, (s) => s.editing, 'editing row 1');
    await pageA.keyboard.type('Something else');
    await pageA.keyboard.press('Escape');
    await waitForOverlay(pageA, (s) => s.panel && !s.editing && s.rows[0] === 'Now Write the weekly report',
      'edit cancelled');
    await pageA.keyboard.press('Escape');
    await waitForOverlay(pageA, (s) => !s.panel && s.bar, 'panel closed by Escape');

    await openPanel(pageA);
    await pageA.mouse.click(200, 400);
    await waitForOverlay(pageA, (s) => !s.panel, 'panel closed by outside click');
  });

  await t.test('moving a task to the top makes it the current task everywhere', async () => {
    await openPanel(pageA);
    assert.equal(await pageA.$eval(`${row(1)} [data-action="up"]`, (b) => b.disabled), true);
    assert.equal(await pageA.$eval(`${row(3)} [data-action="down"]`, (b) => b.disabled), true);

    await pageA.click(`${row(3)} [data-action="up"]`);
    await waitForOverlay(pageA,
      listIs('Now Write the weekly report', '2 Plan next sprint', '3 Review PR #42'), 'after one move up');
    await pageA.click(`${row(2)} [data-action="up"]`);
    await waitForOverlay(pageA,
      listIs('Now Plan next sprint', '2 Write the weekly report', '3 Review PR #42'), 'after second move up');
    await waitForOverlay(pageB, showsTask('Plan next sprint', '+2'), 'tab B follows the new order');

    await pageA.click(`${row(1)} [data-action="down"]`);
    await waitForOverlay(pageA,
      listIs('Now Write the weekly report', '2 Plan next sprint', '3 Review PR #42'), 'after move down');
  });

  await t.test('completing the current task moves on to the next one', async () => {
    await openPanel(pageA);
    await pageA.click(`${row(1)} [data-action="complete"]`);
    await waitForOverlay(pageA, listIs('Now Plan next sprint', '2 Review PR #42'), 'after complete');
    await waitForOverlay(pageA, showsTask('Plan next sprint', '+1'), 'tab A bar after complete');
    await waitForOverlay(pageB, showsTask('Plan next sprint', '+1'), 'tab B bar after complete');
  });

  await t.test('removing a queued task leaves the current task alone', async () => {
    await openPanel(pageA);
    assert.equal(await pageA.$(`${row(1)} [data-action="remove"]`), null, 'current task has Done, not Remove');
    await pageA.click(`${row(2)} [data-action="remove"]`);
    await waitForOverlay(pageA, listIs('Now Plan next sprint'), 'after remove');
    await waitForOverlay(pageB, showsTask('Plan next sprint'), 'tab B after remove');
    await pageA.keyboard.press('Escape');
  });

  await t.test('dragging moves the widget, does not open the panel, and syncs to other tabs', async () => {
    await pageA.bringToFront();
    await drag(pageA, '.bar', -300, 200);
    const moved = await waitForOverlay(pageA, at(212, 312), 'tab A after drag');
    assert.equal(moved.panel, false, 'a drag must not count as a click');
    assert.deepEqual(
      await withExtensionPage(async () => (await chrome.storage.local.get('position')).position),
      { top: 212, right: 312 },
    );
    await waitForOverlay(pageB, at(212, 312), 'tab B follows the drag');
  });

  await t.test('a plain click still opens the panel after a drag, and offers Reset position', async () => {
    await openPanel(pageA);
    await waitForOverlay(pageA, (s) => s.panel && s.resetItem, 'panel with reset item');
    await pageA.keyboard.press('Escape');
  });

  await t.test('the widget cannot be dragged out of the viewport', async () => {
    await pageA.bringToFront();
    await drag(pageA, '.bar', 5000, 5000);
    const s = await waitForOverlay(pageA, (o) => o.rightGap === 0 && o.bottomGap === 0, 'dragged to bottom-right');
    assert.ok(s.top > 0);

    await drag(pageA, '.bar', -5000, -5000);
    await waitForOverlay(pageA, (o) => o.top === 0 && o.left === 0, 'dragged to top-left');

    // The panel opens downward; near the bottom the whole widget shifts up so it stays visible.
    await drag(pageA, '.bar', 0, 5000);
    await pageA.click(pierce('.bar'));
    await waitForOverlay(pageA, (o) => o.panel && o.bottomGap === 0, 'panel fits at the bottom');
    await pageA.keyboard.press('Escape');
  });

  await t.test('collapse in one tab collapses everywhere; the marker keeps the position and expands', async () => {
    await pageA.bringToFront();
    await drag(pageA, '.bar', 0, -5000);
    await waitForOverlay(pageA, (o) => o.top === 0 && o.left === 0, 'back to top-left');

    await openPanel(pageB);
    await pageB.click(pierce('[data-action="collapse"]'));
    await waitForOverlay(pageB, (o) => showsPill(o) && o.top === 0, 'tab B collapsed');
    await waitForOverlay(pageA, showsPill, 'tab A collapsed');

    await pageA.bringToFront();
    await pageA.click(pierce('.pill'));
    await waitForOverlay(pageA, showsTask('Plan next sprint'), 'tab A expanded');
    await waitForOverlay(pageB, showsTask('Plan next sprint'), 'tab B expanded');
  });

  await t.test('reloading a page keeps the queue and the position', async () => {
    await pageA.reload();
    await pageA.waitForSelector(HOST);
    await waitForOverlay(pageA, (o) => showsTask('Plan next sprint')(o) && o.top === 0 && o.left === 0,
      'tab A after reload');
  });

  await t.test('Reset position puts the widget back in the top-right corner everywhere', async () => {
    await openPanel(pageA);
    await pageA.click(pierce('[data-action="reset-position"]'));
    await waitForOverlay(pageA, at(12, 12), 'tab A after reset');
    await waitForOverlay(pageB, at(12, 12), 'tab B after reset');
    await waitForOverlay(pageA, (o) => o.panel && !o.resetItem, 'reset item hidden at default position');
    await pageA.keyboard.press('Escape');
  });

  await t.test('completing the last task returns every tab to the empty marker', async () => {
    await openPanel(pageB);
    await pageB.click(`${row(1)} [data-action="complete"]`);
    await waitForOverlay(pageB, (o) => showsEmpty(o) && o.panel, 'tab B after last complete');
    await waitForOverlay(pageA, (o) => showsEmpty(o) && !o.panel, 'tab A after last complete');
    await pageB.keyboard.press('Escape');

    const popup = await openPopup();
    assert.equal((await popupStatus(popup)).caption, 'No current task');
    assert.equal(await popup.evaluate(() => chrome.action.getBadgeText({})), '');
    await popup.close();
  });

  await t.test('completing from the widget moves on to the next task, then the empty marker', async () => {
    await withExtensionPage(async () => {
      await TaskStore.addTask('First');
      await TaskStore.addTask('Second');
    });
    await waitForOverlay(pageA, showsTask('First', '+1'), 'tab A with two tasks');
    const popup = await openPopup();
    assert.equal((await popupStatus(popup)).queued, '1 more in the queue');
    await popup.close();

    await openPanel(pageA);
    await pageA.click(`${row(1)} [data-action="complete"]`);
    await waitForOverlay(pageA, showsTask('Second'), 'tab A after complete');
    await waitForOverlay(pageB, showsTask('Second'), 'tab B after complete');
    await pageA.click(`${row(1)} [data-action="complete"]`);
    await waitForOverlay(pageA, showsEmpty, 'tab A after last complete');
    await waitForOverlay(pageB, showsEmpty, 'tab B after last complete');
  });

  await pageA.close();
  await pageB.close();
});

test('the queue and widget position survive a browser restart', async () => {
  await resetStorage({});
  const page = await openPage('before-restart');
  await withExtensionPage(async () => {
    await TaskStore.addTask('Review algorithms');
    await TaskStore.addTask('Read chapter 4');
  });
  await waitForOverlay(page, showsTask('Review algorithms', '+1'), 'before restart');
  await page.bringToFront();
  await drag(page, '.bar', -100, 50);
  await waitForOverlay(page, at(62, 112), 'moved before restart');

  await browser.close();
  await launch();

  const after = await openPage('after-restart');
  await waitForOverlay(after, (o) => showsTask('Review algorithms', '+1')(o) && o.top === 62 && o.rightGap === 112,
    'page after restart');
  assert.deepEqual(await storedTitles(), ['Review algorithms', 'Read chapter 4']);
  await after.close();
});

test('reloading the extension leaves exactly one widget in already-open tabs', async () => {
  const visibleHosts = (page) => page.evaluate(() =>
    [...document.querySelectorAll('[id^="task-reminder-ext-root"]')]
      .filter((h) => getComputedStyle(h).display !== 'none').length);

  const page = await openPage('before-extension-reload');
  await withExtensionPage(() => chrome.storage.local.set({ position: null, collapsed: true }));
  await waitForOverlay(page, (o) => showsPill(o) && o.top === 12, 'collapsed before reload');

  // Reinstalling an unpacked extension from the same folder is what the reload button does.
  await browser.installExtension(EXTENSION_PATH);
  await new Promise((r) => setTimeout(r, 1500));

  await withExtensionPage(() => chrome.storage.local.set({ position: { top: 200, right: 300 }, collapsed: false }));
  await page.bringToFront();
  await waitForOverlay(page, (o) => showsTask('Review algorithms', '+1')(o) && o.top === 200 && o.rightGap === 300,
    'new widget follows the new position');
  assert.equal(await visibleHosts(page), 1, 'the previous version left a visible copy behind');

  await drag(page, '.bar', -50, 50);
  await waitForOverlay(page, at(250, 350), 'dragged after reload');
  assert.equal(await visibleHosts(page), 1);
  await page.close();
});

test('a single task saved by an older version is migrated into the queue', async () => {
  await resetStorage({ task: { title: 'Task from v0.2', startedAt: 1 }, collapsed: false });
  const page = await openPage('legacy');
  await waitForOverlay(page, showsTask('Task from v0.2'), 'legacy task shown before migration');

  await browser.installExtension(EXTENSION_PATH);
  await new Promise((r) => setTimeout(r, 1500));

  const stored = await withExtensionPage(() => chrome.storage.local.get(['tasks', 'task']));
  assert.deepEqual(stored.tasks.map((t) => t.title), ['Task from v0.2']);
  assert.equal('task' in stored, false, 'legacy key removed');

  await openPanel(page);
  await addFromWidget(page, 'Next thing');
  await waitForOverlay(page, listIs('Now Task from v0.2', '2 Next thing'), 'migrated queue accepts new tasks');
  await page.close();
});
