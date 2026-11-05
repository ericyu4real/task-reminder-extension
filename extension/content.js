(() => {
  if (window.__taskReminderInjected || window.top !== window) return;
  window.__taskReminderInjected = true;

  const HOST_ID = 'task-reminder-ext-root';
  const DEFAULT_POSITION = { top: 12, right: 12 };
  const DRAG_THRESHOLD_PX = 4;

  // Copies left behind by a previous (reloaded) version of the extension. Their scripts may still be
  // running and re-attach them when removed, so hide and rename them before removing.
  for (const stale of document.querySelectorAll(`#${HOST_ID}`)) {
    stale.id = `${HOST_ID}-stale`;
    stale.style.setProperty('display', 'none', 'important');
    stale.remove();
  }

  const STYLES = `
    .wrap {
      display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 13px; line-height: 1.4; color: #f5f5f7;
      -webkit-font-smoothing: antialiased;
    }
    [hidden] { display: none !important; }
    button { all: unset; box-sizing: border-box; cursor: pointer; }
    button[disabled] { opacity: 0.3; cursor: default; pointer-events: none; }
    input {
      all: unset; box-sizing: border-box; min-width: 0; padding: 5px 8px;
      border: 1px solid #d1d1d6; border-radius: 6px; background: #fff; color: #1c1c1e;
      font: inherit; cursor: text;
    }
    input:focus { border-color: #0a84ff; }
    input::placeholder { color: #aeaeb2; }

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
    .count {
      flex: none; padding: 0 6px; border-radius: 999px;
      background: rgba(255, 255, 255, 0.16); color: #e5e5ea; font-size: 11px; line-height: 17px;
    }

    .panel {
      box-sizing: border-box; width: 300px;
      display: flex; flex-direction: column; gap: 2px;
      background: #fff; color: #1c1c1e;
      border-radius: 12px; padding: 6px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.05);
      outline: none;
    }
    .head {
      display: flex; justify-content: space-between; padding: 4px 8px 2px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #8e8e93;
    }
    .list { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow-y: auto; }
    .row {
      display: flex; align-items: center; gap: 8px;
      min-height: 32px; padding: 4px 6px 4px 8px; border-radius: 8px; box-sizing: border-box;
    }
    .row:hover, .row:focus-within { background: #f2f2f7; }
    .marker { flex: none; width: 28px; font-size: 11px; color: #8e8e93; }
    .row.current .marker { color: #1a7f37; font-weight: 600; }
    .row-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: text; }
    .row.current .row-title { font-weight: 600; }
    .row-edit { flex: 1; display: flex; min-width: 0; }
    .row-edit input { flex: 1; padding: 3px 6px; }
    .actions { flex: none; display: flex; gap: 1px; opacity: 0; transition: opacity 0.12s; }
    .row:hover .actions, .row:focus-within .actions { opacity: 1; }
    .icon {
      display: flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 6px; color: #636366; font-size: 12px;
    }
    .icon:hover, .icon:focus-visible { background: #e5e5ea; color: #1c1c1e; }
    .icon.remove:hover { color: #d70015; }
    .icon.complete {
      flex: none; width: 24px; height: 24px; border-radius: 50%;
      border: 1.5px solid #34c759; color: #1a7f37; font-size: 12px;
    }
    .icon.complete:hover, .icon.complete:focus-visible { background: #34c759; color: #fff; }

    .add { display: flex; gap: 6px; margin-top: 2px; padding: 6px 2px 2px; border-top: 1px solid #f2f2f7; }
    .add input { flex: 1; }
    .primary { padding: 5px 12px; border-radius: 6px; background: #0a84ff; color: #fff; }
    .primary:hover { background: #0071e3; }
    .foot { display: flex; justify-content: space-between; padding: 0 2px; }
    .foot button { padding: 4px 6px; border-radius: 6px; color: #636366; font-size: 12px; }
    .foot button:hover, .foot button:focus-visible { background: #f2f2f7; color: #1c1c1e; }

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
    <style>${STYLES}</style>
    <div class="wrap">
      <button class="bar" type="button" aria-haspopup="dialog" aria-expanded="false">
        <span class="dot"></span>
        <span class="text"><span class="label">Working on: </span><span class="title"></span></span>
        <span class="count" hidden></span>
      </button>
      <div class="panel" role="dialog" aria-label="Tasks" tabindex="-1" hidden>
        <div class="head"><span>Tasks</span><span class="head-count"></span></div>
        <ol class="list"></ol>
        <form class="add">
          <input type="text" maxlength="${TaskStore.MAX_TITLE_LENGTH}" placeholder="Add a task…" autocomplete="off" aria-label="New task" />
          <button class="primary" type="submit">Add</button>
        </form>
        <div class="foot">
          <button type="button" data-action="collapse">Collapse</button>
          <button type="button" data-action="reset-position">Reset position</button>
        </div>
      </div>
      <button class="pill" type="button" hidden><span class="dot"></span></button>
    </div>
  `;

  const $ = (selector) => root.querySelector(selector);
  const wrap = $('.wrap');
  const bar = $('.bar');
  const titleEl = $('.title');
  const countEl = $('.count');
  const panel = $('.panel');
  const headCount = $('.head-count');
  const list = $('.list');
  const addForm = $('.add');
  const addInput = $('.add input');
  const foot = $('.foot');
  const resetPositionItem = $('[data-action="reset-position"]');
  const pill = $('.pill');

  let state = { tasks: [], collapsed: false, position: null };
  let open = false;
  let editingId = null;
  let editDraft = '';
  let selectEditOnFocus = false;
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

  // Keep the whole widget inside the viewport, whatever size the panel/page currently has.
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
    if (host.style.getPropertyValue('display') === 'none') return;
    const { top, right } = clampedPosition();
    host.style.setProperty('top', `${top}px`, 'important');
    host.style.setProperty('right', `${right}px`, 'important');
  }

  function iconButton(action, glyph, label, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `icon ${action}`;
    button.dataset.action = action;
    button.textContent = glyph;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.disabled = disabled;
    return button;
  }

  function buildRow(task, index, total) {
    const row = document.createElement('li');
    row.className = index === 0 ? 'row current' : 'row';
    row.dataset.id = task.id;

    const marker = document.createElement('span');
    marker.className = 'marker';
    marker.textContent = index === 0 ? 'Now' : String(index + 1);
    row.append(marker);

    if (task.id === editingId) {
      const form = document.createElement('form');
      form.className = 'row-edit';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = TaskStore.MAX_TITLE_LENGTH;
      input.value = editDraft;
      input.setAttribute('aria-label', 'Task name');
      input.addEventListener('input', () => { editDraft = input.value; });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        saveEdit(task.id);
      });
      form.append(input);
      row.append(form);
      return row;
    }

    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = task.title;
    title.title = `${task.title}\nDouble-click to edit`;
    title.addEventListener('dblclick', () => startEdit(task.id));

    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.append(
      iconButton('up', '↑', 'Move up', index === 0),
      iconButton('down', '↓', 'Move down', index === total - 1),
      iconButton('edit', '✎', 'Edit'),
    );
    if (index > 0) actions.append(iconButton('remove', '✕', 'Remove'));

    row.append(title, actions);
    if (index === 0) row.append(iconButton('complete', '✓', 'Done: move on to the next task'));
    return row;
  }

  // Rebuilding the list destroys the focused element; without restoring focus, keys (Escape,
  // arrows) would go to the page instead of the widget.
  function renderList() {
    const { tasks } = state;
    const focused = root.activeElement;
    const focusWasInList = !!focused && list.contains(focused);
    const focusedButton = focusWasInList && focused.dataset.action
      ? { id: focused.closest('.row')?.dataset.id, action: focused.dataset.action }
      : null;

    list.replaceChildren(...tasks.map((task, index) => buildRow(task, index, tasks.length)));
    headCount.textContent = String(tasks.length);

    const editInput = list.querySelector('.row-edit input');
    if (editInput) {
      editInput.focus();
      if (selectEditOnFocus) editInput.select();
      else editInput.setSelectionRange(editInput.value.length, editInput.value.length);
      selectEditOnFocus = false;
      return;
    }
    if (!focusWasInList) return;
    const sameButton = focusedButton &&
      list.querySelector(`.row[data-id="${CSS.escape(focusedButton.id)}"] [data-action="${focusedButton.action}"]`);
    if (sameButton && !sameButton.disabled) sameButton.focus();
    else panel.focus({ preventScroll: true });
  }

  function render() {
    if (tornDown) return;
    if (!extensionAlive()) return teardown();
    ensureAttached();
    const { tasks, collapsed, position } = state;
    const current = tasks[0];
    if (editingId && !tasks.some((t) => t.id === editingId)) editingId = null;

    if (!current) {
      open = false;
      editingId = null;
      host.style.setProperty('display', 'none', 'important');
      return;
    }
    host.style.setProperty('display', 'block', 'important');
    if (collapsed) {
      open = false;
      editingId = null;
    }

    const more = tasks.length - 1;
    titleEl.textContent = current.title;
    countEl.textContent = `+${more}`;
    countEl.hidden = more === 0;
    const queued = more ? `\n${more} more in the queue` : '';
    bar.title = `Working on: ${current.title}${queued}\nClick to manage, drag to move`;
    pill.title = `Working on: ${current.title}${queued}\nClick to expand, drag to move`;

    bar.hidden = collapsed;
    pill.hidden = !collapsed;
    panel.hidden = !open;
    bar.setAttribute('aria-expanded', String(open));
    resetPositionItem.hidden = !position;
    if (open) renderList();
    applyPosition();
  }

  function setOpen(next) {
    open = next;
    if (!open) editingId = null;
    render();
  }

  function startEdit(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    editingId = id;
    editDraft = task.title;
    selectEditOnFocus = true;
    render();
  }

  function cancelEdit() {
    editingId = null;
    render();
  }

  function saveEdit(id) {
    const title = TaskStore.normalizeTitle(editDraft);
    if (!title) return;
    editingId = null;
    state = { ...state, tasks: state.tasks.map((t) => (t.id === id ? { ...t, title } : t)) };
    render();
    safely(() => TaskStore.updateTask(id, title));
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
    setOpen(!open);
  });

  pill.addEventListener('click', () => {
    if (suppressNextClick) return;
    safely(() => TaskStore.setCollapsed(false));
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const { id } = button.closest('.row').dataset;
    switch (button.dataset.action) {
      case 'up': safely(() => TaskStore.moveTask(id, -1)); break;
      case 'down': safely(() => TaskStore.moveTask(id, 1)); break;
      case 'edit': startEdit(id); break;
      case 'remove': safely(() => TaskStore.removeTask(id)); break;
      case 'complete': safely(() => TaskStore.completeCurrent()); break;
    }
  });

  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = TaskStore.normalizeTitle(addInput.value);
    addInput.focus();
    if (!title) return;
    addInput.value = '';
    safely(() => TaskStore.addTask(title));
  });

  foot.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'collapse') {
      setOpen(false);
      safely(() => TaskStore.setCollapsed(true));
    }
    if (action === 'reset-position') safely(() => TaskStore.resetPosition());
  });

  // Keep typing in the widget from triggering the page's keyboard shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    wrap.addEventListener(type, (event) => {
      if (type === 'keydown' && event.key === 'Escape') {
        if (editingId) cancelEdit();
        else if (open) setOpen(false);
      }
      event.stopPropagation();
    });
  }

  function onOutsidePointer(event) {
    if (open && !event.composedPath().includes(host)) setOpen(false);
  }
  document.addEventListener('pointerdown', onOutsidePointer, true);
  window.addEventListener('resize', applyPosition);

  // Some single-page apps replace the root's children; re-attach if we get removed.
  const observer = new MutationObserver(() => {
    if (host.isConnected || tornDown) return;
    if (extensionAlive()) ensureAttached();
    else teardown();
  });
  observer.observe(document.documentElement, { childList: true });

  ensureAttached();
  TaskStore.onChange(refresh);
  refresh();
})();
