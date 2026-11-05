importScripts('store.js');

async function refreshAction() {
  const { tasks } = await TaskStore.get();
  const current = tasks[0];
  await chrome.action.setBadgeBackgroundColor({ color: '#34C759' });
  await chrome.action.setBadgeText({ text: current ? '•' : '' });
  await chrome.action.setTitle({
    title: current ? `Working on: ${current.title}` : 'Task Reminder: click to set your current task',
  });
}

// Manifest content scripts only reach pages loaded after install, so inject into tabs that are already open.
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
  await Promise.all(tabs.map((tab) =>
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ['store.js', 'content.js'] })
      .catch(() => {})
  ));
}

chrome.runtime.onInstalled.addListener(async () => {
  await TaskStore.migrateLegacy();
  refreshAction();
  injectIntoOpenTabs();
});
chrome.runtime.onStartup.addListener(async () => {
  await TaskStore.migrateLegacy();
  refreshAction();
});
TaskStore.onChange(refreshAction);
