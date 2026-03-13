/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
const CORE_FILES = [
  "extensionCore.js",
  "config.js",
  "globals.js",
  "utils.js",
  "domHandler.js",
  "conversationHandler.js",
  "checkboxManager.js",
];

const SAFETY_CONFIRM_THRESHOLD = 20;
const LOG_STORAGE_KEY = 'chatgpt-bulk-tools-log';
const LOG_LIMIT = 80;



function readStoredLog() {
  try {
    const raw = localStorage.getItem(LOG_STORAGE_KEY);
    const data = JSON.parse(raw || '[]');
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function writeStoredLog(entries) {
  try {
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(entries.slice(-LOG_LIMIT)));
  } catch (_) {}
}

function renderLog() {
  const box = document.getElementById('operation-log');
  if (!box) return;
  const entries = readStoredLog();
  if (!entries.length) {
    box.classList.add('empty');
    box.innerHTML = 'No log entries yet.';
    return;
  }
  box.classList.remove('empty');
  box.innerHTML = entries.slice().reverse().map((entry) => {
    const t = escapeHtml(entry.time || '--:--:--');
    const msg = escapeHtml(entry.text || '');
    return `<div class="log-entry"><span class="log-time">${t}</span><span class="log-text">${msg}</span></div>`;
  }).join('');
}

function addLogEntry(text) {
  const entries = readStoredLog();
  const now = new Date();
  const stamp = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entries.push({ time: stamp, text: String(text || '').trim() });
  writeStoredLog(entries);
  renderLog();
}

function clearLogEntries() {
  writeStoredLog([]);
  renderLog();
}

function copyLogEntries() {
  const entries = readStoredLog();
  const text = entries.map((e) => `[${e.time}] ${e.text}`).join('\n');
  if (!text) {
    alert('No log entries to copy.');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    addLogEntry('Copied operation log to clipboard.');
  }).catch(() => {
    alert('Could not copy log to clipboard.');
  });
}

function scrollPopupToTop() {
  const shell = document.querySelector('.shell');
  if (shell && typeof shell.scrollTo === 'function') {
    shell.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}


function isSupportedChatgptUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:')) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com';
  } catch (_) {
    return false;
  }
}

function showUnsupportedPageState(url = '') {
  setStats('—', '—');
  setStatus({
    mode: 'idle',
    text: isSupportedChatgptUrl(url)
      ? 'Ready. No bulk operation is running.'
      : 'Open ChatGPT on chatgpt.com or chat.openai.com to use this extension.'
  });
}

function withActiveTab(callback, options = {}) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) {
      if (options.onUnsupported) options.onUnsupported(null);
      return;
    }

    if (!isSupportedChatgptUrl(tab.url)) {
      if (options.onUnsupported) options.onUnsupported(tab);
      else showUnsupportedPageState(tab.url || '');
      return;
    }

    callback(tab);
  });
}

function loadGlobalsThenExecute(tabId, secondaryScript, callback) {
  chrome.scripting.executeScript(
    {
      target: { tabId },
      files: CORE_FILES,
    },
    () => {
      if (chrome.runtime.lastError) {
        console.warn(chrome.runtime.lastError.message || chrome.runtime.lastError);
        showUnsupportedPageState();
        return;
      }
      chrome.scripting.executeScript(
        {
          target: { tabId },
          files: [secondaryScript],
        },
        () => {
          if (chrome.runtime.lastError) {
            console.warn(chrome.runtime.lastError.message || chrome.runtime.lastError);
            showUnsupportedPageState();
            return;
          }
          if (typeof callback === 'function') callback();
        }
      );
    }
  );
}

