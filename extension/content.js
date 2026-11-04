(() => {
  if (window.__taskReminderInjected || window.top !== window) return;
  window.__taskReminderInjected = true;

  const HOST_ID = 'task-reminder-ext-root';
  // A copy left behind by a previous (reloaded) version of the extension.
  document.getElementById(HOST_ID)?.remove();

  const CSS = `
    .wrap {
      display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      font-size: 13px; line-height: 1.4; color: #f5f5f7;
      -webkit-font-smoothing: antialiased;
    }
    [hidden] { display: none !important; }
    button { all: unset; box-sizing: border-box; cursor: pointer; }
    .bar {
      display: flex; align-items: center; gap: 7px;
      max-width: 320px; padding: 5px 12px 5px 10px;
      border-radius: 999px;
      background: rgba(28, 28, 30, 0.72);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
      opacity: 0.88; transition: opacity 0.15s, background 0.15s;
    }
    .bar:hover, .bar:focus-visible, .bar[aria-expanded="true"] { opacity: 1; background: rgba(28, 28, 30, 0.9); }
    .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: #34c759; }
    .text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .label { opacity: 0.7; }
    .panel {
      background: #fff; color: #1c1c1e;
      border-radius: 10px; padding: 4px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.05);
    }
    .menu { display: flex; flex-direction: column; min-width: 120px; }
    .menu button { padding: 6px 10px; border-radius: 6px; }
    .menu button:hover, .menu button:focus-visible { background: #f2f2f7; }
    .menu .done { color: #1a7f37; }
    .editor { display: flex; gap: 6px; padding: 6px; align-items: center; }
    .editor input {
      all: unset; box-sizing: border-box; width: 220px; padding: 5px 8px;
      border: 1px solid #d1d1d6; border-radius: 6px; background: #fff; color: #1c1c1e;
      font: inherit; cursor: text;
    }
    .editor input:focus { border-color: #0a84ff; }
    .editor .save { padding: 5px 10px; border-radius: 6px; background: #0a84ff; color: #fff; }
    .editor .cancel { padding: 5px 8px; border-radius: 6px; color: #636366; }
    .editor .cancel:hover { background: #f2f2f7; }
    .pill {
      display: flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%;
      background: rgba(28, 28, 30, 0.6);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
      opacity: 0.75; transition: opacity 0.15s;
    }
    .pill:hover, .pill:focus-visible { opacity: 1; }
  `;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('style', [
    'all: initial !important',
    'position: fixed !important',
    'top: 12px !important',
    'right: 12px !important',
    'z-index: 2147483647 !important',
    'display: none !important',
  ].join('; '));

  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${CSS}</style>
    <div class="wrap">
      <button class="bar" type="button" aria-haspopup="menu" aria-expanded="false" title="点击管理任务">
        <span class="dot"></span>
        <span class="text"><span class="label">正在做：</span><span class="title"></span></span>
      </button>
      <div class="panel menu" role="menu" hidden>
        <button type="button" role="menuitem" data-action="edit">修改任务</button>
        <button type="button" role="menuitem" data-action="complete" class="done">完成任务</button>
        <button type="button" role="menuitem" data-action="collapse">收起</button>
      </div>
      <form class="panel editor" hidden>
        <input type="text" maxlength="${TaskStore.MAX_TITLE_LENGTH}" placeholder="任务名称" autocomplete="off" />
        <button class="save" type="submit">保存</button>
        <button class="cancel" type="button" data-action="cancel">取消</button>
      </form>
      <button class="pill" type="button" hidden title="展开任务提醒"><span class="dot"></span></button>
    </div>
  `;

  const $ = (selector) => root.querySelector(selector);
  const wrap = $('.wrap');
  const bar = $('.bar');
  const titleEl = $('.title');
  const menu = $('.menu');
  const editor = $('.editor');
  const input = $('.editor input');
  const pill = $('.pill');

  let state = { task: null, collapsed: false };
  let mode = 'bar'; // 'bar' | 'menu' | 'edit'
  let tornDown = false;

  function ensureAttached() {
    if (!host.isConnected && document.documentElement) document.documentElement.appendChild(host);
  }

  function render() {
    if (tornDown) return;
    ensureAttached();
    const { task, collapsed } = state;
    if (!task) {
      mode = 'bar';
      host.style.setProperty('display', 'none', 'important');
      return;
    }
    host.style.setProperty('display', 'block', 'important');
    if (collapsed && mode !== 'edit') mode = 'bar';

    titleEl.textContent = task.title;
    bar.title = `正在做：${task.title}（点击管理）`;
    pill.title = `正在做：${task.title}（点击展开）`;

    bar.hidden = collapsed || mode === 'edit';
    menu.hidden = collapsed || mode !== 'menu';
    editor.hidden = collapsed || mode !== 'edit';
    pill.hidden = !collapsed;
    bar.setAttribute('aria-expanded', String(mode === 'menu'));
  }

  function setMode(next) {
    mode = next;
    render();
    if (next === 'edit') {
      input.value = state.task?.title ?? '';
      input.focus();
      input.select();
    }
  }

  function extensionAlive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function teardown() {
    tornDown = true;
    observer.disconnect();
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    host.remove();
  }

  async function safely(action) {
    if (!extensionAlive()) return teardown();
    try {
      await action();
    } catch (error) {
      if (!extensionAlive()) teardown();
      else console.warn('[任务提醒]', error);
    }
  }

  async function refresh() {
    await safely(async () => {
      state = await TaskStore.get();
      render();
    });
  }

  bar.addEventListener('click', () => setMode(mode === 'menu' ? 'bar' : 'menu'));

  menu.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'edit') setMode('edit');
    if (action === 'complete') {
      setMode('bar');
      safely(() => TaskStore.complete());
    }
    if (action === 'collapse') {
      setMode('bar');
      safely(() => TaskStore.setCollapsed(true));
    }
  });

  editor.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = TaskStore.normalizeTitle(input.value);
    if (!title) {
      input.focus();
      return;
    }
    setMode('bar');
    safely(() => TaskStore.rename(title));
  });

  editor.querySelector('[data-action="cancel"]').addEventListener('click', () => setMode('bar'));

  pill.addEventListener('click', () => safely(() => TaskStore.setCollapsed(false)));

  // Keep typing in the editor from triggering the page's keyboard shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    wrap.addEventListener(type, (event) => {
      if (type === 'keydown' && event.key === 'Escape' && mode !== 'bar') setMode('bar');
      event.stopPropagation();
    });
  }

  function onOutsidePointer(event) {
    if (mode !== 'bar' && !event.composedPath().includes(host)) setMode('bar');
  }
  document.addEventListener('pointerdown', onOutsidePointer, true);

  // Some single-page apps replace the root's children; re-attach if we get removed.
  const observer = new MutationObserver(() => {
    if (!host.isConnected && !tornDown) ensureAttached();
  });
  observer.observe(document.documentElement, { childList: true });

  ensureAttached();
  TaskStore.onChange(refresh);
  refresh();
})();
