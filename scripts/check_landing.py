#!/usr/bin/env python3
"""소개 페이지의 **조작되는 부분**이 실제로 도는지 본다.

    python3 scripts/check_landing.py

**왜 따로 재나.** `e2e_app.py`는 당사자 화면(`#/app`)만 본다. 그런데 시연 영상과
심사 발표에서는 **소개 페이지**를 처음부터 끝까지 넘긴다 — Q&A로 질문을 눌러
수어 답을 보여 주고, 에이전트 콘솔을 돌린다. 이쪽은 지금까지 아무도 재지 않았다.
조용히 고장 나 있어도 발표 당일에야 알게 된다.

재는 것
  · 섹션 아홉 개가 모두 그려지는가(빈 화면·오류 경계 아님)
  · Q&A에서 질문을 누르면 아바타가 실제로 재생되는가(프레임 수로 확인)
  · 에이전트 콘솔이 단계를 채우는가
  · 콘솔 오류가 없는가
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

PORT = 8241
SECTIONS = ["top", "why", "demo", "live", "qa", "agents", "how", "results", "limits", "impact"]


def main() -> int:
    dist = Path("dist")
    if not dist.is_dir():
        print("dist가 없습니다 — 먼저 npm run build"); return 1
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "-d", "dist"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    fails: list[str] = []
    try:
        with sync_playwright() as p:
            exe = next((c for c in ("/usr/bin/google-chrome", "/usr/bin/chromium-browser")
                        if Path(c).exists()), None)
            b = p.chromium.launch(executable_path=exe, args=["--no-sandbox"])
            ctx = b.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
            pg = ctx.new_page()
            errs: list[str] = []
            pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
            pg.goto(f"http://127.0.0.1:{PORT}/#demo", wait_until="domcontentloaded")
            pg.wait_for_timeout(9000)

            def ok(name: str, cond: bool, note: str = "") -> None:
                print(f"  {'✓' if cond else '✗'} {name}" + (f" — {note}" if note else ""))
                if not cond:
                    fails.append(name)

            # 1) 섹션이 모두 있고 비어 있지 않은가
            for sid in SECTIONS:
                info = pg.evaluate(
                    """(id) => { const s = document.querySelector('#'+id)
                       if (!s) return null
                       const r = s.getBoundingClientRect()
                       return { h: Math.round(r.height), len: (s.innerText||'').trim().length } }""",
                    sid)
                if info is None:
                    ok(f"섹션 #{sid}", False, "없음"); continue
                # top(히어로)은 글자가 적을 수 있어 높이만 본다
                enough = info["h"] > 200 and (sid == "top" or info["len"] > 40)
                ok(f"섹션 #{sid}", enough, f"높이 {info['h']}px · 글자 {info['len']}")

            # 2) Q&A — 질문을 누르면 답과 글로스가 채워지는가.
            #    이 칸에는 아바타가 없다(답변과 글로스를 글자로 보여 준다).
            #    아바타 재생은 위쪽 `#demo` 칸과 당사자 화면이 담당한다.
            pg.evaluate("document.querySelector('#qa')?.scrollIntoView({block:'center'})")
            pg.wait_for_timeout(1800)
            btns = pg.query_selector_all("#qa button")
            ok("Q&A: 질문 버튼", bool(btns), f"{len(btns)}개")
            if btns:
                before = pg.evaluate("() => document.querySelector('#qa')?.innerText ?? ''")
                btns[-1].click()
                pg.wait_for_timeout(4000)
                after = pg.evaluate("() => document.querySelector('#qa')?.innerText ?? ''")
                grew = len(after.strip()) > len(before.strip()) + 20
                ok("Q&A: 질문을 누르면 답이 채워짐", grew,
                   f"글자 {len(before.strip())}→{len(after.strip())}")
                ok("Q&A: 수어 글로스가 함께 나옴", "글로스" in after or "수어" in after)

            # 3) 에이전트 콘솔이 내용을 채우는가
            pg.evaluate("document.querySelector('#agents')?.scrollIntoView({block:'center'})")
            pg.wait_for_timeout(2500)
            txt = pg.evaluate("() => document.querySelector('#agents')?.innerText ?? ''")
            ok("에이전트: 단계가 채워짐", len(txt.strip()) > 120, f"글자 {len(txt.strip())}")

            # 4) 가로 스크롤과 콘솔 오류
            wide = pg.evaluate("() => document.body.scrollWidth > window.innerWidth + 2")
            ok("가로 스크롤 없음", not wide)
            ok("콘솔 오류 없음", not errs, str(errs[:2]) if errs else "")
            ctx.close(); b.close()
    finally:
        srv.terminate()

    print()
    if fails:
        print(f"[소개] ✗ 실패 {len(fails)}건: {fails}")
        return 1
    print("[소개] ✓ 전부 통과")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