function setStatus({ mode = 'idle', percent = null, text = 'Ready. No bulk operation is running.' } = {}) {
  const card = document.getElementById('status-card');
  const label = document.getElementById('status-percent');
  const textEl = document.getElementById('status-text');
  const fill = document.getElementById('status-progress-fill');
  if (!card || !label || !textEl || !fill) return;

  card.classList.remove('idle', 'running', 'complete');
  card.classList.add(mode);

  const safePercent = typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : 0;
  fill.style.width = `${safePercent}%`;

  if (mode === 'idle') {
    label.textContent = 'Idle';
  } else if (mode === 'complete') {
    label.textContent = 'Done';
  } else {
    label.textContent = `${safePercent}%`;
  }

  textEl.textContent = text;
}

function updateProgressBar(buttonId, progress, meta = {}) {
  const button = document.getElementById(buttonId);
  if (!button) return;

  button.classList.add("progress");
  button.style.setProperty("--progress", `${progress}%`);
  button.setAttribute("data-progress", progress);

  const buttonText = buttonId === "bulk-delete" ? "Bulk Delete" : "Bulk Archive";
  const actionText = buttonId === "bulk-delete" ? "Deleting" : "Archiving";
  const processed = Math.min(meta.processed || 0, meta.total || 0);
  const remaining = meta.total ? Math.max(0, meta.total - processed) : null;
  const processedText = meta.total ? `${processed}/${meta.total}` : `${progress}%`;
  const currentTitle = meta.currentTitle ? ` — ${meta.currentTitle}` : '';

  if (progress === 100) {
    button.disabled = true;
    button.innerHTML = `<span class="progress-text">100%</span><span class="button-text">${actionText} Complete</span>`;
    setStatus({ mode: 'complete', percent: 100, text: `${actionText} complete.` });
    setTimeout(() => {
      button.disabled = false;
      button.classList.remove("progress");
      button.style.removeProperty("--progress");
      button.innerHTML = `<span class="button-text">${buttonText}</span>`;
      setStatus({ mode: 'idle' });
      refreshStats();
    }, 700);
  } else {
    button.disabled = true;
    button.innerHTML = `<span class="progress-text">${processedText}</span><span class="button-text">${actionText}...</span>`;
    const remainingText = remaining === null ? '' : ` · ${remaining} left`;
    setStatus({ mode: 'running', percent: progress, text: `${actionText} ${processedText}${remainingText}${currentTitle}` });
  }
}

chrome.runtime.onMessage.addListener(function (request) {
  if (request.action === "updateProgress") {
    updateProgressBar(request.buttonId, request.progress, request.meta || {});
    if ((request.progress || 0) === 0 && request.meta?.total) {
      const label = request.buttonId === 'bulk-delete' ? 'Delete' : 'Archive';
      addLogEntry(`${label} run started for ${request.meta.total} item(s).`);
    }
  } else if (request.action === "operationComplete") {
    updateProgressBar(request.buttonId, 100, request.meta || {});
    const label = request.buttonId === 'bulk-delete' ? 'Delete' : 'Archive';
    const processed = request.meta?.processed ?? request.meta?.total ?? 0;
    addLogEntry(`${label} run completed. Processed ${processed} item(s).`);
  }
});

function loadVersion() {
  const manifestData = chrome.runtime.getManifest();
  const versionBadge = document.getElementById("version-badge");
  if (versionBadge && manifestData.version) {
    versionBadge.textContent = `v${manifestData.version}`;
  }
}

function setStats(visible, selected) {
  const stats = document.getElementById("stats");
  stats.textContent = `Visible: ${visible} · Selected: ${selected}`;
}

function refreshStats() {
  withActiveTab((tab) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        func: () => {
          const visibleCheckboxes = Array.from(document.querySelectorAll('.conversation-checkbox'))
            .filter(cb => cb.offsetParent !== null);
          const selected = visibleCheckboxes.filter(cb => cb.checked).length;
          return { visible: visibleCheckboxes.length, selected };
        },
      },
      (results) => {
        if (chrome.runtime.lastError || !results || !results[0]) {
          setStats('—', '—');
          return;
        }
        const { visible, selected } = results[0].result || { visible: '—', selected: '—' };
        setStats(visible, selected);
      }
    );
  }, { onUnsupported: (tab) => showUnsupportedPageState(tab?.url || '') });
}

