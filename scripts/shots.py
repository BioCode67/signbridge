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
    await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="domcontentloaded")
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

    await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="domcontentloaded")
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

    # 사전 — 낱말을 찾아 동작을 확인하는 화면. 여기도 눈으로 봐야 한다.
    await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="domcontentloaded")
    await pg.wait_for_timeout(1500)
    dict_tab = pg.get_by_role("button", name="📖 사전")
    if await dict_tab.count():
        await dict_tab.first.click()
        await pg.wait_for_timeout(900)
        await snap("09_사전")
        box = pg.get_by_placeholder("🔍 단어 찾기")
        if await box.count():
            await box.first.fill("병원")
            await pg.wait_for_timeout(1200)
            await snap("10_사전_검색")
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
    write_contact_sheet()
    print(f"\n사진 {len(list(OUT.glob('*.png')))}장 → {OUT}")
    print(f"한눈에 보기: {OUT / 'index.html'}")
    return 0


def write_contact_sheet() -> None:
    """찍은 사진을 한 장짜리 HTML로 묶는다.

    화면을 하나씩 열어 보는 것보다 **나란히 놓고 보는 편**이 문제를 훨씬 잘 잡는다
    (아바타가 작다·글씨가 밀렸다·빈 자리가 크다는 비교로만 보인다).
    폰에서도 열리도록 한 파일 안에 다 넣는다.
    """
    shots = sorted(OUT.glob("*.png"))
    cards = []
    for p in shots:
        label = p.stem.replace("_", " ")
        cards.append(
            f'<figure><img src="{p.name}" alt="{label}" loading="lazy">'
            f"<figcaption>{label}</figcaption></figure>"
        )
    html = f"""<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SignBridge 화면 {len(shots)}장</title>
<style>
  body {{ margin:0; padding:16px; background:#0b1220; color:#e2e8f0;
         font-family:system-ui,-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif; }}
  h1 {{ font-size:20px; margin:0 0 4px; }}
  p.hint {{ color:#64748b; font-size:14px; margin:0 0 16px; }}
  .grid {{ display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); }}
  figure {{ margin:0; background:#111827; border:1px solid #1e293b; border-radius:12px;
            overflow:hidden; }}
  img {{ display:block; width:100%; height:auto; }}
  figcaption {{ padding:8px 10px; font-size:13px; color:#94a3b8; }}
</style>
<h1>SignBridge 화면 {len(shots)}장</h1>
<p class="hint">고칠 곳이 보이면 사진 이름으로 짚어 주세요.</p>
<div class="grid">{''.join(cards)}</div>
"""
    (OUT / "index.html").write_text(html, encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
