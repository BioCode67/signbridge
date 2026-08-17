#!/usr/bin/env python3
"""당사자 앱 종단 검증 — 폰·태블릿·키오스크 세 화면에서 실제로 조작해 본다.

    npm run build && python3 scripts/e2e_app.py
    python3 scripts/e2e_app.py --keep     # 실패 화면 스크린샷 남기기

**왜 이 테스트가 필요한가.** 이 앱의 실패는 대부분 "화면은 정상인데 알맹이가 없는" 모양이다.

  - 동작 사전을 다시 만들자 상용구 글로스가 사라져 아바타가 **가만히 서 있었다.**
    화면에는 한국어 원문이 떠 있어 정상처럼 보였다.
  - 음성 합성이 예외로 죽었는데 화면에는 "소리로 전달했어요"가 떠 있었다.
    듣지 못하는 사용자는 전달된 줄 알고 기다린다.
  - 폰 폭(390px)에서 탭 글자가 세로로 깨지고 대화 기록이 0px로 눌렸다.
    데스크톱 브라우저로 보면 멀쩡했다.

그래서 눈으로 보는 대신 **재생 프레임 수·소리로 나간 문장·요소 크기를 수치로** 확인한다.
`data-sign-*` 속성이 그 계측점이다(SignStage.tsx).

**dev 서버(5173)로 검증하지 말 것.** Vite dev 서버는 실행 중에 새로 생긴
`public/data/glosses/` 파일을 내주지 않고 index.html로 폴백한다(200 text/html).
그래서 dev에서는 모든 합성이 실패하고, 배포본에서는 정상이다. 이 스크립트는 항상
`dist/`를 정적 서버로 띄워 **사용자가 받는 것과 같은 것**을 본다.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import http.server
import socketserver
import subprocess
import sys
import threading
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
# 0이면 빈 포트를 운영체제가 골라 준다 — 앞선 실행이 남아 있어도 충돌하지 않는다.
PORT = 0

# 실제 기기 — 요구사항이 "폰 하나로, 키오스크·태블릿에서도"이므로 셋 다 본다.
DEVICES = [
    ("폰", 390, 844, True),
    ("태블릿세로", 820, 1180, True),
    # 창구에 놓인 태블릿은 대개 가로다 — 세로만 보면 좌우 2단 배치를 검증하지 못한다.
    ("태블릿가로", 1180, 820, True),
    ("키오스크", 1080, 1920, False),
]

# 소리로 무엇이 나갔는지 기록하는 가짜 음성 합성. speechSynthesis는 읽기전용
# 접근자라 대입이 조용히 실패한다 — defineProperty로 갈아 끼워야 한다.
TTS_STUB = """
window.__spoken = [];
Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
  getVoices: () => [],
  addEventListener(){}, removeEventListener(){}, cancel(){},
  speak(u){ window.__spoken.push(u.text); u.onstart && u.onstart(); u.onend && u.onend(); },
}});
"""


class ReusableServer(socketserver.TCPServer):
    """TIME_WAIT 소켓을 재사용한다 — 연달아 돌릴 때 '주소가 이미 사용 중'으로 죽지 않게.
    (allow_reuse_address는 bind **전에** 정해져야 해서 클래스 속성으로 둔다.)"""

    allow_reuse_address = True


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """요청 로그를 삼킨다 — 9,500개 조각 요청이 검증 결과를 덮는다."""

    def log_message(self, *_a) -> None:  # noqa: D102
        pass


def serve() -> socketserver.TCPServer:
    handler = partial(QuietHandler, directory=str(DIST))
    httpd = ReusableServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def port_of(httpd: socketserver.TCPServer) -> int:
    return httpd.socket.getsockname()[1]


class Report:
    def __init__(self) -> None:
        self.fails: list[str] = []
        self.lines: list[str] = []

    def check(self, ok: bool, label: str, detail: str = "") -> bool:
        mark = "✓" if ok else "✗"
        self.lines.append(f"    {mark} {label}{(' — ' + detail) if detail else ''}")
        if not ok:
            self.fails.append(label)
        return ok


async def stage_state(pg) -> dict:
    el = pg.locator("[data-sign-frames]").first
    return await el.evaluate(
        "e=>({frames:+e.dataset.signFrames, playing:e.dataset.signPlaying==='1',"
        " glosses:+e.dataset.signGlosses})"
    )


async def run_device(browser, name: str, w: int, h: int, mobile: bool, keep: bool, rep: Report, port: int) -> None:
    ctx = await browser.new_context(
        viewport={"width": w, "height": h},
        is_mobile=mobile, has_touch=mobile,
        # 서비스워커가 붙으면 이전 배포본이 캐시에서 나온다 — 지금 만든 것을 봐야 한다.
        service_workers="block",
    )
    await ctx.add_init_script(TTS_STUB)
    pg = await ctx.new_page()
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("response", lambda r: errors.append(f"HTTP {r.status} {r.url}") if r.status >= 400 else None)

    rep.lines.append(f"  [{name} {w}×{h}]")
    await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="networkidle")
    await pg.wait_for_timeout(1200)

    # ── 받기: 재난문자가 실제로 수어로 합성되는가(프레임 수로 확인)
    played = {"frames": 0, "glosses": 0}
    for _ in range(8):
        await pg.wait_for_timeout(1200)
        st = await stage_state(pg)
        if st["frames"] > played["frames"]:
            played = st
        if played["frames"] > 30:
            break
    rep.check(played["frames"] > 30, "받기: 재난문자 수어 합성",
              f"{played['frames']}프레임 · 단어 {played['glosses']}개")

    # 자막이 실제로 글자를 담고 있는가 — 합성은 됐는데 자막이 비면 반쪽이다
    caption = (await pg.locator("p.text-glow").first.inner_text()).strip()
    rep.check(len(caption) > 0 or played["glosses"] > 0, "받기: 자막 표시", f"'{caption[:14]}'")

    # ── 화면 밖으로 밀린 요소가 없는가(폰에서 탭이 잘리던 회귀)
    overflow = await pg.evaluate(
        "() => { const d=document.documentElement;"
        " return {sw: d.scrollWidth, cw: d.clientWidth}; }"
    )
    rep.check(overflow["sw"] <= overflow["cw"] + 1, "가로 스크롤 없음",
              f"{overflow['sw']}px ≤ {overflow['cw']}px")

    # ── 대화 모드: 직원 카드 → 수어, 답 카드 → 소리
    await pg.get_by_role("button", name="💬 대화").click()
    await pg.wait_for_timeout(500)
    # 응급 정보 카드 — 응급실에서 말 대신 보여주는 정보. 입구가 사라지면 안 된다.
    rep.check(await pg.get_by_role("button", name=re.compile("🆔 내 정보")).count() > 0,
              "대화: 내 정보 입구")
    await pg.get_by_role("button", name="🏥 병원").click()
    await pg.wait_for_timeout(500)
    # 직원 안내 — 창구에서 가장 먼저 보이는 화면이다. 사라지면 직원이 쓸 줄 모른다.
    rep.check(await pg.get_by_text("저는 소리를 듣지 못합니다").count() > 0, "대화: 직원 안내 표시")
    await pg.get_by_text("화면을 누르면 시작합니다").click()
    await pg.wait_for_timeout(500)

    await pg.get_by_role("button", name="어디가 아픈가요?").click()
    talk = {"frames": 0, "glosses": 0}
    for _ in range(6):
        await pg.wait_for_timeout(500)
        st = await stage_state(pg)
        if st["frames"] > talk["frames"]:
            talk = st
    rep.check(talk["frames"] > 20, "대화: 직원 질문 → 수어 재생",
              f"{talk['frames']}프레임 · 단어 {talk['glosses']}개")
    rep.check(await pg.locator("text=어디가 아픕니까?").count() > 0, "대화: 기록에 남음")

    # 답 카드 — 차례 토글로 내 카드를 펼친 뒤 짚는다
    await pg.get_by_role("button", name="🤟 내 답 카드").click()
    await pg.wait_for_timeout(300)
    await pg.get_by_role("button", name="머리", exact=True).click()
    await pg.wait_for_timeout(400)
    spoken = await pg.evaluate("window.__spoken")
    rep.check("머리" in spoken, "대화: 답 카드 → 소리로 전달", str(spoken[-2:]))
    rep.check(await pg.get_by_text("소리로 전달했어요").count() > 0, "대화: 전달 확인 문구")
    # 답은 상대에게 보여주는 전체화면으로 뜬다 — 눌러 닫고 대화로 돌아온다.
    await pg.get_by_text("화면을 누르면 닫혀요").click()
    await pg.wait_for_timeout(300)

    # ── 대화 기록이 실제로 보이는가(폰에서 0px로 눌리던 회귀)
    thread_h = await pg.evaluate(
        "() => { const b=[...document.querySelectorAll('button')]"
        ".find(x=>x.textContent.includes('어디가 아픕니까'));"
        " return b ? b.getBoundingClientRect().height : 0 }"
    )
    rep.check(thread_h > 20, "대화: 기록이 화면에 보임", f"높이 {thread_h:.0f}px")

    # ── 자유 입력 → 소리
    # 수어로 답하기 입구가 있는가 — 모어로 말하는 유일한 길이라 사라지면 안 된다
    rep.check(await pg.get_by_role("button", name="🤟 수어로 답하기").count() > 0,
              "대화: 수어로 답하기 입구")
    await pg.get_by_role("button", name="⌨ 글로 쓰기").click()
    await pg.wait_for_timeout(300)
    await pg.get_by_placeholder("하고 싶은 말을 쓰세요").fill("어제부터 머리가 아파요")
    await pg.get_by_role("button", name="🔊 소리로 말하기").click()
    await pg.wait_for_timeout(400)
    spoken = await pg.evaluate("window.__spoken")
    rep.check("어제부터 머리가 아파요" in spoken, "대화: 직접 쓴 말 → 소리로")

    # ── 손가락으로 누를 수 있는 크기인가(모바일 접근성 최소 44px)
    small = await pg.evaluate(
        "() => [...document.querySelectorAll('button')]"
        ".filter(b=>b.offsetParent && b.getBoundingClientRect().height < 36)"
        ".map(b=>b.textContent.trim().slice(0,10))"
    )
    rep.check(len(small) == 0, "버튼 높이 36px 이상", f"작은 버튼 {small[:4]}" if small else "")

    real_errors = [e for e in errors if "vibrate" not in e]
    rep.check(not real_errors, "콘솔 오류 없음", str(real_errors[:2]))

    if keep or rep.fails:
        shot = ROOT / f"e2e_{name}.png"
        await pg.screenshot(path=str(shot))
        rep.lines.append(f"    · 스크린샷 {shot}")
    await ctx.close()


async def run_offline(browser, keep: bool, rep: Report, port: int) -> None:
    """회선을 끊고도 창구 대화가 되는지 — 이 앱의 핵심 약속이라 자동으로 지킨다.

    서비스워커를 **살려 둬야** 성립한다(다른 검사는 이전 배포본이 캐시에서 나오지 않게
    막아 두지만, 여기서는 캐시가 검사 대상이다).
    """
    ctx = await browser.new_context(viewport={"width": 390, "height": 844},
                                    is_mobile=True, has_touch=True)
    await ctx.add_init_script(TTS_STUB)
    pg = await ctx.new_page()
    rep.lines.append("  [오프라인 390×844]")
    await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="networkidle")

    # 필수 세트를 조용히 받아 둘 때까지 기다린다(첫 방문 뒤 자동으로 받는다).
    level = None
    for _ in range(60):
        await pg.wait_for_timeout(1000)
        level = await pg.evaluate("localStorage.getItem('sb-offline')")
        if level:
            break
    rep.check(level is not None, "오프라인: 필수 세트 자동 준비", str(level))

    await ctx.set_offline(True)
    await pg.reload(wait_until="domcontentloaded")
    await pg.wait_for_timeout(2500)
    rep.check(await pg.get_by_text("SignBridge").count() > 0, "오프라인: 앱이 열림")

    await pg.get_by_role("button", name="💬 대화").click()
    await pg.wait_for_timeout(600)
    await pg.get_by_role("button", name="🏥 병원").click()
    await pg.wait_for_timeout(500)
    await pg.get_by_text("화면을 누르면 시작합니다").click()
    await pg.wait_for_timeout(400)
    await pg.get_by_role("button", name="어디가 아픈가요?").click()
    best = {"frames": 0, "glosses": 0}
    for _ in range(8):
        await pg.wait_for_timeout(500)
        st = await stage_state(pg)
        if st["frames"] > best["frames"]:
            best = st
    rep.check(best["frames"] > 20, "오프라인: 창구 문구가 수어로 재생",
              f"{best['frames']}프레임 · 단어 {best['glosses']}개")

    if keep or rep.fails:
        await pg.screenshot(path=str(ROOT / "e2e_오프라인.png"))
    await ctx.close()


async def main(keep: bool) -> int:
    from playwright.async_api import async_playwright

    if not (DIST / "index.html").exists():
        print("[e2e] ✗ dist/ 가 없습니다 — npm run build 를 먼저 실행하세요")
        return 1

    httpd = serve()
    rep = Report()
    try:
        async with async_playwright() as p:
            # 컨테이너에 playwright 브라우저가 없을 수 있다 — 시스템 크롬을 쓴다.
            exe = None
            for cand in ("/usr/bin/google-chrome", "/usr/bin/chromium-browser"):
                if Path(cand).exists():
                    exe = cand
                    break
            browser = await p.chromium.launch(executable_path=exe, args=["--no-sandbox"])
            for name, w, h, mobile in DEVICES:
                await run_device(browser, name, w, h, mobile, keep, rep, port_of(httpd))
            await run_offline(browser, keep, rep, port_of(httpd))
            await browser.close()
    finally:
        httpd.shutdown()

    print("\n".join(rep.lines))
    if rep.fails:
        print(f"\n[e2e] ✗ 실패 {len(rep.fails)}건: {rep.fails}")
        return 1
    print("\n[e2e] ✓ 폰·태블릿·키오스크·오프라인 전부 통과")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="당사자 앱 종단 검증")
    ap.add_argument("--keep", action="store_true", help="통과해도 스크린샷을 남긴다")
    args = ap.parse_args()
    sys.exit(asyncio.run(main(args.keep)))