function downloadTextFile(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSelected(kind) {
  withActiveTab((tab) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        func: () => {
          const rows = Array.from(document.querySelectorAll('.conversation-checkbox:checked')).map((checkbox) => {
            const row = checkbox.closest('a') || checkbox.parentElement?.querySelector('a') || checkbox.parentElement;
            const link = row?.closest('a') || row;
            const href = link?.href || link?.getAttribute?.('href') || '';
            const title = (link?.innerText || row?.innerText || '').replace(/\s+/g, ' ').trim();
            return { title, href };
          });
          return rows.filter(item => item.title || item.href);
        },
      },
      (results) => {
        const items = results?.[0]?.result || [];
        if (!items.length) {
          alert('No selected conversations to export.');
          return;
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        if (kind === 'json') {
          downloadTextFile(`chatgpt-selected-${stamp}.json`, JSON.stringify(items, null, 2), 'application/json');
          addLogEntry(`Exported ${items.length} selected item(s) as JSON.`);
        } else {
          const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
          const csv = ['title,href', ...items.map(item => `${escapeCsv(item.title)},${escapeCsv(item.href)}`)].join('\n');
          downloadTextFile(`chatgpt-selected-${stamp}.csv`, csv, 'text/csv');
          addLogEntry(`Exported ${items.length} selected item(s) as CSV.`);
        }
      }
    );
  });
}

function setAutoAttachButton(enabled) {
  const button = document.getElementById("auto-attach-scroll");
  if (!button) return;
  button.classList.toggle("active", !!enabled);
  button.setAttribute("aria-pressed", enabled ? "true" : "false");
  const label = button.querySelector('.switch-label');
  if (label) label.textContent = enabled ? 'ON' : 'OFF';
}

function syncAutoAttachState() {
  withActiveTab((tab) => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => !!window.__CHATGPT_BULK_AUTO_ATTACH__?.enabled,
    }, (results) => {
      const enabled = !!results?.[0]?.result;
      setAutoAttachButton(enabled);
    });
  }, { onUnsupported: () => setAutoAttachButton(false) });
}

function getSelectedCount() {
  return new Promise((resolve) => {
    withActiveTab((tab) => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => Array.from(document.querySelectorAll('.conversation-checkbox:checked')).filter(cb => cb.offsetParent !== null).length,
      }, (results) => resolve(results?.[0]?.result || 0));
    }, { onUnsupported: () => resolve(0) });
  });
}

function addButtonListener(buttonId, scriptName, options = {}) {
  const button = document.getElementById(buttonId);
  if (!button) return;

  button.addEventListener("click", async () => {
    scrollPopupToTop();

    if (options.confirmBulk) {
      const selectedCount = await getSelectedCount();
      if (!selectedCount) {
        alert('No selected conversations.');
        addLogEntry(`Blocked ${options.confirmVerb.toLowerCase()} run because nothing was selected.`);
        return;
      }
      if (selectedCount >= SAFETY_CONFIRM_THRESHOLD) {
        const okay = window.confirm(`${options.confirmVerb} ${selectedCount} conversations? This cannot be undone.`);
        if (!okay) { addLogEntry(`Cancelled ${options.confirmVerb.toLowerCase()} confirmation for ${selectedCount} item(s).`); return; }
      }
      addLogEntry(`${options.confirmVerb} requested for ${selectedCount} selected item(s).`);
      setStatus({ mode: 'running', percent: 0, text: `${options.confirmVerb} ${selectedCount} conversations...` });
      scrollPopupToTop();
    }

    addLogEntry(`Running ${button.textContent.replace(/\s+/g, ' ').trim()}.`);
    withActiveTab((tab) => {
      if (options.progressButton) {
        button.disabled = true;
        button.classList.add("progress");
      }
      loadGlobalsThenExecute(tab.id, scriptName, () => {
        if (options.refreshStats) {
          setTimeout(refreshStats, 150);
        }
      });
    });
  });
}

