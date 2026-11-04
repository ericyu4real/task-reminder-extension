const els = {
  current: document.getElementById('current'),
  currentTitle: document.getElementById('current-title'),
  empty: document.getElementById('empty'),
  form: document.getElementById('form'),
  title: document.getElementById('title'),
  submit: document.getElementById('submit'),
  error: document.getElementById('error'),
  actions: document.getElementById('actions'),
  complete: document.getElementById('complete'),
  expand: document.getElementById('expand'),
};

let lastRenderedTitle;

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = !message;
}

async function render() {
  const { task, collapsed } = await TaskStore.get();
  els.current.hidden = !task;
  els.empty.hidden = !!task;
  els.actions.hidden = !task;
  els.expand.hidden = !collapsed;
  els.currentTitle.textContent = task?.title ?? '';
  els.submit.textContent = task ? 'Update' : 'Start';
  els.title.placeholder = task ? 'Rename the task' : 'What are you working on?';

  const title = task?.title ?? '';
  if (title !== lastRenderedTitle) {
    els.title.value = title;
    lastRenderedTitle = title;
  }
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
  const { task } = await TaskStore.get();
  if (task) await TaskStore.rename(title);
  else await TaskStore.start(title);
  await render();
  els.title.select();
});

els.title.addEventListener('input', () => showError(''));

els.complete.addEventListener('click', async () => {
  await TaskStore.complete();
  await render();
  els.title.focus();
});

els.expand.addEventListener('click', () => TaskStore.setCollapsed(false));

TaskStore.onChange(render);

render().then(() => {
  els.title.focus();
  els.title.select();
});
