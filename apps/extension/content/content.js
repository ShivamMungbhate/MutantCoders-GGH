// Content Script for High-Risk Warning Banner

function injectWarningBanner(result, host) {
  // Prevent duplicate banners
  if (document.getElementById('dp-security-banner-root')) return;

  const root = document.createElement('div');
  root.id = 'dp-security-banner-root';

  const signalsHtml = (result.signals || [])
    .map((s) => `<li><strong>${escapeHtml(s.name.replace(/_/g, ' '))}:</strong> ${escapeHtml(s.detail)}</li>`)
    .join('');

  root.innerHTML = `
    <div class="dp-banner-container" role="alert" aria-live="assertive">
      <div class="dp-banner-header">
        <div class="dp-banner-message">
          <span class="dp-banner-icon" aria-hidden="true">⚠️</span>
          <span>Digital Pusher warning: this site shows signs of a fake or risky page. Don't enter passwords, OTPs or payment details.</span>
        </div>
        <div class="dp-banner-actions">
          <button id="dp-btn-why" class="dp-btn dp-btn-why" type="button" aria-expanded="false">
            Why?
          </button>
          <button id="dp-btn-dismiss" class="dp-btn dp-btn-dismiss" type="button">
            Dismiss for this site
          </button>
        </div>
      </div>
      <div id="dp-details-panel" class="dp-details-panel">
        <p><strong>Guardian Explanation:</strong> ${escapeHtml(result.explanation || 'Deceptive patterns detected.')}</p>
        <ul class="dp-signals-list">
          ${signalsHtml}
        </ul>
        <p style="margin-top: 8px; font-size: 11px; opacity: 0.85;">
          ${escapeHtml(result.disclaimer || 'No warning signs found does not guarantee a site is safe.')}
        </p>
      </div>
    </div>
  `;

  // Prepend to top of document body
  if (document.body) {
    document.body.prepend(root);
  } else {
    document.documentElement.prepend(root);
  }

  // Toggle "Why?" breakdown
  const whyBtn = root.querySelector('#dp-btn-why');
  const detailsPanel = root.querySelector('#dp-details-panel');
  if (whyBtn && detailsPanel) {
    whyBtn.addEventListener('click', () => {
      const isVisible = detailsPanel.classList.toggle('dp-visible');
      whyBtn.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
      whyBtn.textContent = isVisible ? 'Hide details' : 'Why?';
    });
  }

  // Dismiss banner button
  const dismissBtn = root.querySelector('#dp-btn-dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      root.remove();
      try {
        chrome.runtime.sendMessage({
          type: 'DISMISS_HOST',
          host: host || window.location.hostname
        });
      } catch (err) {
        // Background message failed
      }
    });
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

// Listen for background service worker message
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SHOW_WARNING_BANNER' && message.result) {
    injectWarningBanner(message.result, message.host);
  }
});
