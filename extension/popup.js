const els = {
  current: document.getElementById('current'),
  currentTitle: document.getElementById('current-title'),
  queued: document.getElementById('queued'),
  empty: document.getElementById('empty'),
  form: document.getElementById('form'),
  title: document.getElementById('title'),
  submit: document.getElementById('submit'),
  error: document.getElementById('error'),
  actions: document.getElementById('actions'),
  complete: document.getElementById('complete'),
  expand: document.getElementById('expand'),
};

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = !message;
}

async function render() {
  const { tasks, collapsed } = await TaskStore.get();
  const current = tasks[0];
  const more = tasks.length - 1;
  els.current.hidden = !current;
  els.empty.hidden = !!current;
  els.actions.hidden = !current;
  els.expand.hidden = !collapsed;
  els.currentTitle.textContent = current?.title ?? '';
  els.queued.textContent = more > 0 ? `${more} more in the queue` : '';
  els.queued.hidden = more <= 0;
  els.submit.textContent = current ? 'Add' : 'Start';
  els.title.placeholder = current ? 'Add another task' : 'What are you working on?';
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = TaskStore.normalizeTitle(els.title.value);
  if (!title) {
    showError('Enter a task name');
    els.title.focus();
    return;
  }
  showError('');
  try {
    await TaskStore.addTask(title);
  } catch (error) {
    showError(error.message);
    return;
  }
  els.title.value = '';
  await render();
  els.title.focus();
});

els.title.addEventListener('input', () => showError(''));

els.complete.addEventListener('click', async () => {
  await TaskStore.completeCurrent();
  await render();
  els.title.focus();
});

els.expand.addEventListener('click', () => TaskStore.setCollapsed(false));

TaskStore.onChange(render);

render().then(() => els.title.focus());
