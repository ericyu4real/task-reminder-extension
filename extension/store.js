// Shared by the popup, content script and service worker.
// `var` + globalThis guard: this file may be injected twice into the same content-script world.
var TaskStore = globalThis.TaskStore || (() => {
  const MAX_TITLE_LENGTH = 200;
  const DEFAULTS = { task: null, collapsed: false, position: null };
  const KEYS = Object.keys(DEFAULTS);

  function normalizeTitle(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
  }

  function isValidTask(task) {
    return !!task && typeof task === 'object' && typeof task.title === 'string' && task.title.length > 0;
  }

  function normalizePosition(position) {
    if (!position || typeof position !== 'object') return null;
    const top = Number(position.top);
    const right = Number(position.right);
    if (!Number.isFinite(top) || !Number.isFinite(right)) return null;
    return { top: Math.max(0, Math.round(top)), right: Math.max(0, Math.round(right)) };
  }

  async function get() {
    const state = await chrome.storage.local.get(DEFAULTS);
    return {
      task: isValidTask(state.task) ? state.task : null,
      collapsed: !!state.collapsed,
      position: normalizePosition(state.position),
    };
  }

  async function start(title) {
    const clean = normalizeTitle(title);
    if (!clean) throw new Error('Task name cannot be empty');
    const task = { title: clean, startedAt: Date.now() };
    await chrome.storage.local.set({ task, collapsed: false });
    return task;
  }

  async function rename(title) {
    const clean = normalizeTitle(title);
    if (!clean) throw new Error('Task name cannot be empty');
    const { task } = await get();
    if (!task) return start(clean);
    const next = { ...task, title: clean };
    await chrome.storage.local.set({ task: next });
    return next;
  }

  async function complete() {
    await chrome.storage.local.set({ task: null, collapsed: false });
  }

  async function setCollapsed(collapsed) {
    await chrome.storage.local.set({ collapsed: !!collapsed });
  }

  // Position is the bar's offset from the top and right edges of the viewport, in CSS pixels.
  async function setPosition(position) {
    await chrome.storage.local.set({ position: normalizePosition(position) });
  }

  async function resetPosition() {
    await chrome.storage.local.set({ position: null });
  }

  function onChange(callback) {
    const listener = (changes, area) => {
      if (area === 'local' && KEYS.some((key) => key in changes)) callback();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  return {
    MAX_TITLE_LENGTH,
    normalizeTitle,
    get,
    start,
    rename,
    complete,
    setCollapsed,
    setPosition,
    resetPosition,
    onChange,
  };
})();
globalThis.TaskStore = TaskStore;
