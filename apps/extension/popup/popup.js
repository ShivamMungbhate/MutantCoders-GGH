// Popup Controller for Digital Pusher Link Guardian

let currentLanguage = 'en';
let activeTabUrl = '';

document.addEventListener('DOMContentLoaded', async () => {
  await initSettings();
  setupEventListeners();
  await checkCurrentTab();
});

/**
 * Initializes settings from background/storage
 */
async function initSettings() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  if (response) {
    currentLanguage = response.language || 'en';
    const toggle = document.getElementById('auto-check-toggle');
    if (toggle) {
      toggle.checked = Boolean(response.autoCheck);
    }
    updateLanguageButtonLabel();
  }
}

/**
 * Sets up user interaction listeners
 */
function setupEventListeners() {
  // Language toggle
  document.getElementById('lang-toggle')?.addEventListener('click', async () => {
    currentLanguage = currentLanguage === 'en' ? 'hi' : 'en';
    updateLanguageButtonLabel();
    await chrome.runtime.sendMessage({
      type: 'SET_SETTINGS',
      settings: { language: currentLanguage }
    });
    // Refresh current check with new language
    if (activeTabUrl) {
      await inspectUrl(activeTabUrl, 'current');
    }
  });

  // "Check This Page" button (always works)
  document.getElementById('check-current-btn')?.addEventListener('click', async () => {
    await checkCurrentTab();
  });

  // "Inspect Pasted Link" button
  document.getElementById('custom-check-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('custom-url-input');
    const val = input ? input.value.trim() : '';
    if (val) {
      await inspectUrl(val, 'custom');
    }
  });

  // Enter key on custom input
  document.getElementById('custom-url-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('custom-check-btn')?.click();
    }
  });

  // Auto-check opt-in toggle
  document.getElementById('auto-check-toggle')?.addEventListener('change', async (e) => {
    const isChecked = e.target.checked;
    await chrome.runtime.sendMessage({
      type: 'SET_SETTINGS',
      settings: { autoCheck: isChecked }
    });
  });

  // Options page link
  document.getElementById('open-options-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });
}

function updateLanguageButtonLabel() {
  const btn = document.getElementById('lang-toggle');
  if (btn) {
    btn.textContent = currentLanguage === 'hi' ? 'हिंदी (Hindi)' : 'English';
  }
}

/**
 * Checks the active tab URL
 */
async function checkCurrentTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !tab.url) {
      showEmptyState('current', 'No active webpage detected.');
      return;
    }

    activeTabUrl = tab.url;

    if (
      activeTabUrl.startsWith('chrome://') ||
      activeTabUrl.startsWith('chrome-extension://') ||
      activeTabUrl.startsWith('edge://') ||
      activeTabUrl.startsWith('about:') ||
      activeTabUrl.startsWith('file://') ||
      activeTabUrl.includes('localhost')
    ) {
      showEmptyState('current', 'Browser system page (not an external website).', activeTabUrl);
      return;
    }

    await inspectUrl(activeTabUrl, 'current');
  } catch (err) {
    showEmptyState('current', 'Unable to inspect current tab.');
  }
}

/**
 * Inspects a URL and renders result into either 'current' or 'custom' containers
 */
async function inspectUrl(url, target) {
  const hostEl = target === 'current' ? document.getElementById('current-host-display') : null;
  const badgeEl = target === 'current' ? document.getElementById('current-badge') : null;
  const badgeText = target === 'current' ? document.getElementById('current-badge-text') : null;
  const explEl = target === 'current' ? document.getElementById('current-explanation') : null;
  const signalsBox = target === 'current' ? document.getElementById('current-signals-box') : null;
  const signalsList = target === 'current' ? document.getElementById('current-signals-list') : null;

  if (target === 'current') {
    if (hostEl) hostEl.textContent = 'Analyzing address...';
    if (badgeText) badgeText.textContent = 'Evaluating...';
  } else {
    const customArea = document.getElementById('custom-result-area');
    if (customArea) {
      customArea.style.display = 'block';
      customArea.innerHTML = '<p class="dp-explanation">Analyzing pasted address...</p>';
    }
  }

  // Request inspection from background service worker
  const res = await chrome.runtime.sendMessage({
    type: 'CHECK_URL',
    url,
    language: currentLanguage
  });

  if (!res) {
    if (target === 'current') {
      showEmptyState('current', 'Unable to connect to analysis service.');
    }
    return;
  }

  renderResult(res, target, url);
}

