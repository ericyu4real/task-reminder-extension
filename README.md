# Task Reminder (Chrome extension)

Shows a small floating bar — "Working on: *your current task*" — in the corner of every regular web page, so you always remember what you sat down to do.

![The bar on a page](docs/bar.png)

## Features

- An ordered **queue of tasks**. The first one is current; the rest wait in line.
- The bar always shows the top task. A `+N` chip appears when more are queued.
- Click the bar to open the panel: **add**, **edit**, **reorder**, **remove**, or mark the current task **done**. Done pops it off the queue and the next one becomes current.
- **Drag the bar anywhere.** The position is remembered and shared across tabs. It can't be dragged off-screen. **Reset position** puts it back in the top-right corner.
- Collapse the bar to a small dot. With no tasks, the widget shrinks to a hollow marker you can click to add the first one.
- The toolbar popup is a simple **on/off** switch plus a glance at the current task. All editing happens in the widget on the page.
- Queue, collapsed state, position and on/off are stored in `chrome.storage.local` and sync live across all tabs. They survive reloads, new tabs and browser restarts.
- Chrome's internal pages (`chrome://`, the New Tab page, the Chrome Web Store) can't show the widget; turn it on or off from the toolbar icon there. The icon shows a small green dot while a task is active.

Everything stays on your machine: no account, no backend, no network requests.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the **`extension`** folder in this repository (`task-reminder-extension/extension`), not the repository root.
4. Click the puzzle-piece icon in the toolbar and pin **Task Reminder**.

Tabs that were already open when you install get the widget without a refresh.

Optional: to show the widget on local `file://` pages, open the extension's **Details** and enable **Allow access to file URLs**.

### Updating after code changes

Click the reload arrow on the Task Reminder card in `chrome://extensions`. There's no need to remove and re-add it. Refresh any tab that still shows a leftover copy from the previous version.

## Usage

| Action | How |
| --- | --- |
| Add a task | Click the bar (or the empty marker), type in **Add a task**, press Enter |
| Edit a task | In the panel: ✎, or double-click the title |
| Reorder | ↑ / ↓ next to a task. The top one is always "Working on" |
| Complete the current task | ✓ on the first row. The next task in line becomes current |
| Remove a queued task | ✕ on that row (the current task is completed, not removed) |
| Move the widget | Drag the bar or the collapsed marker |
| Reset the position | **Reset position** at the bottom of the panel |
| Collapse / expand | **Collapse** in the panel; click the dot to expand |
| Show or hide on pages | Toolbar icon → **Show widget on pages** |
| Close the panel | Press Esc or click anywhere else on the page |

## Project layout

```
extension/              # The unpacked extension that Chrome loads
  manifest.json
  store.js              # Queue state in chrome.storage (shared by popup, page script, service worker)
  content.js            # The floating widget (Shadow DOM, isolated from page styles)
  popup.html/.css/.js   # Toolbar popup: on/off + current-task glance
  service-worker.js     # Toolbar badge; injects the widget into already-open tabs on install
  icons/
scripts/make-icons.mjs  # Regenerates the icon PNGs (no dependencies)
tests/e2e.test.mjs      # End-to-end tests
docs/                   # Screenshots
```

## Testing

The tests use Puppeteer to launch Chrome for Testing (branded Chrome no longer allows loading extensions from the command line), load `extension/`, serve local test pages and drive the extension with real mouse and keyboard input. They use a temporary browser profile and never touch your own Chrome.

```bash
npm install
npx puppeteer browsers install chrome   # first time only
npm test
```

What's covered:

- No tasks: pages show the empty marker; the popup shows the empty state with the widget on.
- The empty marker opens the panel ready to add; completing the last task returns to it.
- Adding a task shows the bar in two open tabs and in a newly opened tab, and sets the toolbar badge.
- After scrolling 3000px the bar is still 12px from the top and right edges.
- Tasks added from the widget queue behind the current one; a `+N` chip appears on every tab.
- Editing, reordering, completing and removing sync across tabs. Escape cancels an edit, then closes the panel.
- Dragging moves the widget without opening the panel; a plain click still opens it afterwards.
- The widget can't leave the viewport, and the open panel stays on screen near the bottom edge.
- Collapsing in one tab collapses the others; the dot keeps the dragged position.
- Reloading a page keeps the queue and position; **Reset position** returns the widget to the corner everywhere.
- Completing the last task returns every tab to the empty marker.
- Turning the widget off in the popup hides it on every tab without clearing the queue; turning it on restores it.
- The queue and position survive closing and relaunching the browser with the same profile.
- Reloading the extension leaves exactly one widget in already-open tabs.
- A single task saved by 0.2.x is migrated into the queue.
