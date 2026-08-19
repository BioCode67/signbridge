#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""발표자료에 넣을 화면 사진을 다시 찍는다.

    npm run build && python3 ppt/shoot_assets.py

**이모지 글꼴이 없으면 아이콘이 전부 두부(▤)로 찍힌다.** 실제로 예전 사진이
그 상태였다 — 앱은 멀쩡한데 발표자료만 깨져 보였다. 찍기 전에 글꼴을 확인한다.

    fc-list | grep -i emoji      # 비어 있으면 Noto Color Emoji를 설치할 것
"""
from __future__ import annotations

import asyncio
import shutil
import socketserver
import subprocess
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
OUT = ROOT / "ppt" / "assets"

CHROME = next((p for p in ("/usr/bin/google-chrome", "/usr/bin/chromium-browser")
               if Path(p).exists()), None)
# 서울 시청 — 주변 장소 답변이 매번 같은 곳을 가리키게 못박는다
GEO = {"latitude": 37.5663, "longitude": 126.9779}


class Threaded(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        if sys.exc_info()[0] in (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            return
        super().handle_error(request, client_address)


def serve() -> Threaded:
    h = partial(SimpleHTTPRequestHandler, directory=str(DIST))
    httpd = Threaded(("127.0.0.1", 0), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def check_emoji() -> None:
    if not shutil.which("fc-list"):
        return
    out = subprocess.run(["fc-list"], capture_output=True, text=True).stdout
    if "emoji" not in out.lower():
        print("✗ 이모지 글꼴이 없습니다 — 아이콘이 두부(▤)로 찍힙니다.")
        print("  ~/.local/share/fonts 에 NotoColorEmoji.ttf 를 넣고 fc-cache -f 하세요.")
        sys.exit(1)


async def wait_playing(pg, limit: int = 18) -> bool:
    """아바타가 실제로 움직일 때까지 기다린다 — 일찍 찍으면 빈 무대가 남는다."""
    for _ in range(limit):
        await pg.wait_for_timeout(700)
        try:
            n = await pg.locator("[data-sign-frames]").first.evaluate("e => +e.dataset.signFrames")
        except Exception:
            continue
        if n > 20:
            return True
    return False


async def snap(pg, name: str) -> None:
    # 애니메이션을 멈추지 않으면 화면이 계속 움직여 스크린샷이 30초를 넘긴다 —
    # 실제로 인식·기대효과 구역에서 통째로 실패했다.
    await pg.screenshot(path=str(OUT / name), animations="disabled",
                        caret="hide", timeout=60000)
    print(f"  {name}")


async def shoot_app(browser, port: int) -> None:
    ctx = await browser.new_context(viewport={"width": 1440, "height": 900},
                                    device_scale_factor=2, locale="ko-KR",
                                    service_workers="block",
                                    geolocation=GEO, permissions=["geolocation"])
    pg = await ctx.new_page()
    url = f"http://127.0.0.1:{port}/#/app"

    await pg.goto(url, wait_until="domcontentloaded")
    await wait_playing(pg)
    await snap(pg, "web_app_받기.png")

    await pg.get_by_role("button", name="📹 묻기").click()
    await pg.wait_for_timeout(1500)
    # 빠른 질문 단추로 답변 상태까지 간다 — 카메라 없이도 같은 화면이 나온다
    ask = pg.get_by_role("button", name="대피소 어디?").first
    if await ask.count():
        await ask.click()
        await wait_playing(pg)
    await snap(pg, "web_app_묻기.png")

    # 대화 — 안내 화면은 흰 여백이 크다. 실제 창구 대화가 도는 화면을 찍는다.
    await pg.goto(url, wait_until="domcontentloaded")
    await pg.wait_for_timeout(1500)
    await pg.get_by_role("button", name="💬 대화").click()
    await pg.wait_for_timeout(800)
    hosp = pg.get_by_role("button", name="🏥 병원").first
    if await hosp.count():
        await hosp.click()
        await pg.wait_for_timeout(700)
    start = pg.get_by_text("화면을 누르면 시작합니다").first
    if await start.count():
        await start.click()
        await pg.wait_for_timeout(800)
    q = pg.get_by_role("button", name="어디가 아픈가요?").first
    if await q.count():
        await q.click()
        await wait_playing(pg)
    await snap(pg, "web_app_대화.png")

    await pg.goto(url, wait_until="domcontentloaded")
    await pg.wait_for_timeout(1500)
    tab = pg.get_by_role("button", name="📖 사전").first
    await tab.wait_for(state="visible", timeout=15000)
    await tab.click()
    await pg.wait_for_timeout(900)
    starter = pg.get_by_role("button", name="병원", exact=True).first
    if await starter.count():
        await starter.click()
        await wait_playing(pg)
    await snap(pg, "web_app_사전.png")
    await ctx.close()


async def shoot_phone(browser, port: int) -> None:
    ctx = await browser.new_context(viewport={"width": 420, "height": 900},
                                    device_scale_factor=2, locale="ko-KR",
                                    service_workers="block",
                                    geolocation=GEO, permissions=["geolocation"])
    pg = await ctx.new_page()
    await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="domcontentloaded")
    await wait_playing(pg)
    await snap(pg, "app_받기.png")
    await ctx.close()


SECTIONS = [("#why", "web_왜.png"), ("#agents", "web_에이전트.png"),
            ("#live", "web_인식.png"), ("#impact", "web_기대효과.png")]


async def shoot_site(browser, port: int) -> None:
    """소개 사이트의 구역들 — 발표자료가 쓰는 넷만 찍는다."""
    ctx = await browser.new_context(viewport={"width": 1440, "height": 900},
                                    device_scale_factor=2, locale="ko-KR",
                                    service_workers="block")
    pg = await ctx.new_page()
    await pg.goto(f"http://127.0.0.1:{port}/", wait_until="domcontentloaded")
    await pg.wait_for_timeout(2500)
    for sec, name in SECTIONS:
        el = pg.locator(sec).first
        if not await el.count():
            print(f"  ✗ {sec} 구역을 찾지 못했습니다 — {name}을 건너뜁니다")
            continue
        await el.scroll_into_view_if_needed()
        await pg.evaluate("window.scrollBy(0, -40)")
        await pg.wait_for_timeout(1400)
        await snap(pg, name)
    await ctx.close()


async def main() -> int:
    from playwright.async_api import async_playwright

    check_emoji()
    if not (DIST / "index.html").exists():
        print("dist/ 가 없습니다 — 먼저 npm run build")
        return 1
    if CHROME is None:
        print("크롬을 찾지 못했습니다")
        return 1

    httpd = serve()
    port = httpd.server_address[1]
    print(f"dist/ 를 {port} 포트로 띄웠습니다")
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        await shoot_app(browser, port)
        await shoot_phone(browser, port)
        await shoot_site(browser, port)
        await browser.close()
    httpd.shutdown()
    print("화면 사진을 다시 찍었습니다 — python3 ppt/build_ppt.py 로 반영하세요")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
