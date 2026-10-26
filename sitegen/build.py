"""Render the static site into an output directory.

Design rules enforced here:
  * only published notes are written, indexed, fed or sitemapped;
  * every output path is computed from validated slugs;
  * the output directory is emptied only when it is marked as build output;
  * no timestamps, network calls or random ordering enter the output.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from . import config
from .content import Note, discover_notes, draft_notes, load_notes, published_notes
from .errors import BuildError
from .feeds import FeedSnapshot, load_snapshot
from .projects import GROUPS, PROJECTS, by_group, featured

SITEMAP_PATHS = ("/", "/work/", "/notes/", "/about/", "/elsewhere/")


@dataclass(frozen=True)
class BuildResult:
    out: Path
    pages: tuple[str, ...]
    published: tuple[Note, ...]
    drafts: tuple[Note, ...]
    feed_problems: tuple[str, ...]
    commit: str


def resolve_commit(explicit: str | None = None) -> str:
    """A build artifact may name its commit but never invent a timestamp."""

    if explicit:
        return explicit.strip() or "uncommitted"
    import os

    from_env = os.environ.get("GITHUB_SHA") or os.environ.get("SITE_COMMIT")
    if from_env:
        return from_env.strip()
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return "uncommitted"
    return result.stdout.strip() or "uncommitted"


def _environment(templates_dir: Path) -> Environment:
    if not templates_dir.is_dir():
        raise BuildError(f"{templates_dir}: templates directory does not exist")
    environment = Environment(
        loader=FileSystemLoader(str(templates_dir)),
        autoescape=select_autoescape(("html", "xml")),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )
    return environment


def _site_context() -> dict[str, str]:
    return {
        "name": config.SITE_NAME,
        "tagline": config.SITE_TAGLINE,
        "description": config.SITE_DESCRIPTION,
        "language": config.SITE_LANGUAGE,
        "origin": config.SITE_ORIGIN,
        "youtube_url": config.YOUTUBE_CHANNEL_URL,
        "substack_url": config.SUBSTACK_URL,
        "github_url": config.GITHUB_URL,
        "contact_email": config.CONTACT_EMAIL,
        "contact_email_url": config.CONTACT_EMAIL_URL,
    }


def absolute(path: str) -> str:
    return f"{config.SITE_ORIGIN}{path}"


def _page(
    path: str,
    title: str,
    description: str,
    *,
    nav_section: str | None = None,
    og_type: str = "website",
    canonical: str | None = None,
    article_time: str | None = None,
    noindex: bool = False,
) -> dict[str, object]:
    return {
        "path": path,
        "nav_section": nav_section or path,
        "title": title,
        "description": description,
        "og_type": og_type,
        "canonical": canonical if canonical is not None else (None if noindex else absolute(path)),
        "article_time": article_time,
        "noindex": noindex,
    }


def _render(environment: Environment, template: str, page: dict[str, object], **context: object) -> str:
    rendered = environment.get_template(template).render(
        site=_site_context(), page=page, nav=config.NAV, **context
    )
    if not rendered.endswith("\n"):
        rendered += "\n"
    return rendered


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def prepare_output(out: Path, *, protected: tuple[Path, ...] = ()) -> Path:
    """Delete and recreate a directory, but only if it is provably build output."""

    resolved = out.expanduser().resolve()
    if resolved == resolved.parent or len(resolved.parts) < 3:
        raise BuildError(f"refusing to use {resolved} as an output directory")
    for path in protected:
        guarded = path.expanduser().resolve()
        if resolved == guarded or guarded in resolved.parents:
            raise BuildError(f"refusing to write output inside {guarded}")

    if resolved.exists():
        if not resolved.is_dir() or resolved.is_symlink():
            raise BuildError(f"{resolved} exists and is not a plain directory")
        entries = list(resolved.iterdir())
        if entries and not (resolved / config.OUTPUT_MARKER).is_file():
            raise BuildError(
                f"{resolved} is not empty and was not created by this build; refusing to delete it"
            )
        for entry in entries:
            if entry.is_dir() and not entry.is_symlink():
                shutil.rmtree(entry)
            else:
                entry.unlink()
    else:
        resolved.mkdir(parents=True)
    (resolved / config.OUTPUT_MARKER).write_text(
        "This directory is generated by `python -m sitegen build`; it is safe to delete.\n",
        encoding="utf-8",
    )
    return resolved


def _rss(notes: list[Note]) -> str:
    """An RSS 2.0 feed. Dates come from front matter, never from the build clock."""

    def pubdate(note: Note) -> str:
        return f"{note.date.strftime('%a, %d %b %Y')} 12:00:00 +0000"

    items: list[str] = []
    for note in notes:
        link = absolute(note.path)
        categories = "".join(
            f"\n      <category>{xml_escape(tag)}</category>" for tag in note.tags
        )
        items.append(
            "    <item>\n"
            f"      <title>{xml_escape(note.title)}</title>\n"
            f"      <link>{xml_escape(link)}</link>\n"
            f'      <guid isPermaLink="true">{xml_escape(link)}</guid>\n'
            f"      <pubDate>{pubdate(note)}</pubDate>\n"
            f"      <description>{xml_escape(note.description)}</description>"
            f"{categories}\n"
            "    </item>"
        )

    last_build = notes[0].date if notes else None
    build_line = (
        f"    <lastBuildDate>{last_build.strftime('%a, %d %b %Y')} 12:00:00 +0000</lastBuildDate>\n"
        if last_build
        else ""
    )
    body = "\n".join(items)
    if body:
        body += "\n"
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
        "  <channel>\n"
        f"    <title>{xml_escape(config.SITE_NAME)} — Field Notes</title>\n"
        f"    <link>{xml_escape(absolute('/notes/'))}</link>\n"
        "    <description>Occasional longer writing about software, AI, and the natural world.</description>\n"
        f"    <language>{config.SITE_LANGUAGE}</language>\n"
        f"{build_line}"
        f'    <atom:link href="{xml_escape(absolute("/notes/feed.xml"))}" rel="self" '
        'type="application/rss+xml"/>\n'
        f"{body}"
        "  </channel>\n"
        "</rss>\n"
    )


def _sitemap(notes: list[Note]) -> str:
    entries: list[str] = []
    for path in SITEMAP_PATHS:
        entries.append(f"  <url><loc>{xml_escape(absolute(path))}</loc></url>")
    for note in notes:
        local = absolute(note.path)
        if note.canonical and note.canonical != local:
            continue  # canonicalised elsewhere: do not invite a duplicate
        entries.append(
            f"  <url><loc>{xml_escape(local)}</loc><lastmod>{note.date.isoformat()}</lastmod></url>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{chr(10).join(entries)}\n"
        "</urlset>\n"
    )


def _robots() -> str:
    return "User-agent: *\nAllow: /\n\n" f"Sitemap: {absolute('/sitemap.xml')}\n"



def build_site(
    *,
    out: Path = config.ROOT / "dist",
    content_dir: Path = config.CONTENT_DIR,
    templates_dir: Path = config.TEMPLATES_DIR,
    static_dir: Path = config.STATIC_DIR,
    feeds_file: Path | None = None,
    commit: str | None = None,
    today: date | None = None,
) -> BuildResult:
    """Build the whole site and return what was written."""

    notes_path = content_dir / "notes"
    snapshot_file = feeds_file if feeds_file is not None else content_dir / "feeds.json"
    if not static_dir.is_dir():
        raise BuildError(f"{static_dir}: static directory does not exist")

    notes = load_notes(discover_notes(notes_path), today=today)
    live = published_notes(notes)
    drafts = draft_notes(notes)
    snapshot: FeedSnapshot = load_snapshot(snapshot_file)
    environment = _environment(templates_dir)

    out_dir = prepare_output(
        out,
        protected=(content_dir, templates_dir, static_dir, config.ROOT / "src"),
    )

    shutil.copytree(
        static_dir,
        out_dir,
        dirs_exist_ok=True,
        copy_function=shutil.copyfile,
    )
    # Cloudflare Workers reads .assetsignore from the assets root (.gitignore syntax).
    # The build marker is bookkeeping, not content, and must never be served.
    _write(out_dir / ".assetsignore", f"{config.OUTPUT_MARKER}\n.assetsignore\n")

    written: list[str] = []
    youtube = snapshot.get("youtube", limit=6)
    substack = snapshot.get("substack", limit=8)

    page = _page("/", f"{config.SITE_NAME} — {config.SITE_TAGLINE}", config.SITE_DESCRIPTION)
    _write(
        out_dir / "index.html",
        _render(
            environment,
            "home.html",
            page,
            projects=featured(),
            notes=live[:3],
            youtube=snapshot.get("youtube", limit=1),
            substack=snapshot.get("substack", limit=1),
        ),
    )
    written.append("/")

    page = _page(
        "/work/",
        f"Work — {config.SITE_NAME}",
        "Selected software: an independent engineering practice and personal experiments in the "
        "sky, mapping, forecasts and AI.",
    )
    _write(
        out_dir / "work" / "index.html",
        _render(
            environment,
            "work.html",
            page,
            groups=GROUPS,
            projects_by_group={group: by_group(group) for group, _, _ in GROUPS},
            projects=PROJECTS,
        ),
    )
    written.append("/work/")

    page = _page(
        "/notes/",
        f"Field Notes — {config.SITE_NAME}",
        "Occasional longer writing about software, AI, and the natural world.",
    )
    _write(
        out_dir / "notes" / "index.html",
        _render(environment, "notes.html", page, notes=live),
    )
    written.append("/notes/")

    for note in live:
        local = absolute(note.path)
        page = _page(
            note.path,
            f"{note.title} — {config.SITE_NAME}",
            note.description,
            nav_section="/notes/",
            og_type="article",
            canonical=note.canonical or local,
            article_time=f"{note.date.isoformat()}T12:00:00Z",
        )
        _write(
            out_dir / "notes" / note.slug / "index.html",
            _render(environment, "note.html", page, note=note, notes=live),
        )
        written.append(note.path)

    page = _page(
        "/about/",
        f"About — {config.SITE_NAME}",
        "Hank Marquardt: a software engineer with a background in web development and data "
        "engineering, now working across AI and software.",
    )
    _write(out_dir / "about" / "index.html", _render(environment, "about.html", page))
    written.append("/about/")

    page = _page(
        "/elsewhere/",
        f"Elsewhere — {config.SITE_NAME}",
        "Earwurmz of Whimsy on YouTube, Substack writing, and code on GitHub.",
    )
    _write(
        out_dir / "elsewhere" / "index.html",
        _render(environment, "elsewhere.html", page, youtube=youtube, substack=substack),
    )
    written.append("/elsewhere/")

    page = _page(
        "/404.html",
        f"Page not found — {config.SITE_NAME}",
        "That page is not here. Links to the rest of the site are on this page.",
        noindex=True,
    )
    _write(out_dir / "404.html", _render(environment, "404.html", page))
    written.append("/404.html")

    _write(out_dir / "notes" / "feed.xml", _rss(live))
    _write(out_dir / "sitemap.xml", _sitemap(live))
    _write(out_dir / "robots.txt", _robots())
    resolved_commit = resolve_commit(commit)
    _write(
        out_dir / "version.json",
        f'{{"version": "1.0.0", "commit": "{resolved_commit}"}}\n',
    )
    written.extend(("/notes/feed.xml", "/sitemap.xml", "/robots.txt", "/version.json"))

    return BuildResult(
        out=out_dir,
        pages=tuple(written),
        published=tuple(live),
        drafts=tuple(drafts),
        feed_problems=snapshot.problems,
        commit=resolved_commit,
    )
