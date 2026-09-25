"""Capture README screenshots (and a demo GIF) of the running app in demo mode.

Usage:
    make dev            # or: docker compose up
    python scripts/screenshots.py --url http://localhost:5173 --out docs

Requires `pip install playwright && playwright install chromium`, plus ffmpeg for the GIF.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

VIEWPORT = {"width": 1600, "height": 1000}


def generate(page: Page) -> None:
    page.get_by_role("button", name="Generate ✦").click()
    page.wait_for_selector("[data-testid=token]")
    page.wait_for_timeout(900)


def branch_on_top_fork(page: Page, pause: int = 600) -> None:
    """Open the most uncertain fork point from the sidebar and take its runner-up."""
    page.locator("[data-testid=fork-sidebar] li button").first.click()
    page.wait_for_timeout(pause)
    # Buttons in the pinned menu: the first enabled one is the best non-chosen alternative.
    menu_buttons = page.locator(".ring-violet-400\\/40 li button:not([disabled])")
    menu_buttons.first.click()
    page.wait_for_function(
        "document.querySelectorAll('.react-flow__node').length > 1", timeout=15000
    )
    page.wait_for_timeout(900)


def capture(url: str, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT, device_scale_factor=1.5)
        page.goto(url)
        page.wait_for_selector("[data-testid=demo-banner]")
        generate(page)

        # 1. Hover a fork token to show the alternatives tooltip.
        fork_pos = page.locator("[data-testid=fork-sidebar] li button").nth(1).inner_text()
        pos = fork_pos.split()[0].lstrip("#")
        page.locator(f"[data-testid=token][data-position='{pos}']").hover()
        page.wait_for_timeout(500)
        page.screenshot(path=out / "hover-alternatives.png")
        page.mouse.move(5, 500)

        # 2. Pin the branch menu on the top fork point.
        page.locator("[data-testid=fork-sidebar] li button").first.click()
        page.wait_for_timeout(700)
        page.screenshot(path=out / "branch-menu.png")
        page.keyboard.press("Escape")

        # 3. Branch, auto-explore, and show the tree.
        branch_on_top_fork(page)
        page.get_by_role("button", name="Auto-explore").click()
        page.get_by_text(re.compile(r"^Explored \d+")).wait_for(timeout=30000)
        page.wait_for_timeout(1500)
        page.screenshot(path=out / "explore-tree.png")

        # 4. Entropy colouring.
        page.get_by_role("button", name="entropy", exact=True).click()
        page.wait_for_timeout(400)
        page.locator("[data-testid=token-view]").screenshot(path=out / "entropy-view.png")
        page.get_by_role("button", name="probability", exact=True).click()

        # 5. Compare mode.
        page.get_by_role("button", name="compare", exact=True).click()
        page.get_by_role("button", name="Compare ⇆").click()
        page.wait_for_selector("text=First divergence")
        page.wait_for_timeout(800)
        page.screenshot(path=out / "compare.png", full_page=True)
        browser.close()


def record_gif(url: str, out: Path) -> None:
    if not shutil.which("ffmpeg"):
        print("ffmpeg not found; skipping GIF")
        return
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport=VIEWPORT, record_video_dir=tmp, record_video_size=VIEWPORT
        )
        page = ctx.new_page()
        page.goto(url)
        page.wait_for_selector("[data-testid=demo-banner]")
        page.wait_for_timeout(700)
        generate(page)
        first = page.locator("[data-testid=fork-sidebar] li button").first.inner_text()
        pos = first.split()[0].lstrip("#")
        page.locator(f"[data-testid=token][data-position='{pos}']").hover()
        page.wait_for_timeout(1600)
        page.mouse.move(5, 500)
        branch_on_top_fork(page, pause=1300)
        page.wait_for_timeout(800)
        page.get_by_role("button", name="Auto-explore").click()
        page.get_by_text(re.compile(r"^Explored \d+")).wait_for(timeout=30000)
        page.wait_for_timeout(1800)
        page.locator(".react-flow__node").first.click()
        page.wait_for_timeout(1500)
        video = page.video
        ctx.close()
        browser.close()
        assert video is not None
        src = video.path()
        palette = Path(tmp) / "palette.png"
        vf = "fps=8,scale=1000:-1:flags=lanczos"
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                src,
                "-vf",
                f"{vf},palettegen=max_colors=128:stats_mode=diff",
                palette,
            ],
            check=True,
        )
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                src,
                "-i",
                palette,
                "-lavfi",
                f"{vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
                out / "demo.gif",
            ],
            check=True,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:5173")
    parser.add_argument("--out", default="docs", type=Path)
    parser.add_argument("--no-gif", action="store_true")
    args = parser.parse_args()
    capture(args.url, args.out)
    if not args.no_gif:
        record_gif(args.url, args.out)
    print(f"Saved screenshots to {args.out}/")
