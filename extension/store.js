// Shared by the popup, content script and service worker.
// `var` + globalThis guard: this file may be injected twice into the same content-script world.
var TaskStore = globalThis.TaskStore || (() => {
  const MAX_TITLE_LENGTH = 200;
  const DEFAULTS = { task: null, collapsed: false };

  function normalizeTitle(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
  }

  function isValidTask(task) {
    return !!task && typeof task === 'object' && typeof task.title === 'string' && task.title.length > 0;
  }

  async function get() {
    const state = await chrome.storage.local.get(DEFAULTS);
    return {
      task: isValidTask(state.task) ? state.task : null,
      collapsed: !!state.collapsed,
    };
  }

  async function start(title) {
    const clean = normalizeTitle(title);
    if (!clean) throw new Error('任务名称不能为空');
    const task = { title: clean, startedAt: Date.now() };
    await chrome.storage.local.set({ task, collapsed: false });
    return task;
  }

  async function rename(title) {
    const clean = normalizeTitle(title);
    if (!clean) throw new Error('任务名称不能为空');
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

  function onChange(callback) {
    const listener = (changes, area) => {
      if (area === 'local' && ('task' in changes || 'collapsed' in changes)) callback();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  return { MAX_TITLE_LENGTH, normalizeTitle, get, start, rename, complete, setCollapsed, onChange };
})();
globalThis.TaskStore = TaskStore;
