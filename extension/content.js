(() => {
  if (window.__taskReminderInjected || window.top !== window) return;
  window.__taskReminderInjected = true;

  const HOST_ID = 'task-reminder-ext-root';
  const DEFAULT_POSITION = { top: 12, right: 12 };
  const DRAG_THRESHOLD_PX = 4;

  // A copy left behind by a previous (reloaded) version of the extension.
  document.getElementById(HOST_ID)?.remove();

  const CSS = `
    .wrap {
      display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
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
      touch-action: none; user-select: none;
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
    .menu { display: flex; flex-direction: column; min-width: 130px; }
    .menu button { padding: 6px 10px; border-radius: 6px; }
    .menu button:hover, .menu button:focus-visible { background: #f2f2f7; }
    .menu .done { color: #1a7f37; }
    .menu .secondary { color: #636366; }
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
      touch-action: none; user-select: none;
    }
    .pill:hover, .pill:focus-visible { opacity: 1; }
    .wrap.dragging .bar, .wrap.dragging .pill { cursor: grabbing; opacity: 1; }
  `;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('style', [
    'all: initial !important',
    'position: fixed !important',
    `top: ${DEFAULT_POSITION.top}px !important`,
    `right: ${DEFAULT_POSITION.right}px !important`,
    'z-index: 2147483647 !important',
    'display: none !important',
  ].join('; '));

  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${CSS}</style>
    <div class="wrap">
      <button class="bar" type="button" aria-haspopup="menu" aria-expanded="false">
        <span class="dot"></span>
        <span class="text"><span class="label">Working on: </span><span class="title"></span></span>
      </button>
      <div class="panel menu" role="menu" hidden>
        <button type="button" role="menuitem" data-action="edit">Edit task</button>
        <button type="button" role="menuitem" data-action="complete" class="done">Complete task</button>
        <button type="button" role="menuitem" data-action="collapse">Collapse</button>
        <button type="button" role="menuitem" data-action="reset-position" class="secondary">Reset position</button>
      </div>
      <form class="panel editor" hidden>
        <input type="text" maxlength="${TaskStore.MAX_TITLE_LENGTH}" placeholder="Task name" autocomplete="off" />
        <button class="save" type="submit">Save</button>
        <button class="cancel" type="button" data-action="cancel">Cancel</button>
      </form>
      <button class="pill" type="button" hidden><span class="dot"></span></button>
    </div>
  `;

  const $ = (selector) => root.querySelector(selector);
  const wrap = $('.wrap');
  const bar = $('.bar');
  const titleEl = $('.title');
  const menu = $('.menu');
  const resetPositionItem = $('[data-action="reset-position"]');
  const editor = $('.editor');
  const input = $('.editor input');
  const pill = $('.pill');

  let state = { task: null, collapsed: false, position: null };
  let mode = 'bar'; // 'bar' | 'menu' | 'edit'
  let drag = null;
  let dragPosition = null; // unsaved position while a drag is in progress
  let suppressNextClick = false;
  let tornDown = false;

  function ensureAttached() {
    if (!host.isConnected && document.documentElement) document.documentElement.appendChild(host);
  }

  function viewportSize() {
    const el = document.documentElement;
    return { width: el.clientWidth || window.innerWidth, height: el.clientHeight || window.innerHeight };
  }

  // Keep the whole host inside the viewport, whatever size the menu/editor/page currently has.
  function clampedPosition() {
    const wanted = dragPosition ?? state.position ?? DEFAULT_POSITION;
    const rect = host.getBoundingClientRect();
    const viewport = viewportSize();
    const clamp = (value, max) => Math.min(Math.max(0, value), Math.max(0, max));
    return {
      top: Math.round(clamp(wanted.top, viewport.height - rect.height)),
      right: Math.round(clamp(wanted.right, viewport.width - rect.width)),
    };
  }

  function applyPosition() {
    if (!state.task) return;
    const { top, right } = clampedPosition();
    host.style.setProperty('top', `${top}px`, 'important');
    host.style.setProperty('right', `${right}px`, 'important');
  }

  function render() {
    if (tornDown) return;
    ensureAttached();
    const { task, collapsed, position } = state;
    if (!task) {
      mode = 'bar';
      host.style.setProperty('display', 'none', 'important');
      return;
    }
    host.style.setProperty('display', 'block', 'important');
    if (collapsed && mode !== 'edit') mode = 'bar';

    titleEl.textContent = task.title;
    bar.title = `Working on: ${task.title}\nClick to manage, drag to move`;
    pill.title = `Working on: ${task.title}\nClick to expand, drag to move`;

    bar.hidden = collapsed || mode === 'edit';
    menu.hidden = collapsed || mode !== 'menu';
    editor.hidden = collapsed || mode !== 'edit';
    pill.hidden = !collapsed;
    resetPositionItem.hidden = !position;
    bar.setAttribute('aria-expanded', String(mode === 'menu'));
    applyPosition();
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
    window.removeEventListener('resize', applyPosition);
    host.remove();
  }

  async function safely(action) {
    if (!extensionAlive()) return teardown();
    try {
      await action();
    } catch (error) {
      if (!extensionAlive()) teardown();
      else console.warn('[Task Reminder]', error);
    }
  }

  async function refresh() {
    await safely(async () => {
      state = await TaskStore.get();
      render();
    });
  }

  // Dragging: the bar and the collapsed marker act as handles. A press that moves less than
  // DRAG_THRESHOLD_PX is a normal click.
  function onDragStart(event) {
    if (event.button !== 0) return;
    const rect = host.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      top: rect.top,
      right: viewportSize().width - rect.right,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onDragMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      wrap.classList.add('dragging');
      if (mode !== 'bar') setMode('bar');
    }
    dragPosition = { top: drag.top + dy, right: drag.right - dx };
    applyPosition();
  }

  function onDragEnd(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { moved } = drag;
    drag = null;
    if (!moved) return;
    wrap.classList.remove('dragging');
    const position = clampedPosition();
    dragPosition = null;
    state = { ...state, position };
    render();
    suppressNextClick = true;
    setTimeout(() => { suppressNextClick = false; }, 0);
    safely(() => TaskStore.setPosition(position));
  }

  function onDragCancel(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    dragPosition = null;
    wrap.classList.remove('dragging');
    applyPosition();
  }

  for (const handle of [bar, pill]) {
    handle.addEventListener('pointerdown', onDragStart);
    handle.addEventListener('pointermove', onDragMove);
    handle.addEventListener('pointerup', onDragEnd);
    handle.addEventListener('pointercancel', onDragCancel);
  }

  bar.addEventListener('click', () => {
    if (suppressNextClick) return;
    setMode(mode === 'menu' ? 'bar' : 'menu');
  });

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
    if (action === 'reset-position') {
      setMode('bar');
      safely(() => TaskStore.resetPosition());
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

  pill.addEventListener('click', () => {
    if (suppressNextClick) return;
    safely(() => TaskStore.setCollapsed(false));
  });

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
  window.addEventListener('resize', applyPosition);

  // Some single-page apps replace the root's children; re-attach if we get removed.
  const observer = new MutationObserver(() => {
    if (!host.isConnected && !tornDown) ensureAttached();
  });
  observer.observe(document.documentElement, { childList: true });

  ensureAttached();
  TaskStore.onChange(refresh);
  refresh();
})();
