"""Curated work entries.

Every sentence here is limited to what the linked public sites and their
repositories actually claim. There are no metrics, testimonials or outcomes that
are not visible on the public site, and no private or family software.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Project:
    slug: str
    name: str
    url: str
    domain: str
    group: str
    summary: str
    problem: str | None = None
    approach: str | None = None
    outcome: str | None = None
    featured: bool = False


GROUPS = (
    (
        "practice",
        "Independent practice",
        "Client work, described at the level the public sites describe it.",
    ),
    (
        "experiments",
        "Personal experiments",
        "Tools I built because I wanted them. No accounts required, and no claim that they are finished.",
    ),
    (
        "creative",
        "Creative",
        "The part of the workshop that makes noise.",
    ),
)

PROJECTS: tuple[Project, ...] = (
    Project(
        slug="turkey-vulture-software",
        name="Turkey Vulture Software",
        url="https://turkeyvulturesoftware.com/",
        domain="turkeyvulturesoftware.com",
        group="practice",
        summary=(
            "Independent software engineering: website rescue and development, custom software, "
            "AI and business automation, and data and cloud systems."
        ),
        problem=(
            "Small organizations end up with software nobody can maintain: a site held together "
            "by plugins, a spreadsheet doing the work of a database, automation that only one "
            "person understands."
        ),
        approach=(
            "Ownership-first engineering. The client keeps the code, the accounts and the ability "
            "to leave, and the site is built without a client framework or a build step it cannot "
            "explain later."
        ),
        outcome=(
            "Live practice site. Inquiries go through a server-side form and arrive by email; "
            "nothing is stored in a database or CRM. The site reports only pageviews and "
            "confirmed inquiry events to an analytics service it documents."
        ),
        featured=True,
    ),
    Project(
        slug="ai-small-business-guru",
        name="AI Small Business Guru",
        url="https://aismallbizguru.com/",
        domain="aismallbizguru.com",
        group="practice",
        summary=(
            "Practical websites, applications, automation, and AI, with client ownership from the "
            "start."
        ),
        problem=(
            "The useful version of AI for a small business is usually unglamorous: fewer copied "
            "spreadsheets, less retyping, one place where the work actually lives."
        ),
        approach=(
            "Small, owned systems rather than a platform migration: a static site, a focused "
            "application, or automation around the tools a business already pays for."
        ),
        outcome=(
            "Live services site built and deployed as static files. The working experiments behind "
            "it live in a separate lab rather than on the public site."
        ),
    ),
    Project(
        slug="worth-looking-up",
        name="Worth Looking Up",
        url="https://worthlookingup.com/",
        domain="worthlookingup.com",
        group="experiments",
        summary=(
            "A local-first guide to the sky: satellite passes, rocket launch schedules, planets, "
            "meteor showers, comets and eclipses."
        ),
        problem=(
            "The sky keeps a schedule, and it is easy to miss the good parts while checking several "
            "sites that each treat precision differently."
        ),
        approach=(
            "Vanilla JavaScript, vendored calculation libraries, browser workers and bounded local "
            "caches. Launch schedules are shown as published schedules with their precision stated, "
            "and they never enter the satellite or celestial scores."
        ),
        outcome=(
            "Live, usable without an account or a build step. An observing plan exports to a "
            "calendar file built in the browser; no server or calendar API is involved."
        ),
        featured=True,
    ),
    Project(
        slug="road-naturalist",
        name="Road Naturalist",
        url="https://roadnaturalist.com/",
        domain="roadnaturalist.com",
        group="experiments",
        summary=(
            "A field-research tool for finding roads worth surveying, and for being explicit about "
            "what the data cannot tell you."
        ),
        problem=(
            "A mapped road is not a public road, and a public road is not a good place to watch "
            "wildlife. Most mapping tools collapse that distinction into one confident answer."
        ),
        approach=(
            "A bounded Oregon pilot built from a TIGER/Line 2025 road extract that measures road, "
            "wetland, surface-water and ecoregion facts for every candidate corridor. A separate "
            "investigator researches access from declared official sources rather than a URL a "
            "client supplies."
        ),
        outcome=(
            "Live pilot. Coverage and access are stated separately: a measured corridor can still "
            "be unverified for public access, and the interface says so instead of scoring around "
            "it."
        ),
        featured=True,
    ),
    Project(
        slug="fruiting-forecast",
        name="Fruiting Forecast",
        url="https://fruitingforecast.com/",
        domain="fruitingforecast.com",
        group="experiments",
        summary=(
            "Mushroom-hunt intelligence: weather history, habitat evidence and access-aware "
            "planning, with the safety limits stated up front."
        ),
        problem=(
            "A mushroom forecast is easy to make look precise and hard to make honest. Moisture, "
            "habitat, land access and collecting rules are different questions with different "
            "evidence."
        ),
        approach=(
            "Sampled sectors compared against per-species fruiting models, keeping 30-day moisture "
            "history, habitat cover and mapped access as separate evidence rather than one blended "
            "number."
        ),
        outcome=(
            "Live experiment. The site repeats that forecasting is not identification, and that "
            "mapped public land does not establish collecting legality."
        ),
        featured=True,
    ),
    Project(
        slug="earwurmz-of-whimsy",
        name="Earwurmz of Whimsy",
        url="https://www.youtube.com/channel/UC_D3lgvy2XWLEZ1Uw4IU9Rg",
        domain="youtube.com",
        group="creative",
        summary=(
            "Original songs and videos made with AI tools in the loop. The catalogue includes a "
            "darkly comic outlaw-country ballad about turkey vultures, which is exactly the kind of "
            "idea this channel exists for."
        ),
        outcome=(
            "Ongoing. New videos appear on the channel; the latest ones are listed under Elsewhere."
        ),
    ),
)


def by_group(group: str) -> tuple[Project, ...]:
    return tuple(project for project in PROJECTS if project.group == group)


def featured() -> tuple[Project, ...]:
    return tuple(project for project in PROJECTS if project.featured)