function runFilteredSelection(mode) {
  const query = (document.getElementById('filter-query')?.value || '').trim().toLowerCase();
  if (!query) {
    alert('Type part of a chat title first.');
    return;
  }
  withActiveTab((tab) => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [query, mode],
      func: (queryText, selectionMode) => {
        const visibleCheckboxes = Array.from(document.querySelectorAll('.conversation-checkbox'))
          .filter(cb => cb.offsetParent !== null);
        let matched = 0;
        for (const cb of visibleCheckboxes) {
          const row = cb.closest('a') || cb.parentElement?.closest('a') || cb.parentElement;
          const text = (row?.innerText || cb.parentElement?.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
          if (text.includes(queryText)) {
            cb.checked = selectionMode === 'select';
            matched += 1;
          }
        }
        return { matched, mode: selectionMode };
      }
    }, (results) => {
      const res = results?.[0]?.result;
      const matched = res?.matched || 0;
      refreshStats();
      const verb = mode === 'select' ? 'Selected' : 'Cleared';
      addLogEntry(`${verb} ${matched} visible item(s) matching filter.`);
      setStatus({ mode: 'idle', text: `${verb} ${matched} visible chat${matched === 1 ? '' : 's'} matching your filter.` });
    });
  });
}


function getSafeCountInput() {
  const raw = Number(document.getElementById('oldest-count')?.value || 10);
  if (!Number.isFinite(raw)) return 10;
  return Math.max(1, Math.min(500, Math.round(raw)));
}

function updatePreviewBox(items, meta = {}) {
  const box = document.getElementById('preview-box');
  if (!box) return;
  if (!items || !items.length) {
    box.classList.add('empty');
    box.innerHTML = meta.message || 'No preview yet.';
    return;
  }
  box.classList.remove('empty');
  const capped = items.slice(0, 30);
  const summary = `<span class="preview-title">${meta.title || 'Preview'} (${items.length})</span>`;
  const lines = capped.map((item, idx) => `<span class="preview-item">${idx + 1}. ${escapeHtml(item.title || item.href || 'Untitled chat')}</span>`).join('');
  const extra = items.length > capped.length ? `<span class="preview-muted">…and ${items.length - capped.length} more</span>` : '';
  box.innerHTML = summary + lines + extra;
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function runOldestSelection(mode) {
  const count = getSafeCountInput();
  withActiveTab((tab) => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [count, mode],
      func: (limit, selectionMode) => {
        const visibleCheckboxes = Array.from(document.querySelectorAll('.conversation-checkbox')).filter(cb => cb.offsetParent !== null);
        const target = visibleCheckboxes.slice(-limit);
        target.forEach((cb) => {
          cb.checked = selectionMode === 'select';
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        });
        return { affected: target.length, mode: selectionMode, limit };
      }
    }, (results) => {
      const res = results?.[0]?.result || { affected: 0, mode, limit: count };
      refreshStats();
      const verb = mode === 'select' ? 'Selected' : 'Cleared';
      addLogEntry(`${verb} ${res.affected} oldest visible item(s).`);
      setStatus({ mode: 'idle', text: `${verb} ${res.affected} oldest visible chat${res.affected === 1 ? '' : 's'}.` });
    });
  });
}

