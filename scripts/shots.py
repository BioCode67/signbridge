#!/usr/bin/env python3
"""화면 사진 찍기 — 실제로 어떻게 보이는지 눈으로 확인하기 위한 도구.

    npm run build && python3 scripts/shots.py

`scripts/e2e_app.py`가 재는 것은 "동작하는가"다. 이 스크립트는 "보기 좋은가"를
사람이 판단하도록 사진만 남긴다. 둘은 다른 질문이고, 이 앱은 둘 다 필요하다.
사진은 `shots/`에 남는다(git에는 넣지 않는다).
"""
from __future__ import annotations

import asyncio
import socketserver
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
OUT = ROOT / "shots"


class Threaded(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def serve() -> Threaded:
    h = partial(SimpleHTTPRequestHandler, directory=str(DIST))
    httpd = Threaded(("127.0.0.1", 0), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


VIEWS = [("폰", 390, 844), ("태블릿", 1024, 768)]


async def shoot(browser, port: int, label: str, w: int, h: int) -> None:
    ctx = await browser.new_context(viewport={"width": w, "height": h},
                                    service_workers="block")
    pg = await ctx.new_page()
    await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="networkidle")
    await pg.wait_for_timeout(2500)

    async def snap(name: str) -> None:
        await pg.screenshot(path=str(OUT / f"{label}_{name}.png"))
        print(f"  {label}_{name}.png")

    await snap("01_받기")
    await pg.get_by_role("button", name="📹 묻기").click()
    await pg.wait_for_timeout(1200)
    await snap("02_묻기")
    await pg.get_by_role("button", name="수어로 묻기").click()
    await pg.wait_for_timeout(2500)
    await snap("03_묻기_촬영")

    await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="networkidle")
    await pg.wait_for_timeout(1500)
    await pg.get_by_role("button", name="💬 대화").click()
    await pg.wait_for_timeout(700)
    await snap("04_대화_장소")
    await pg.get_by_role("button", name="🏥 병원").click()
    await pg.wait_for_timeout(700)
    await snap("05_대화_안내")
    await pg.get_by_text("화면을 누르면 시작합니다").click()
    await pg.wait_for_timeout(700)
    await snap("06_대화_직원")
    await pg.get_by_role("button", name="어디가 아픈가요?").click()
    await pg.wait_for_timeout(2500)
    await snap("07_대화_수어재생")
    await pg.get_by_role("button", name="🤟 내 답 카드").click()
    await pg.wait_for_timeout(600)
    await snap("08_대화_답카드")
    await ctx.close()


async def main() -> int:
    from playwright.async_api import async_playwright

    if not (DIST / "index.html").exists():
        print("dist/ 가 없습니다 — npm run build 를 먼저 실행하세요")
        return 1
    OUT.mkdir(exist_ok=True)
    httpd = serve()
    port = httpd.server_address[1]
    try:
        async with async_playwright() as p:
            exe = None
            for cand in ("/usr/bin/google-chrome", "/usr/bin/chromium-browser"):
                if Path(cand).exists():
                    exe = cand
                    break
            browser = await p.chromium.launch(
                executable_path=exe,
                args=["--no-sandbox", "--use-fake-ui-for-media-stream",
                      "--use-fake-device-for-media-stream"])
            for label, w, h in VIEWS:
                print(f"[{label} {w}x{h}]")
                await shoot(browser, port, label, w, h)
            await browser.close()
    finally:
        httpd.shutdown()
    print(f"\n사진 {len(list(OUT.glob('*.png')))}장 → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
