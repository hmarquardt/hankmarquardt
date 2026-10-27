import test from 'node:test';
import assert from 'node:assert/strict';

import worker, { canonicalRedirect, legacyRedirect } from '../src/worker.mjs';

const ASSET_HTML = '<!doctype html><html lang="en"><title>ok</title></html>';

function environment({ body = ASSET_HTML, status = 200, headers = {} } = {}) {
  return {
    ASSETS: {
      fetch: async (request) =>
        new Response(request.method === 'HEAD' ? null : body, {
          status,
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers },
        }),
    },
  };
}

function request(url, init = {}) {
  return worker.fetch(new Request(url, init), environment());
}

test('www is a permanent redirect to the apex, path and query preserved', async () => {
  const response = await request('https://www.hankmarquardt.com/work/?ref=feed');
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), 'https://hankmarquardt.com/work/?ref=feed');
});

test('plain http is upgraded to https', async () => {
  const response = await request('http://hankmarquardt.com/about/');
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), 'https://hankmarquardt.com/about/');
});

test('the canonical origin is served from the asset binding', async () => {
  const response = await request('https://hankmarquardt.com/');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), ASSET_HTML);
});

test('legacy Streamlit page paths redirect permanently', async () => {
  for (const [path, target] of [
    ['/youtube', 'https://hankmarquardt.com/elsewhere/'],
    ['/youtube/', 'https://hankmarquardt.com/elsewhere/'],
    ['/substack', 'https://hankmarquardt.com/elsewhere/'],
    ['/home', 'https://hankmarquardt.com/'],
  ]) {
    const response = await request(`https://hankmarquardt.com${path}`);
    assert.equal(response.status, 301, path);
    assert.equal(response.headers.get('location'), target, path);
  }
});

test('unknown paths fall through to the assets 404 page', async () => {
  const response = await worker.fetch(
    new Request('https://hankmarquardt.com/nope/'),
    environment({ body: '<h1>Not found</h1>', status: 404 }),
  );
  assert.equal(response.status, 404);
  assert.equal(await response.text(), '<h1>Not found</h1>');
});

test('only GET and HEAD are allowed', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const response = await request('https://hankmarquardt.com/', { method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
});

test('security headers are attached to every response', async () => {
  const response = await request('https://hankmarquardt.com/');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(response.headers.get('content-security-policy'), /form-action 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(response.headers.get('permissions-policy'), /geolocation=\(\)/);
  assert.match(response.headers.get('strict-transport-security'), /max-age=31536000/);
  assert.match(response.headers.get('cache-control'), /no-transform/);
});

test('the CSP allows the approved analytics origin and nothing else', async () => {
  const csp = (await request('https://hankmarquardt.com/')).headers.get('content-security-policy');
  const directive = name =>
    csp.split(';').map(part => part.trim()).find(part => part.startsWith(`${name} `));

  // Still closed by default: the analytics origin is the only addition.
  assert.equal(directive('default-src'), "default-src 'none'");
  assert.equal(directive('script-src'), 'script-src https://analytics.aismallbizguru.com');
  assert.equal(directive('connect-src'), 'connect-src https://analytics.aismallbizguru.com');
  assert.equal(directive('frame-ancestors'), "frame-ancestors 'none'");
  assert.equal(directive('form-action'), "form-action 'none'");
  assert.equal(directive('base-uri'), "base-uri 'none'");

  // No keyword, wildcard or insecure scheme may appear next to the one origin.
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(csp, /\*/);
  assert.doesNotMatch(csp, /http:\/\//);
  assert.doesNotMatch(csp, /script-src[^;]*'(self|none)'/);
  // Person JSON-LD is a data block, not executable script, so it needs no
  // script-src allowance and must not be the reason for one.
  assert.equal(csp.match(/analytics\.aismallbizguru\.com/g).length, 2);
});

test('redirects carry the same security headers', async () => {
  const response = await request('https://www.hankmarquardt.com/');
  assert.equal(response.status, 308);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('the release manifest is never cached', async () => {
  const response = await worker.fetch(
    new Request('https://hankmarquardt.com/version.json'),
    environment({ headers: { 'Content-Type': 'application/json' } }),
  );
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('workers.dev cannot be indexed', async () => {
  const response = await worker.fetch(
    new Request('https://hankmarquardt.workers.dev/'),
    environment(),
  );
  assert.equal(response.headers.get('x-robots-tag'), 'noindex');
});

test('canonicalRedirect only fires for non-canonical hosts and schemes', () => {
  assert.equal(canonicalRedirect('https://hankmarquardt.com/work/'), null);
  assert.equal(
    canonicalRedirect('https://www.hankmarquardt.com/work/'),
    'https://hankmarquardt.com/work/',
  );
  assert.equal(canonicalRedirect('http://hankmarquardt.com/'), 'https://hankmarquardt.com/');
  assert.equal(canonicalRedirect('http://127.0.0.1:8787/'), null);
  assert.equal(canonicalRedirect('http://localhost:8787/'), null);
  assert.equal(canonicalRedirect('https://hankmarquardt.workers.dev/'), null);
});

test('legacyRedirect ignores trailing slashes but not prefixes', () => {
  assert.equal(legacyRedirect('/youtube'), '/elsewhere/');
  assert.equal(legacyRedirect('/youtube/'), '/elsewhere/');
  assert.equal(legacyRedirect('/youtube-channel'), null);
  assert.equal(legacyRedirect('/'), null);
});
