# Digital Pusher: Link Guardian (Chrome Extension MVP)

**Manifest V3 Browser Extension for Real-Time Link Risk & Scam Protection**

Digital Pusher: Link Guardian helps users, especially seniors and families, avoid deceptive phishing portals, fake banking lookalikes, and credential theft traps before entering sensitive information.

---

## Privacy-First Architecture

- **Zero History Storage**: The extension and backend NEVER record or store browsing history, visited URLs, or timestamps.
- **URL Normalization**: Before analysis or local evaluation, the URL is strictly stripped to `scheme + host` (e.g. `https://example.com`). All paths, parameters, queries, and fragments (`/login?token=xyz#secret`) are completely dropped.
- **No Page Scraping**: The extension never reads form entries, passwords, OTP fields, or webpage DOM contents.
- **"Safe" Vocabulary Guarantee**: The extension and backend strictly avoid false assurances; they never output the word "safe". Clean domains return `"no_warning_signs"` with the advisory:
  > *"No warning signs found does not guarantee a site is safe."*
- **Local Fallback Heuristics**: If the backend API is offline, client-side heuristics immediately evaluate brand spoofing, IP addresses, shorteners, punycode, and insecure protocols locally.

---

## How to Load and Test Locally

### 1. Prerequisites
Ensure the Digital Pusher API is running on port 4000:
```bash
cd apps/api
npm run dev
```

### 2. Load Unpacked in Google Chrome
1. Open Google Chrome.
2. In the URL address bar, navigate to:
   ```text
   chrome://extensions
   ```
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left toolbar.
5. In the file picker dialog, navigate to and select this folder:
   ```text
   C:\Users\shiva\.gemini\antigravity\scratch\digital-pusher\apps\extension
   ```
6. The **Digital Pusher: Link Guardian** extension will appear in your installed extensions list.
7. Click the extension puzzle icon in the Chrome toolbar and pin **Digital Pusher** for easy access.

---

## Extension Structure

```text
apps/extension/
├── manifest.json              # Chrome Extension Manifest V3 configuration
├── config.js                  # Client heuristics, brand definitions, and constants
├── README.md                  # Setup and usage guide
├── background/
│   └── service-worker.js     # Background worker, caching, tab listeners, and badge updater
├── content/
│   ├── content.js             # High-risk warning banner injector
│   └── content.css            # High-contrast accessible warning styles
├── popup/
│   ├── popup.html             # Extension popup UI
│   ├── popup.js               # Popup interactions, language toggling, link inspector
│   └── popup.css              # Popup styling
├── options/
│   ├── options.html           # Settings UI (API endpoint, language, ignore list)
│   └── options.js             # Settings persistence
└── icons/
    ├── icon16.png             # 16x16 icon
    ├── icon48.png             # 48x48 icon
    └── icon128.png            # 128x128 icon
```

---

## 5 Demo Test URLs

You can test any URL directly by pasting it into the **Check Any Pasted Link** input inside the extension popup:

| # | Test URL | Expected Level | Explanation / Signals |
|---|---|---|---|
| 1 | `http://sbi-kyc-verify-portal.com/login?token=abc` | **High Risk** | Brand impersonation (`SBI`), sensitive action keyword (`kyc`), insecure HTTP |
| 2 | `http://192.168.1.100/banking/update` | **High Risk** | Raw IP address host, sensitive action keyword (`banking`), insecure HTTP |
| 3 | `https://paytm-security-reward.net/claim?id=99281` | **High Risk** | Brand impersonation (`Paytm`), sensitive keyword (`reward`) on unofficial domain |
| 4 | `https://www.wikipedia.org/wiki/Computer_security` | **No Warning Signs Found** | Legitimate reference domain with standard structure |
| 5 | `https://retail.onlinesbi.sbi/retail/login.htm` | **No Warning Signs Found** | Verified official domain of State Bank of India |
