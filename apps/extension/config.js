// Digital Pusher Extension Configuration and Client-Side Heuristics

export const CONFIG = {
  DEFAULT_API_BASE: 'http://localhost:4000/api',
  DEFAULT_LANGUAGE: 'en',
  CACHE_TTL_MS: 60 * 60 * 1000, // 1 hour
  LOCAL_CHECK_THRESHOLD: 15 // Run local heuristics first; only call API if score >= 15 or in doubt
};

export const BRANDS = [
  { name: 'State Bank of India', keywords: ['sbi', 'onlinesbi'], officialDomains: ['sbi.co.in', 'onlinesbi.sbi', 'onlinesbi.com'] },
  { name: 'HDFC Bank', keywords: ['hdfc', 'hdfcbank'], officialDomains: ['hdfcbank.com', 'hdfc.com'] },
  { name: 'ICICI Bank', keywords: ['icici', 'icicibank'], officialDomains: ['icicibank.com'] },
  { name: 'Axis Bank', keywords: ['axisbank', 'axisb'], officialDomains: ['axisbank.com'] },
  { name: 'Paytm', keywords: ['paytm'], officialDomains: ['paytm.com'] },
  { name: 'PhonePe', keywords: ['phonepe'], officialDomains: ['phonepe.com'] },
  { name: 'Google', keywords: ['google', 'gmail'], officialDomains: ['google.com', 'google.co.in', 'gmail.com'] },
  { name: 'Amazon', keywords: ['amazon'], officialDomains: ['amazon.com', 'amazon.in'] },
  { name: 'Flipkart', keywords: ['flipkart'], officialDomains: ['flipkart.com'] },
  { name: 'India Post', keywords: ['indiapost'], officialDomains: ['indiapost.gov.in'] },
  { name: 'UIDAI (Aadhaar)', keywords: ['uidai', 'aadhaar'], officialDomains: ['uidai.gov.in'] },
  { name: 'Income Tax Department', keywords: ['incometax'], officialDomains: ['incometax.gov.in'] },
  { name: 'Apple', keywords: ['apple', 'icloud'], officialDomains: ['apple.com', 'icloud.com'] },
  { name: 'Microsoft', keywords: ['microsoft', 'outlook'], officialDomains: ['microsoft.com', 'live.com', 'office.com', 'outlook.com'] },
  { name: 'Netflix', keywords: ['netflix'], officialDomains: ['netflix.com'] },
  { name: 'WhatsApp', keywords: ['whatsapp'], officialDomains: ['whatsapp.com'] }
];

export const KNOWN_SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'is.gd',
  'buff.ly',
  'ow.ly',
  'rebrand.ly',
  'cutt.ly',
  'tiny.cc',
  'shorturl.at',
  'rb.gy',
  'qr.ae',
  'v.gd'
]);

export const HIGH_RISK_KEYWORDS = [
  'kyc',
  'verify',
  'verification',
  'update',
  'refund',
  'reward',
  'login',
  'signin',
  'banking',
  'secure',
  'support',
  'otp',
  'password',
  'authenticate',
  'wallet',
  'claim'
];

/**
 * Normalizes input URL, strictly dropping paths, query strings, and fragments.
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  const hasAtSymbol = trimmed.includes('@');

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `http://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    const scheme = parsed.protocol.replace(':', '').toLowerCase() === 'https' ? 'https' : 'http';
    const host = parsed.hostname.toLowerCase();
    const hasCredentials = hasAtSymbol || Boolean(parsed.username || parsed.password);
    return { scheme, host, hasCredentials };
  } catch {
    const clean = candidate.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
    return {
      scheme: candidate.startsWith('https://') ? 'https' : 'http',
      host: clean.toLowerCase(),
      hasCredentials: hasAtSymbol
    };
  }
}

/**
 * Fast client-side heuristics executed directly in browser without network latency.
 */
export function evaluateLocalHeuristics(scheme, host, hasCredentials) {
  const signals = [];

  // 1. Raw IP address host
  const isIpv4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(host);
  const isIpv6 = host.startsWith('[') || /^[0-9a-fA-F:]+$/.test(host);
  if (isIpv4 || isIpv6) {
    signals.push({
      name: 'ip_address_host',
      detail: 'Host is a raw IP address instead of a standard domain name',
      weight: 35
    });
  }

  // 2. Punycode or mixed-script / lookalike characters
  if (host.includes('xn--') || /[^\x00-\x7F]/.test(host)) {
    signals.push({
      name: 'punycode_lookalike',
      detail: 'Host contains punycode or lookalike characters commonly used in spoofing attacks',
      weight: 35
    });
  }

  // 3. Embedded credentials or '@' symbol
  if (hasCredentials) {
    signals.push({
      name: 'embedded_credentials',
      detail: "URL contains an '@' symbol or credentials used to mask destination",
      weight: 30
    });
  }

  // 4. Excessive subdomains
  const labels = host.split('.').filter(Boolean);
  if (labels.length >= 5) {
    signals.push({
      name: 'excessive_subdomains',
      detail: `Domain has an unusually deep subdomain structure (${labels.length} levels)`,
      weight: 20
    });
  }

  // 5. Brand impersonation
  let isOfficial = false;
  for (const b of BRANDS) {
    if (b.officialDomains.some((d) => host === d || host.endsWith(`.${d}`))) {
      isOfficial = true;
      break;
    }
  }

  if (!isOfficial) {
    for (const b of BRANDS) {
      const match = b.keywords.some((kw) => {
        const regex = new RegExp(`(^|[.-])${kw}([.-]|$)`, 'i');
        return regex.test(host) || host.includes(kw);
      });
      if (match) {
        signals.push({
          name: 'brand_impersonation',
          detail: `Domain contains brand identifier '${b.name}' but is not an official ${b.name} domain`,
          weight: 45
        });
        break;
      }
    }
  }

  // 6. URL shorteners
  if (Array.from(KNOWN_SHORTENERS).some((s) => host === s || host.endsWith(`.${s}`))) {
    signals.push({
      name: 'url_shortener',
      detail: 'URL shortener masks the destination website',
      weight: 15
    });
  }

  // 7. Excessive length
  if (host.length > 50) {
    signals.push({
      name: 'excessive_length',
      detail: `Host name is unusually long (${host.length} characters)`,
      weight: 15
    });
  }

  // 8. HTTP instead of HTTPS
  if (scheme === 'http') {
    signals.push({
      name: 'insecure_http',
      detail: 'Connection uses unencrypted HTTP instead of secure HTTPS',
      weight: 15
    });
  }

  // 9. Sensitive action keywords on non-brand domain
  if (!isOfficial) {
    const matchedKw = HIGH_RISK_KEYWORDS.find((kw) => {
      const regex = new RegExp(`(^|[.-])${kw}([.-]|$)`, 'i');
      return regex.test(host) || host.includes(kw);
    });
    if (matchedKw) {
      signals.push({
        name: 'suspicious_keywords',
        detail: `Domain uses sensitive action keyword '${matchedKw}' on an unofficial domain`,
        weight: 20
      });
    }
  }

  const rawScore = signals.reduce((sum, s) => sum + s.weight, 0);
  const score = Math.min(100, Math.max(0, rawScore));

  return { signals, score, isOfficial };
}
