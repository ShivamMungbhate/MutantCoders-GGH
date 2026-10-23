import { CONFIG, normalizeUrl, evaluateLocalHeuristics } from '../config.js';

// In-memory set of dismissed hosts for current browser session
const dismissedHostsInSession = new Set();

/**
 * Retrieves extension settings from storage.
 */
async function getSettings() {
  const defaults = {
    autoCheck: false, // OFF by default as required
    apiBase: CONFIG.DEFAULT_API_BASE,
    language: CONFIG.DEFAULT_LANGUAGE,
    ignoreList: ['google.com', 'youtube.com', 'github.com']
  };

  try {
    const stored = await chrome.storage.local.get(Object.keys(defaults));
    return { ...defaults, ...stored };
  } catch (err) {
    return defaults;
  }
}

/**
 * Sets toolbar badge for a specific tab.
 */
function updateBadge(tabId, level) {
  if (!tabId || tabId < 0) return;

  if (level === 'high_risk') {
    chrome.action.setBadgeText({ tabId, text: '!' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#DC2626' }); // Red
  } else if (level === 'suspicious') {
    chrome.action.setBadgeText({ tabId, text: '?' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#D97706' }); // Amber
  } else {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
}

/**
 * Checks cache for a given host (1-hour TTL).
 */
async function getCachedResult(host) {
  try {
    const key = `dp_cache_${host}`;
    const data = await chrome.storage.local.get(key);
    const cached = data[key];
    if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_TTL_MS) {
      return cached.result;
    }
  } catch (err) {
    // Cache miss or error
  }
  return null;
}

/**
 * Saves a result to local cache.
 */
async function setCachedResult(host, result) {
  try {
    const key = `dp_cache_${host}`;
    await chrome.storage.local.set({
      [key]: {
        result,
        timestamp: Date.now()
      }
    });
  } catch (err) {
    // Ignore cache write errors
  }
}

/**
 * Checks a URL against the API (or returns cached).
 * GUARANTEE: Never sends page contents, cookies, or path/query strings.
 */
async function checkUrl(rawUrl, requestedLang = null) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) {
    return {
      level: 'no_warning_signs',
      score: 0,
      signals: [],
      explanation: 'Could not parse website address.',
      disclaimer: 'No warning signs found does not guarantee a site is safe.'
    };
  }

  const { scheme, host } = normalized;

  // Check 1-hour cache first
  const cached = await getCachedResult(host);
  if (cached) {
    return cached;
  }

  const settings = await getSettings();
  const language = requestedLang || settings.language || 'en';
  const apiBase = settings.apiBase || CONFIG.DEFAULT_API_BASE;

  try {
    const endpoint = `${apiBase}/link-check`;
    // Only send scheme + host; NEVER path or query
    const targetUrl = `${scheme}://${host}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl, language })
    });

    if (res.ok) {
      const data = await res.json();
      await setCachedResult(host, data);
      return data;
    }
  } catch (err) {
    // If API is unreachable, fall back to client-side heuristics
  }

  // Client-side fallback if backend API is not running
  const local = evaluateLocalHeuristics(scheme, host, normalized.hasCredentials);
  let level = 'no_warning_signs';
  if (local.score >= 50 || local.signals.some((s) => s.name === 'brand_impersonation')) {
    level = 'high_risk';
  } else if (local.score >= 20) {
    level = 'suspicious';
  }

  const fallbackResult = {
    level,
    score: level === 'no_warning_signs' ? 0 : local.score,
    signals: local.signals.map((s) => ({ name: s.name, detail: s.detail })),
    explanation:
      level === 'high_risk'
        ? 'This web address shows warning signs commonly associated with deceptive websites or brand impersonation. Do not enter passwords or banking details.'
        : level === 'suspicious'
        ? 'This link exhibits caution indicators (such as an unencrypted HTTP connection). Verify before proceeding.'
        : 'No suspicious structural patterns or brand impersonation were detected in this domain name.',
    disclaimer: 'No warning signs found does not guarantee a site is safe.'
  };

  await setCachedResult(host, fallbackResult);
  return fallbackResult;
}

/**
 * Opt-in Auto-check on navigation.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only check once page is loading or complete with a valid URL
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  const currentUrl = tab.url || changeInfo.url;
  if (!currentUrl) return;

  // Skip internal or local addresses
  if (
    currentUrl.startsWith('chrome://') ||
    currentUrl.startsWith('chrome-extension://') ||
    currentUrl.startsWith('edge://') ||
    currentUrl.startsWith('about:') ||
    currentUrl.startsWith('file://') ||
    currentUrl.includes('localhost') ||
    currentUrl.includes('127.0.0.1')
  ) {
    updateBadge(tabId, 'no_warning_signs');
    return;
  }

  const settings = await getSettings();
  if (!settings.autoCheck) {
    // Auto-check is OFF: do not perform background scans on navigation
    return;
  }

  const normalized = normalizeUrl(currentUrl);
  if (!normalized) return;
  const { scheme, host, hasCredentials } = normalized;

  // Check user-editable ignore list
  if (settings.ignoreList && settings.ignoreList.some((ignored) => host === ignored || host.endsWith(`.${ignored}`))) {
    updateBadge(tabId, 'no_warning_signs');
    return;
  }

  // Run local heuristics first
  const local = evaluateLocalHeuristics(scheme, host, hasCredentials);

  // If local score passes threshold (score >= 15 or brand impersonation), query API / cache
  if (local.score >= CONFIG.LOCAL_CHECK_THRESHOLD || local.signals.length > 0) {
    const result = await checkUrl(currentUrl);
    updateBadge(tabId, result.level);

    if (result.level === 'high_risk' && !dismissedHostsInSession.has(host)) {
      try {
        chrome.tabs.sendMessage(tabId, {
          type: 'SHOW_WARNING_BANNER',
          result,
          host
        });
      } catch (err) {
        // Tab content script not yet ready or restricted
      }
    }
  } else {
    updateBadge(tabId, 'no_warning_signs');
  }
});

/**
 * Tab activation listener: restore badge for current tab
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab.url) return;
    const normalized = normalizeUrl(tab.url);
    if (normalized) {
      const cached = await getCachedResult(normalized.host);
      if (cached) {
        updateBadge(activeInfo.tabId, cached.level);
      }
    }
  } catch (err) {
    // Ignore tab lookup errors
  }
});

/**
 * Message Handler
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_URL') {
    checkUrl(message.url, message.language).then((res) => {
      if (sender.tab?.id) {
        updateBadge(sender.tab.id, res.level);
      }
      sendResponse(res);
    });
    return true; // Keep sendResponse open for async resolution
  }

  if (message.type === 'DISMISS_HOST') {
    if (message.host) {
      dismissedHostsInSession.add(message.host);
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    getSettings().then((s) => sendResponse(s));
    return true;
  }

  if (message.type === 'SET_SETTINGS') {
    chrome.storage.local.set(message.settings).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'CLEAR_CACHE') {
    chrome.storage.local.clear().then(() => {
      dismissedHostsInSession.clear();
      sendResponse({ success: true });
    });
    return true;
  }
});