function runDryPreview() {
  scrollPopupToTop();
  withActiveTab((tab) => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Array.from(document.querySelectorAll('.conversation-checkbox:checked'))
        .filter(cb => cb.offsetParent !== null)
        .map((checkbox) => {
          const row = checkbox.closest('a') || checkbox.parentElement?.querySelector('a') || checkbox.parentElement;
          const link = row?.closest('a') || row;
          const href = link?.href || link?.getAttribute?.('href') || '';
          const title = (link?.innerText || row?.innerText || '').replace(/\s+/g, ' ').trim();
          return { title, href };
        })
        .filter(item => item.title || item.href),
    }, (results) => {
      const items = results?.[0]?.result || [];
      updatePreviewBox(items, {
        title: 'Dry run preview',
        message: 'Nothing selected. Preview is empty.'
      });
      const count = items.length;
      addLogEntry(count ? `Dry run previewed ${count} selected item(s).` : 'Dry run found no selected items.');
      setStatus({ mode: 'idle', text: count ? `Dry run ready. ${count} selected chat${count === 1 ? '' : 's'} will be touched.` : 'Dry run found no selected chats.' });
    });
  });
}

function initializeButtons() {
  addButtonListener("add-checkboxes", "addCheckboxes.js", { refreshStats: true });
  addButtonListener("bulk-delete", "bulkDeleteConversations.js", { progressButton: true, refreshStats: true, confirmBulk: true, confirmVerb: 'Delete' });
  addButtonListener("bulk-archive", "bulkArchiveConversations.js", { progressButton: true, refreshStats: true, confirmBulk: true, confirmVerb: 'Archive' });
  addButtonListener("toggle-checkboxes", "toggleCheckboxes.js", { refreshStats: true });
  addButtonListener("remove-checkboxes", "removeCheckboxes.js");
  addButtonListener("select-visible", "selectVisible.js", { refreshStats: true });
  addButtonListener("clear-selection", "clearSelection.js", { refreshStats: true });
  addButtonListener("invert-selection", "invertSelection.js", { refreshStats: true });
  addButtonListener("stop-operation", "stopCurrentOperation.js");

  document.getElementById('auto-attach-scroll').addEventListener('click', () => {
    addLogEntry('Toggled auto attach on scroll.');
    withActiveTab((tab) => {
      loadGlobalsThenExecute(tab.id, 'autoAttachOnScroll.js', () => {
        syncAutoAttachState();
        setTimeout(refreshStats, 250);
      });
    });
  });

  document.getElementById('refresh-stats').addEventListener('click', () => {
    addLogEntry('Refreshing checkboxes and stats.');
    withActiveTab((tab) => {
      loadGlobalsThenExecute(tab.id, 'addCheckboxes.js', () => {
        setTimeout(() => {
          refreshStats();
          syncAutoAttachState();
          addLogEntry('Refreshed checkboxes and stats.');
          setStatus({ mode: 'idle', text: 'Refreshed checkboxes and stats.' });
        }, 180);
      });
    });
  });
  document.getElementById('export-json').addEventListener('click', () => exportSelected('json'));
  document.getElementById('export-csv').addEventListener('click', () => exportSelected('csv'));
  document.getElementById('select-filtered').addEventListener('click', () => runFilteredSelection('select'));
  document.getElementById('clear-filtered').addEventListener('click', () => runFilteredSelection('clear'));
  document.getElementById('select-oldest').addEventListener('click', () => runOldestSelection('select'));
  document.getElementById('clear-oldest').addEventListener('click', () => runOldestSelection('clear'));
  document.getElementById('dry-run-preview').addEventListener('click', () => runDryPreview());
  document.getElementById('clear-preview').addEventListener('click', () => { updatePreviewBox([], { message: 'Preview cleared.' }); addLogEntry('Cleared dry run preview.'); });
  document.getElementById('copy-log').addEventListener('click', () => copyLogEntries());
  document.getElementById('clear-log').addEventListener('click', () => { clearLogEntries(); addLogEntry('Cleared operation log.'); });
}

document.addEventListener("DOMContentLoaded", () => {
  initializeButtons();
  loadVersion();
  renderLog();
  setStatus({ mode: 'idle' });
  refreshStats();
  syncAutoAttachState();
  addLogEntry('Popup opened.');
});
