/**
 * hankmarquardt.com site Worker.
 *
 * The site is static. This Worker exists for three reasons only:
 *   1. canonicalise the host (www -> apex, http -> https),
 *   2. keep old page paths working (they were pages in the retired Streamlit app),
 *   3. attach security headers to every response.
 *
 * Assets are served by the Workers Static Assets binding (`env.ASSETS`).
 */

const APEX = 'hankmarquardt.com';
const WWW = `www.${APEX}`;

/** Old Streamlit page paths, kept as permanent redirects. */
const LEGACY_PATHS = new Map([
  ['/home', '/'],
  ['/youtube', '/elsewhere/'],
  ['/substack', '/elsewhere/'],
]);

// One script is allowed, from one origin, and it may only talk back to that same
// origin: first-party CFLab Analytics (docs/ANALYTICS.md). `script-src` names the
// Analytics Worker and nothing else, so inline code, other origins and 'self' stay
// blocked; `connect-src` permits the pageview beacon and no other fetch. The Person
// JSON-LD needs no allowance here because a `type="application/ld+json"` block is
// data, not executable script, and browsers do not apply script-src to it. Everything
// else remains default-src 'none'.
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; " +
    "script-src https://analytics.aismallbizguru.com; " +
    "connect-src https://analytics.aismallbizguru.com; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/**
 * Resolve the canonical URL for a request that must move, or null to serve it.
 * Exported so the redirect rules can be tested without a running Worker.
 */
export function canonicalRedirect(requestUrl) {
  const url = new URL(requestUrl);
  const hostname = url.hostname.toLowerCase();
  // Only the production hosts are canonicalised; wrangler dev on 127.0.0.1 and
  // the workers.dev preview must stay reachable over plain http.
  const needsHttps = hostname === APEX && url.protocol === 'http:';
  const needsApex = hostname === WWW;
  if (!needsHttps && !needsApex) return null;

  const target = new URL(url.toString());
  target.protocol = 'https:';
  target.hostname = APEX;
  target.port = '';
  target.hash = '';
  return target.toString();
}

/** Legacy path redirect target, ignoring a trailing slash. */
export function legacyRedirect(pathname) {
  if (pathname.length > 1) {
    const trimmed = pathname.replace(/\/+$/, '');
    if (LEGACY_PATHS.has(trimmed)) return LEGACY_PATHS.get(trimmed);
  }
  if (LEGACY_PATHS.has(pathname)) return LEGACY_PATHS.get(pathname);
  return null;
}

export function secure(response, url) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if (url.protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');

  const contentType = headers.get('Content-Type') || '';
  if (contentType.includes('text/html')) {
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate, no-transform');
  }
  if (url.pathname === '/version.json') headers.set('Cache-Control', 'no-store');
  if (url.hostname.endsWith('.workers.dev')) headers.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function plain(text, status, extraHeaders = {}) {
  return new Response(`${text}\n`, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const canonical = canonicalRedirect(url.toString());
    if (canonical) {
      return secure(Response.redirect(canonical, 308), new URL(canonical));
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return secure(plain('This site is read-only.', 405, { Allow: 'GET, HEAD' }), url);
    }

    const legacy = legacyRedirect(url.pathname);
    if (legacy) {
      return secure(Response.redirect(new URL(legacy, `https://${APEX}`).toString(), 301), url);
    }

    const asset = await env.ASSETS.fetch(request);
    return secure(asset, url);
  },
};
