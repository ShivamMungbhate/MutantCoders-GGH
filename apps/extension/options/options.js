document.addEventListener('DOMContentLoaded', async () => {
  const apiInput = document.getElementById('api-base-input');
  const langSelect = document.getElementById('language-select');
  const ignoreInput = document.getElementById('ignore-list-input');
  const form = document.getElementById('settings-form');
  const alertEl = document.getElementById('save-alert');
  const clearCacheBtn = document.getElementById('clear-cache-btn');

  // Load current settings
  const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  if (settings) {
    if (apiInput) apiInput.value = settings.apiBase || 'http://localhost:4000/api';
    if (langSelect) langSelect.value = settings.language || 'en';
    if (ignoreInput && Array.isArray(settings.ignoreList)) {
      ignoreInput.value = settings.ignoreList.join('\n');
    }
  }

  // Save settings
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const updated = {
      apiBase: apiInput?.value.trim() || 'http://localhost:4000/api',
      language: langSelect?.value || 'en',
      ignoreList: (ignoreInput?.value || '')
        .split('\n')
        .map((line) => line.trim().toLowerCase())
        .filter(Boolean)
    };

    await chrome.runtime.sendMessage({
      type: 'SET_SETTINGS',
      settings: updated
    });

    if (alertEl) {
      alertEl.style.display = 'block';
      setTimeout(() => {
        alertEl.style.display = 'none';
      }, 2500);
    }
  });

  // Clear cache
  clearCacheBtn?.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
    alert('Local 1-hour link cache cleared successfully.');
  });
});
