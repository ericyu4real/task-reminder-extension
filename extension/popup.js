const els = {
  status: document.getElementById('status'),
  caption: document.getElementById('caption'),
  currentTitle: document.getElementById('current-title'),
  queued: document.getElementById('queued'),
  enabled: document.getElementById('enabled'),
  toggleState: document.getElementById('toggle-state'),
  hint: document.getElementById('hint'),
};

async function render() {
  const { tasks, enabled } = await TaskStore.get();
  const current = tasks[0];
  const more = Math.max(0, tasks.length - 1);

  els.status.classList.toggle('empty', !current);
  els.status.classList.toggle('off', !enabled);
  els.caption.textContent = current ? 'Working on' : 'No current task';
  els.currentTitle.textContent = current?.title ?? '';
  els.queued.textContent = more > 0 ? `${more} more in the queue` : '';
  els.enabled.checked = enabled;
  els.toggleState.textContent = enabled ? 'On' : 'Off';

  if (!enabled) {
    els.hint.textContent = 'The widget is hidden. Turn it on to see your tasks on pages.';
  } else if (!current) {
    els.hint.textContent = 'Click the marker on any page to add a task. Chrome’s internal pages can’t show it.';
  } else {
    els.hint.textContent = 'Click the bar on any page to add, edit, reorder or complete tasks.';
  }
}

els.enabled.addEventListener('change', () => TaskStore.setEnabled(els.enabled.checked));

TaskStore.onChange(render);
render();
