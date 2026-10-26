---
title: "Building an Independent Site on Cloudflare Without a Framework"
date: 2026-10-26
description: "Draft outline, not published. A technical note about replacing a Streamlit app with static files, a Python build, and a Cloudflare Worker that does almost nothing."
tags: [cloudflare, static sites, python, tooling]
status: draft
---

**Status: draft outline. Not published, not rendered, not in the feed or sitemap.**
Everything below is implemented in this repository; the outline records what is worth
explaining and which measurements still need to be taken.

## The starting point

- A Streamlit multipage app: three pages, one HTML block, two RSS feeds fetched at
  runtime.
- Why it had to go: no stable URLs or metadata worth citing, a runtime for a page that
  never changes per visitor, and dependencies that age badly.
- What was actually worth keeping: the feeds, the writing, and the URLs other people
  already link to. (List the verified old URLs before retiring anything.)

## The shape of the replacement

- Static files, semantic HTML, one stylesheet, no client JavaScript.
- A Python build with three pinned runtime dependencies: Jinja2, markdown-it-py, PyYAML.
- Cloudflare Workers Static Assets for hosting, with a Worker whose only jobs are
  canonical host redirects, security headers, and a `version.json` for release proof.
- No D1, KV, R2, queues, cron triggers, or secrets at runtime.

## Content pipeline

- `content/notes/*.md` with YAML front matter: title, date, description, tags, status,
  optional canonical.
- Drafts are loaded and validated but never written; the build reports them.
- Markdown rendered with raw HTML disabled; link and image targets validated after
  parsing, because Markdown can hide a URL until it is resolved.
- Generated: article pages, notes index, RSS, sitemap, robots, 404, version manifest.
- Determinism: no build timestamps, sorted inputs, and a test that builds twice and
  compares every byte.

## Safety decisions worth explaining

- Output directory refuses to delete anything it did not create (marker file).
- Slugs are validated, reserved names rejected, duplicates refused case-insensitively.
- Published notes dated in the future fail the build rather than publishing early.
- Feed snapshots are committed and validated against an allowlist of hosts; the build
  never needs the network, so an outage cannot break a deploy.

## Deployment and rollback

- Push to `main`: validate, build, check, deploy, verify the live revision.
- Pinned Wrangler, pinned GitHub Actions, least-privilege Cloudflare token in repository
  secrets.
- Rollback is a Git revert plus the same pipeline; Wrangler versions remain available
  as a second lever.
- A local Wrangler login is used only to bootstrap the first deploy, never copied into
  CI as an unattended credential.

## What to measure before publishing

- [ ] Response time for the Worker path versus plain static assets (same region, cold
      and warm).
- [ ] Build time for the full site and for one note.
- [ ] Number of bytes shipped for the homepage, with and without the stylesheet.
- [ ] A short section on what I would do differently at ten times the content.

## Before publishing

- [ ] Confirm any number above is measured, not estimated.
- [ ] Link the repository and the live site.
- [ ] Set `status: published` only after the draft has been reviewed.
