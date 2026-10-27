# Search discovery — hankmarquardt.com

## Current foundation

- Search Console domain property added by site owner (October 2026).
- Static HTML, stable canonical URLs, titles and descriptions, Open Graph and Twitter metadata.
- Generated robots.txt and sitemap.xml; published Field Notes in sitemap and RSS.
- Draft notes excluded entirely; externally canonicalized notes excluded from sitemap.
- Person JSON-LD on the homepage and About page with verified GitHub, YouTube and Substack links.
- CI checks reject every script except the approved analytics tag and Person
  JSON-LD, and validate the structured data.

## Owner follow-up

1. In Google Search Console, submit `https://hankmarquardt.com/sitemap.xml` if it is not already submitted.
2. Inspect the homepage, About page, Work page and one published Field Note; confirm the selected canonical URL and indexing status.
3. After Search Console has accumulated data, review query impressions, indexing warnings and clicks. Publish substantive Field Notes rather than generic keyword-targeted filler.
4. Bing Webmaster Tools is optional and can be deferred.

## Release checks

Run `uv run python -m sitegen build` and `uv run pytest`. The checked build must keep executable JavaScript prohibited except the single approved CFLab Analytics tag (`docs/ANALYTICS.md`), preserve correct canonicals, exclude drafts from feeds/sitemap, emit valid Person JSON-LD on only the homepage and About page, and load no script at all on the 404 page. The existing Actions workflow owns deployment and live verification.

No third-party analytics, advertising or tracking scripts, no bogus credentials, no review markup, no artificial FAQ snippets and no local-business claims. The only measurement is first-party CFLab Analytics, described in [ANALYTICS.md](ANALYTICS.md).
