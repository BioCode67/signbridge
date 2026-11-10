#!/usr/bin/env python3
"""아바타 움직임을 수치로 잰다 — 떨림·지연·주사율 의존·손이 화면 안에 있는 비율.

    npm run build && python3 scripts/measure_avatar.py [--dist dist] [--out result.json]

**왜 필요한가.** "더 자연스러워졌다"는 눈으로 보면 누구나 그렇게 말할 수 있다.
고치기 전과 후를 같은 문장·같은 화면 크기로 재서 숫자로 견준다.

`window.__SB_PROBE`를 미리 심어 두면 아바타가 계측기(`src/sections/sign/avatarProbe.ts`)를
붙인다. 계측기는 화면 재생과 **같은 갱신 함수**에 문장을 프레임 하나씩 넣어 본다 — 기기
속도와 상관없는 값이 나온다. 재는 항목의 정의는 avatarProbe.ts 머리말에 있다.

받기 화면(#/app)의 재난문자 앞 4건을 폰(375×667)·데스크톱(1280×800)에서 잰다.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import socketserver
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWS = [("폰375", 375, 667), ("데스크톱", 1280, 800)]
VIEW_BY_NAME = {v[0]: v for v in VIEWS}
SENTENCES = 4
SHOT_DIR = ROOT / "shots" / "avatar"
T0 = time.time()


class Threaded(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        if sys.exc_info()[0] in (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            return
        super().handle_error(request, client_address)


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a) -> None:  # noqa: D401
        pass


def serve(dist: Path) -> Threaded:
    h = partial(Quiet, directory=str(dist))
    httpd = Threaded(("127.0.0.1", 0), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def measure_view(browser, port: int, label: str, w: int, h: int) -> dict:
    ctx = await browser.new_context(viewport={"width": w, "height": h}, service_workers="block")
    await ctx.add_init_script("window.__SB_PROBE = 1; localStorage.setItem('sb-tab','watch')")
    pg = await ctx.new_page()
    errors: list[str] = []
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="domcontentloaded")
    results = []
    last_key = None
    for n in range(SENTENCES):
        # 새 문장이 합성되고 계측기가 붙을 때까지 기다린다. 문장은 (프레임 수, 낱말 수)로 가린다.
        st = None
        for _ in range(240):
            await pg.wait_for_timeout(500)
            st = await asyncio.wait_for(pg.evaluate(
                """() => {
                  const e = document.querySelector('[data-sign-frames]')
                  return { frames: e ? +e.dataset.signFrames : 0, probe: !!window.__sbAvatar,
                           glosses: e ? +e.dataset.signGlosses : 0 }
                }"""
            ), 90)
            key = (st["frames"], st["glosses"])
            if st["frames"] > 20 and st["probe"] and key != last_key:
                break
        else:
            break
        last_key = key
        print(f"  [{label}] 문장 {n}: 프레임 {key[0]} · 낱말 {key[1]} — {time.time() - T0:.0f}s", file=sys.stderr)
        if n == 0:  # 사진은 첫 문장만 — 소프트웨어 렌더링에서는 한 장이 오래 걸린다.
            try:
                await pg.screenshot(path=str(SHOT_DIR / f"{label}.png"), timeout=120000)
            except Exception as e:  # noqa: BLE001
                print(f"  (사진 실패: {label} — {e.__class__.__name__})", file=sys.stderr)
        overlay = await pg.evaluate(
            """() => {
              const stage = document.querySelector('[data-sign-frames]')
              const ov = stage && stage.querySelector(':scope > .absolute.bottom-0')
              if (!stage || !ov) return 0
              const s = stage.getBoundingClientRect(), o = ov.getBoundingClientRect()
              // 맨 위 40px(pt-10)은 투명 그라디언트라 손이 비친다 — 가려지는 부분만 센다.
              return Math.max(0, s.bottom - (o.top + 40))
            }"""
        )
        m = await pg.evaluate(f"() => window.__sbAvatar.measure({overlay})")
        print(f"    계측 끝 — {time.time() - T0:.0f}s", file=sys.stderr)
        if m:
            m["overlayPx"] = overlay
            m["key"] = list(last_key)
            results.append(m)
        # 다음 문자로 바로 넘긴다 — 끝까지 재생을 기다리면 소프트웨어 렌더링에서 한 문장에 수십 초다.
        # 화면이 느리면 Playwright의 클릭(요소가 멈출 때까지 기다림)이 시간 초과로 실패한다 — JS로 누른다.
        await pg.evaluate(
            """() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('다음'))
                       b && b.click() }"""
        )
    await ctx.close()
    return {"view": label, "size": [w, h], "sentences": results, "consoleErrors": errors[:10],
            "consoleErrorCount": len(errors)}


def summarize(views: list[dict]) -> dict:
    keys = ["jitterArmDeg", "jitterFingerDeg", "jitterArmDeg60", "jitterFingerDeg60", "lagArmDeg",
            "lagFingerDeg", "delayArmMs", "delayFingerMs", "fpsGapArmDeg", "fpsGapFingerDeg", "handsIn", "handsClear", "handsIn60",
            "clearLeft", "clearRight"]
    out = {}
    for v in views:
        ss = v["sentences"]
        if not ss:
            continue
        tot = sum(s["frames"] for s in ss)
        row = {k: round(sum(s.get(k, 0) * s["frames"] for s in ss) / tot, 4) for k in keys}
        row["frames"] = tot
        row["minMarginPx"] = round(min(s["minMarginPx"] for s in ss), 1)
        row["canvas"] = ss[0]["canvas"]
        row["overlayPx"] = [s["overlayPx"] for s in ss]
        row["lowY"] = [s.get("lowY") for s in ss]
        row["consoleErrors"] = v["consoleErrorCount"]
        out[v["view"]] = row
    return out


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", default=str(ROOT / "dist"))
    ap.add_argument("--out", default="")
    ap.add_argument("--shots", default="", help="스크린샷 폴더(기본 shots/avatar)")
    ap.add_argument("--view", default="", help="한 화면만(폰375 · 데스크톱)")
    a = ap.parse_args()
    global SHOT_DIR
    if a.shots:
        SHOT_DIR = Path(a.shots)
    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    from playwright.async_api import async_playwright

    httpd = serve(Path(a.dist))
    port = httpd.server_address[1]
    async with async_playwright() as p:
        exe = next((c for c in ("/usr/bin/google-chrome", "/usr/bin/chromium-browser",
                                "/usr/bin/chromium") if Path(c).exists()), None)
        browser = await p.chromium.launch(executable_path=exe, args=["--no-sandbox"])
        todo = [VIEW_BY_NAME[a.view]] if a.view else VIEWS
        views = []
        for v in todo:
            # 화면마다 브라우저를 새로 띄운다 — 한 화면에서 WebGL이 멈추면 다음 화면까지 끌려간다.
            try:
                views.append(await measure_view(browser, port, *v))
            except Exception as e:  # noqa: BLE001
                print(f"  ✗ {v[0]}: {e.__class__.__name__} {e}", file=sys.stderr)
        await browser.close()
    httpd.shutdown()
    summary = summarize(views)
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    if a.out:
        Path(a.out).write_text(json.dumps({"summary": summary, "views": views}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    asyncio.run(main())