/**
 * Renders inspection result card
 */
function renderResult(result, target, rawUrl) {
  let displayHost = '';
  try {
    displayHost = new URL(rawUrl.startsWith('http') ? rawUrl : `http://${rawUrl}`).hostname;
  } catch {
    displayHost = rawUrl;
  }

  if (target === 'current') {
    const hostEl = document.getElementById('current-host-display');
    const badgeEl = document.getElementById('current-badge');
    const badgeText = document.getElementById('current-badge-text');
    const explEl = document.getElementById('current-explanation');
    const signalsBox = document.getElementById('current-signals-box');
    const signalsList = document.getElementById('current-signals-list');

    if (hostEl) hostEl.textContent = displayHost;

    if (badgeEl && badgeText) {
      badgeEl.className = 'dp-badge';
      if (result.level === 'high_risk') {
        badgeEl.classList.add('dp-badge-high-risk');
        badgeText.textContent = `High Risk (${result.score}%)`;
      } else if (result.level === 'suspicious') {
        badgeEl.classList.add('dp-badge-suspicious');
        badgeText.textContent = `Suspicious (${result.score}%)`;
      } else {
        badgeEl.classList.add('dp-badge-neutral');
        badgeText.textContent = 'No Warning Signs Found';
      }
    }

    if (explEl) {
      explEl.textContent = result.explanation || '';
    }

    if (signalsBox && signalsList) {
      if (result.signals && result.signals.length > 0) {
        signalsBox.style.display = 'block';
        signalsList.innerHTML = result.signals
          .map((s) => `<li><strong>${escapeHtml(s.name.replace(/_/g, ' '))}:</strong> ${escapeHtml(s.detail)}</li>`)
          .join('');
      } else {
        signalsBox.style.display = 'none';
        signalsList.innerHTML = '';
      }
    }
  } else {
    // Render custom link result
    const customArea = document.getElementById('custom-result-area');
    if (!customArea) return;
    customArea.style.display = 'block';

    let badgeClass = 'dp-badge-neutral';
    let badgeLabel = 'No Warning Signs Found';
    if (result.level === 'high_risk') {
      badgeClass = 'dp-badge-high-risk';
      badgeLabel = `High Risk (${result.score}%)`;
    } else if (result.level === 'suspicious') {
      badgeClass = 'dp-badge-suspicious';
      badgeLabel = `Suspicious (${result.score}%)`;
    }

    const signalsHtml = (result.signals || [])
      .map((s) => `<li><strong>${escapeHtml(s.name.replace(/_/g, ' '))}:</strong> ${escapeHtml(s.detail)}</li>`)
      .join('');

    customArea.innerHTML = `
      <div class="dp-host-name" style="margin-top: 4px;">${escapeHtml(displayHost)}</div>
      <div class="dp-badge ${badgeClass}">
        <span class="dp-badge-dot"></span>
        <span>${escapeHtml(badgeLabel)}</span>
      </div>
      <p class="dp-explanation">${escapeHtml(result.explanation || '')}</p>
      ${
        signalsHtml
          ? `<div class="dp-signals-box">
              <span class="dp-signals-title">Detected Signals:</span>
              <ul class="dp-signals-list">${signalsHtml}</ul>
             </div>`
          : ''
      }
      <p class="dp-disclaimer">* ${escapeHtml(result.disclaimer || 'No warning signs found does not guarantee a site is safe.')}</p>
    `;
  }
}

function showEmptyState(target, message, urlText = '') {
  if (target === 'current') {
    const hostEl = document.getElementById('current-host-display');
    const badgeEl = document.getElementById('current-badge');
    const badgeText = document.getElementById('current-badge-text');
    const explEl = document.getElementById('current-explanation');
    const signalsBox = document.getElementById('current-signals-box');

    if (hostEl) hostEl.textContent = urlText || 'System Page';
    if (badgeEl && badgeText) {
      badgeEl.className = 'dp-badge dp-badge-neutral';
      badgeText.textContent = 'Not an External Site';
    }
    if (explEl) explEl.textContent = message;
    if (signalsBox) signalsBox.style.display = 'none';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
