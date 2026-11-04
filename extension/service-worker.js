importScripts('store.js');

async function refreshAction() {
  const { task } = await TaskStore.get();
  await chrome.action.setBadgeBackgroundColor({ color: '#34C759' });
  await chrome.action.setBadgeText({ text: task ? '•' : '' });
  await chrome.action.setTitle({ title: task ? `正在做：${task.title}` : '任务提醒：点击设置当前任务' });
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

chrome.runtime.onInstalled.addListener(() => {
  refreshAction();
  injectIntoOpenTabs();
});
chrome.runtime.onStartup.addListener(refreshAction);
TaskStore.onChange(refreshAction);
