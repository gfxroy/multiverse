"""End-to-end check of the static (GitHub Pages) build in headless Chromium.

Usage:
    python scripts/verify_pages.py --url https://gfxroy.github.io/multiverse/

Checks: the page loads without errors, demo banner, generate, hover alternatives, branch,
auto-explore, compare, share link round-trip, and the own-key menu. It also records every
request host to confirm demo mode makes no calls outside the site itself.
Requires `pip install playwright && playwright install chromium`.
"""

from __future__ import annotations

import argparse
import re
import sys
from urllib.parse import urlparse

from playwright.sync_api import Page, sync_playwright

FORK_BUTTONS = "[data-testid=fork-sidebar] li button"


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}{f' ({detail})' if detail else ''}")
    if not ok:
        raise SystemExit(1)


def node_count(page: Page) -> int:
    return page.locator(".react-flow__node").count()


def run(url: str, shots: str | None) -> None:
    site = urlparse(url).netloc
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1500, "height": 950})
        page = ctx.new_page()
        errors: list[str] = []
        hosts: set[str] = set()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda r: hosts.add(urlparse(r.url).netloc))

        resp = page.goto(url, wait_until="networkidle")
        check("page loads", resp is not None and resp.ok, f"HTTP {resp.status if resp else '?'}")
        page.wait_for_selector("[data-testid=demo-banner]", timeout=15000)
        badge = page.locator("[data-testid=provider-badge]").inner_text()
        check("demo banner + badge", "DEMO" in badge.upper(), badge.strip())

        page.get_by_role("button", name="Generate ✦").click()
        page.wait_for_selector("[data-testid=token]", timeout=15000)
        tokens = page.locator("[data-testid=token]").count()
        check("generate renders tokens", tokens > 10, f"{tokens} tokens")
        forks = page.locator(FORK_BUTTONS).count()
        check("fork points detected", forks > 0, f"{forks} fork points")

        pos = page.locator(FORK_BUTTONS).first.inner_text().split()[0].lstrip("#")
        page.locator(f"[data-testid=token][data-position='{pos}']").hover()
        tooltip = page.get_by_text(re.compile(rf"^Token #{pos}")).first
        tooltip.wait_for(timeout=5000)
        alt_rows = page.locator(f"div:has(> div > div > div:text-matches('^Token #{pos}')) li")
        check("hover shows alternatives", alt_rows.count() >= 2, f"{alt_rows.count()} alternatives")
        if shots:
            page.screenshot(path=f"{shots}/pages-hover.png")
        page.mouse.move(5, 600)

        before = node_count(page)
        page.locator(FORK_BUTTONS).first.click()
        page.locator(".ring-violet-400\\/40 li button:not([disabled])").first.click()
        page.wait_for_function(
            f"document.querySelectorAll('.react-flow__node').length > {before}", timeout=15000
        )
        check("branch adds a node", node_count(page) > before, f"{node_count(page)} nodes")

        page.get_by_role("button", name="Auto-explore").click()
        toast = page.get_by_text(re.compile(r"^Explored \d+"))
        toast.wait_for(timeout=30000)
        check("auto-explore", node_count(page) > 2, f"{toast.inner_text()}, {node_count(page)} nodes")
        if shots:
            page.wait_for_timeout(800)
            page.screenshot(path=f"{shots}/pages-explore.png")

        nodes_before_share = node_count(page)
        page.get_by_role("button", name="Share link").click()
        page.wait_for_function("location.hash.startsWith('#t=')", timeout=5000)
        link = page.url
        page2 = ctx.new_page()
        page2.on("pageerror", lambda e: errors.append(str(e)))
        page2.goto(link, wait_until="networkidle")
        page2.wait_for_selector("[data-testid=token]", timeout=15000)
        page2.wait_for_timeout(500)
        check(
            "share link restores the tree",
            node_count(page2) == nodes_before_share,
            f"{len(link)} char URL, {node_count(page2)} nodes",
        )
        page2.close()

        page.get_by_role("button", name="compare", exact=True).click()
        page.get_by_role("button", name="Compare ⇆").click()
        page.wait_for_selector("text=First divergence", timeout=20000)
        check("compare shows metrics", True)
        if shots:
            page.screenshot(path=f"{shots}/pages-compare.png", full_page=True)

        page.get_by_test_id("key-menu-button").click()
        key_input = page.get_by_label("API key")
        menu_text = page.locator("form").last.locator("xpath=..").inner_text()
        check("own-key menu present", key_input.is_visible())
        check("own-key menu is OpenAI-only", page.get_by_role("button", name="Gemini").count() == 0)
        check("own-key menu explains direct-to-OpenAI", "api.openai.com" in menu_text)

        other = {h for h in hosts if h and h != site}
        check("demo mode stays on the site", not other, ", ".join(sorted(other)) or site)
        check("no page errors", not errors, "; ".join(errors[:3]))
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="https://gfxroy.github.io/multiverse/")
    parser.add_argument("--screenshots", default=None, help="directory for screenshots")
    args = parser.parse_args()
    run(args.url, args.screenshots)
    print("All checks passed.")
    sys.exit(0)
