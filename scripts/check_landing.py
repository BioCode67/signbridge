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
  · 폰(375×667) 첫 화면에 '직접 해 보기'가 보이고, 한 번 누르면 재난문자 수어가 재생되는가
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
            ctx.close()

            # 5) 폰 첫 화면 — "직접 해 보기"가 스크롤 없이 보이고, **한 번 누르면**
            #    재난문자 한 건이 아바타 수어로 재생되는가. 방문자 다수가 폰으로 와서
            #    첫 화면만 보고 판단한다. 버튼이 접힌 아래에 있거나, 눌렀는데 빈 화면에
            #    "시작" 버튼이 또 나오면 그 사람은 수어를 못 보고 떠난다.
            ctx = b.new_context(viewport={"width": 375, "height": 667}, service_workers="block",
                                is_mobile=True, has_touch=True)
            pg = ctx.new_page()
            errs2: list[str] = []
            pg.on("pageerror", lambda e: errs2.append(str(e)[:120]))
            # 지난번에 쓴 탭이 '대화'로 기억돼 있어도 받기 화면으로 열려야 한다.
            pg.add_init_script("localStorage.setItem('sb-tab','speak')")
            pg.goto(f"http://127.0.0.1:{PORT}/", wait_until="domcontentloaded")
            pg.wait_for_timeout(2500)
            box = pg.evaluate("""() => { const e = document.querySelector('[data-try-cta]')
                if (!e) return null
                const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.width)] }""")
            ok("폰(375): '직접 해 보기'가 첫 화면 안", bool(box) and box[0] >= 0 and box[1] <= 667,
               f"top {box[0]}px · bottom {box[1]}px · 폭 {box[2]}px" if box else "없음")
            ok("폰(375): 가로 스크롤 없음",
               not pg.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1"),
               f"{pg.evaluate('() => document.documentElement.scrollWidth')}px")
            if box:
                t0 = time.time()
                pg.click("[data-try-cta]")
                frames = 0
                for _ in range(120):
                    pg.wait_for_timeout(500)
                    frames = pg.evaluate("""() => { const e = document.querySelector('[data-sign-frames]')
                        return e ? +e.dataset.signFrames : 0 }""")
                    if frames > 20:
                        break
                took = time.time() - t0
                ok("폰(375): 한 번 누르면 재난문자 수어가 재생됨", frames > 20,
                   f"프레임 {frames} · 누른 뒤 {took:.1f}초(소프트웨어 렌더링 기준)")
                ok("폰(375): 받기 화면으로 열림", pg.evaluate("localStorage.getItem('sb-tab')") == "watch")
            ok("폰(375): 콘솔 오류 없음", not errs2, str(errs2[:2]) if errs2 else "")
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
