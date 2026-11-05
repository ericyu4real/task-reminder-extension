// Shared by the popup, content script and service worker.
// `var` + globalThis guard: this file may be injected twice into the same content-script world.
var TaskStore = globalThis.TaskStore || (() => {
  const MAX_TITLE_LENGTH = 200;
  const MAX_TASKS = 50;
  // `task` is the single-task format used before 0.3.0; it is migrated into `tasks`.
  const DEFAULTS = { tasks: null, task: null, collapsed: false, position: null };
  const WATCHED_KEYS = ['tasks', 'task', 'collapsed', 'position'];

  function normalizeTitle(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
  }

  function isValidTask(task) {
    return !!task && typeof task === 'object' && typeof task.title === 'string' && task.title.length > 0;
  }

  function newId() {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function normalizeTasks(tasks, legacyTask) {
    if (Array.isArray(tasks)) {
      return tasks.filter(isValidTask).map((t) => ({
        id: String(t.id ?? newId()),
        title: t.title,
        createdAt: Number(t.createdAt) || 0,
      }));
    }
    if (isValidTask(legacyTask)) {
      return [{ id: 'migrated', title: legacyTask.title, createdAt: Number(legacyTask.startedAt) || 0 }];
    }
    return [];
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
      tasks: normalizeTasks(state.tasks, state.task),
      collapsed: !!state.collapsed,
      position: normalizePosition(state.position),
    };
  }

  async function saveTasks(tasks, extra = {}) {
    await chrome.storage.local.set({ tasks, ...extra });
    await chrome.storage.local.remove('task');
  }

  function requireTitle(title) {
    const clean = normalizeTitle(title);
    if (!clean) throw new Error('Task name cannot be empty');
    return clean;
  }

  async function addTask(title) {
    const clean = requireTitle(title);
    const { tasks } = await get();
    if (tasks.length >= MAX_TASKS) throw new Error(`You can have at most ${MAX_TASKS} tasks`);
    const task = { id: newId(), title: clean, createdAt: Date.now() };
    await saveTasks([...tasks, task], tasks.length === 0 ? { collapsed: false } : {});
    return task;
  }

  async function updateTask(id, title) {
    const clean = requireTitle(title);
    const { tasks } = await get();
    await saveTasks(tasks.map((t) => (t.id === id ? { ...t, title: clean } : t)));
  }

  async function removeTask(id) {
    const { tasks } = await get();
    const next = tasks.filter((t) => t.id !== id);
    await saveTasks(next, next.length === 0 ? { collapsed: false } : {});
  }

  // Finish the current (first) task; the next one in the queue becomes current.
  async function completeCurrent() {
    const { tasks } = await get();
    const next = tasks.slice(1);
    await saveTasks(next, next.length === 0 ? { collapsed: false } : {});
    return next[0] ?? null;
  }

  async function moveTask(id, delta) {
    const { tasks } = await get();
    const from = tasks.findIndex((t) => t.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= tasks.length) return;
    const next = [...tasks];
    const [task] = next.splice(from, 1);
    next.splice(to, 0, task);
    await saveTasks(next);
  }

  async function migrateLegacy() {
    const state = await chrome.storage.local.get(['tasks', 'task']);
    if (!('task' in state)) return;
    if (!Array.isArray(state.tasks)) await saveTasks(normalizeTasks(null, state.task));
    else await chrome.storage.local.remove('task');
  }

  async function setCollapsed(collapsed) {
    await chrome.storage.local.set({ collapsed: !!collapsed });
  }

  // Position is the widget's offset from the top and right edges of the viewport, in CSS pixels.
  async function setPosition(position) {
    await chrome.storage.local.set({ position: normalizePosition(position) });
  }

  async function resetPosition() {
    await chrome.storage.local.set({ position: null });
  }

  function onChange(callback) {
    const listener = (changes, area) => {
      if (area === 'local' && WATCHED_KEYS.some((key) => key in changes)) callback();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  return {
    MAX_TITLE_LENGTH,
    MAX_TASKS,
    normalizeTitle,
    get,
    addTask,
    updateTask,
    removeTask,
    completeCurrent,
    moveTask,
    migrateLegacy,
    setCollapsed,
    setPosition,
    resetPosition,
    onChange,
  };
})();
globalThis.TaskStore = TaskStore;
