# First-party analytics

This site ships exactly one client-side script. On 2026-10-27 the owner lifted the
previous blanket ban on JavaScript so that hankmarquardt.com could be measured by
CFLab Analytics, the same first-party collector the owner's other sites use. Nothing
else was opened up: there is still no framework, no advertising or third-party
tracker, no inline script, no event handler and no cookie.

## The one allowed script

```html
<script defer src="https://analytics.aismallbizguru.com/script.js"
  data-site="as_LSLKDIyn2pzUxJFLdLjLhj"></script>
```

It is emitted once by `templates/base.html` on every public page (home, Work, Field
Notes index, each note, About, Elsewhere) and **not** on `404.html`: a missing path is
not a page view worth recording. The deferred attribute keeps it off the critical
path — the page renders before the script runs.

The identifier, the origin and the allowed attribute set live in one place,
`sitegen/config.py` (`ANALYTICS_ORIGIN`, `ANALYTICS_SCRIPT_URL`, `ANALYTICS_SITE_ID`),
and are imported by the checker, the production smoke test and the test suite. Change
the script only by changing that constant and every consumer together.

## The allowlist, in four places

A `<script>` tag is accepted only when it is one of two things:

1. `application/ld+json` Person structured data with no other attribute (a data
   block, never executed), or
2. the exact analytics tag above — `src`, `data-site` and `defer`, nothing more.

That rule is enforced at every gate, so a regression cannot reach production:

| Gate | What it rejects |
| --- | --- |
| `sitegen/checks.py` | inline script, another origin, wrong site id, extra attribute, duplicate tag, any script on the 404 page; also keeps the existing “exactly one Person JSON-LD on home and About” rule |
| `tests/test_build.py` | the same rules over every generated page, plus the exact tag text and a valid `@type: Person` block |
| `tests/test_checks.py` | each rejection above, one test per failure mode |
| `scripts/verify_production.py` | after deploy: the expected number of `<script>` tags per page, exactly one approved tag, Person JSON-LD on home and About, and the CSP directives below |

## Content Security Policy

`src/worker.mjs` attaches this CSP to every response, including redirects and the 404
page:

```text
default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self';
script-src https://analytics.aismallbizguru.com;
connect-src https://analytics.aismallbizguru.com;
base-uri 'none'; form-action 'none'; frame-ancestors 'none';
upgrade-insecure-requests
```

`script-src` and `connect-src` name that one origin and nothing else — no `'self'`,
no `'unsafe-inline'`, no `'unsafe-eval'`, no wildcard, no `http:`. The beacon is a
`fetch` to the same origin, which is why `connect-src` is needed. Person JSON-LD needs
no `script-src` allowance: browsers treat `type="application/ld+json"` as data, not
executable script, and adding `'unsafe-inline'` for it would weaken the policy without
any benefit.

## Privacy properties

The script is served by the CFLab Analytics Worker and reports to the owner's own
infrastructure — there is no advertising network, no data broker and no third-party
processor in the path.

- No cookie, no `localStorage`, no persistent identifier, no fingerprint.
- The anonymous session id lives in `sessionStorage` and rotates after 30 minutes of
  inactivity; closing the tab ends it.
- The payload carries the pathname (never the query string), the session id, an event
  id, the referrer URL (which the collector reduces to a host and never stores in full)
  and UTM parameters when present.
- The server stores no IP address, no user agent, no page content and no precise
  location; it derives only coarse values.
- Do Not Track and Global Privacy Control are honoured twice: the script sends nothing,
  and the site's collector record (`respect_dnt`, `respect_gpc`) also refuses the
  request server-side.
- The collector only accepts a post whose origin is registered to this site
  (`hankmarquardt.com`, `www.hankmarquardt.com`), so the tag cannot be replayed as
  another site.

## What it does not replace

Search Console is collected server-to-server for `sc-domain:hankmarquardt.com` and is
independent of this script: daily impressions, clicks, CTR and average position arrive
whether or not a browser ever loads the beacon. First-party pageviews and Google's
search metrics answer different questions and are never added together.

## Turning it off

Remove the `analytics` include from `templates/base.html` (or gate it off) and run the
build and tests; the checker will report the missing tag until the expectation is
updated in the same change. The CSP origin can then be dropped from `src/worker.mjs`.
No data migration is involved, and Search Console collection continues.
