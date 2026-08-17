#!/usr/bin/env python3
"""시연 동영상 리허설 — 대본의 조작을 순서대로 눌러 보고 되는지 확인한다.

    npm run build && python3 scripts/demo_rehearsal.py

**왜 필요한가.** 시연 동영상은 편집이 금지돼 있고(가이드라인) 5분 안에 끝내야 한다.
촬영 도중에 버튼 하나가 안 눌리면 처음부터 다시 찍어야 한다. 대본
(`deploy/report/시연동영상_대본.md`)의 조작을 **그대로 따라 하는 리허설**을 자동으로
돌려, 촬영 전에 막히는 곳을 미리 찾는다.

카메라·마이크가 필요한 장면은 사람이 해야 하므로 여기서는 **입구가 열리는지까지**만
확인한다(버튼이 있고 눌리고 패널이 뜨는지). 그 뒤는 사람이 손과 목소리로 채운다.

각 단계는 대본의 장면 번호와 함께 보고한다 — 실패하면 어느 장면을 고쳐야 하는지
바로 알 수 있게.
"""

from __future__ import annotations

import asyncio
import http.server
import socketserver
import sys
import threading
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"

TTS_STUB = """
window.__spoken = [];
Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
  getVoices: () => [], addEventListener(){}, removeEventListener(){}, cancel(){},
  speak(u){ window.__spoken.push(u.text); u.onstart && u.onstart(); u.onend && u.onend(); },
}});
"""


class Reusable(socketserver.ThreadingTCPServer):
    """요청 동시 처리 — 단일 스레드면 브라우저가 연결을 붙잡는 동안 다른 요청이 줄 선다."""

    allow_reuse_address = True
    daemon_threads = True


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_a) -> None:
        pass


async def tap(locator) -> None:
    """누르고, 눌린 직후 화면이 덮여도 실패로 보지 않는다.

    답 화면은 누르자마자 전체를 덮는다. 플레이라이트는 누른 뒤에도 그 요소를 다시
    확인하려 하다가 "가려졌다"며 재시도하고 결국 시간이 초과된다 — **동작은 이미
    일어났는데** 실패로 잡힌다. 그래서 여기서는 누르는 것까지만 하고, 성공 여부는
    다음 단계에서 **결과로** 확인한다(소리가 나갔는가, 화면이 닫혔는가).
    """
    try:
        await locator.click(timeout=5000)
    except Exception:  # noqa: BLE001
        # 이미 눌렸는지는 호출부가 결과로 판단한다.
        pass


class Rehearsal:
    def __init__(self) -> None:
        self.fails: list[str] = []

    async def step(self, scene: str, what: str, action) -> None:
        try:
            await action()
            print(f"  ✓ [{scene}] {what}")
        except Exception as exc:  # noqa: BLE001 — 어떤 실패든 촬영을 막는다
            detail = "\n      ".join(str(exc).splitlines()[:6])
            print(f"  ✗ [{scene}] {what}\n      {detail}")
            self.fails.append(f"{scene} · {what}")


async def main() -> int:
    from playwright.async_api import async_playwright

    if not (DIST / "index.html").exists():
        print("[리허설] ✗ dist/ 가 없습니다 — npm run build 를 먼저 실행하세요")
        return 1

    httpd = Reusable(("127.0.0.1", 0), partial(Quiet, directory=str(DIST)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    port = httpd.socket.getsockname()[1]
    r = Rehearsal()

    exe = next((c for c in ("/usr/bin/google-chrome", "/usr/bin/chromium-browser")
                if Path(c).exists()), None)
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=exe, args=["--no-sandbox"])
        # 촬영은 1920×1080 창에서 한다 — 그 크기로 리허설한다.
        ctx = await browser.new_context(viewport={"width": 1920, "height": 1080},
                                        service_workers="block")
        await ctx.add_init_script(TTS_STUB)
        pg = await ctx.new_page()

        print("[리허설] 대본 순서대로 눌러 봅니다\n")

        await r.step("장면1", "소개 페이지가 열린다",
                     lambda: pg.goto(f"http://127.0.0.1:{port}/", wait_until="networkidle"))
        await pg.wait_for_timeout(1500)
        async def demo_section() -> None:
            # 소개 페이지는 3D·애니메이션이 많아 뜨는 데 시간이 걸린다.
            await pg.locator("#demo").first.wait_for(timeout=20000, state="attached")

        await r.step("장면1", "수어 데모 섹션이 있다", demo_section)

        await r.step("장면2", "수어 이용자 화면으로 이동",
                     lambda: pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="networkidle"))
        await pg.wait_for_timeout(1500)
        await r.step("장면2", "[💬 대화] 탭",
                     lambda: pg.get_by_role("button", name="💬 대화").click(timeout=8000))
        await pg.wait_for_timeout(600)
        await r.step("장면2", "🏥 병원 선택",
                     lambda: pg.get_by_role("button", name="🏥 병원").click(timeout=8000))
        await pg.wait_for_timeout(500)
        await r.step("장면2", "직원 안내가 먼저 뜬다",
                     lambda: pg.get_by_text("저는 소리를 듣지 못합니다").wait_for(timeout=5000))
        await r.step("장면2", "안내를 닫고 대화 시작",
                     lambda: pg.get_by_text("화면을 누르면 시작합니다").click(timeout=5000))
        await pg.wait_for_timeout(500)
        await r.step("장면2", "🎙 직원이 말하기 버튼이 있다(육성은 사람이)",
                     lambda: pg.get_by_role("button", name="🎙 직원이 말하면 수어로").wait_for(timeout=5000))
        await r.step("장면2", "질문 카드를 누르면 수어가 재생된다",
                     lambda: pg.get_by_role("button", name="어디가 아픈가요?").click(timeout=8000))
        await pg.wait_for_timeout(2500)

        async def played() -> None:
            frames = await pg.locator("[data-sign-frames]").first.evaluate(
                "e => +e.dataset.signFrames")
            assert frames > 20, f"재생 프레임 {frames}개 — 합성이 실패했습니다"

        await r.step("장면2", "아바타가 실제로 움직인다", played)
        async def to_my_cards() -> None:
            await tap(pg.get_by_role("button", name="🤟 내 답 카드"))
            await pg.wait_for_timeout(400)
            assert await pg.get_by_role("button", name="머리", exact=True).count() > 0, \
                "내 답 카드가 펼쳐지지 않았습니다"

        await r.step("장면2", "[🤟 내 답 카드]로 전환", to_my_cards)
        async def pick_and_speak() -> None:
            await tap(pg.get_by_role("button", name="머리", exact=True))
            await pg.wait_for_timeout(600)
            spoken = await pg.evaluate("window.__spoken")
            assert "머리" in spoken, f"소리로 나간 말: {spoken}"

        await r.step("장면2", "답 카드 '머리' 짚기 → 소리로 나간다", pick_and_speak)

        async def close_answer() -> None:
            await tap(pg.get_by_text("화면을 누르면 닫혀요"))
            await pg.wait_for_timeout(500)
            left = await pg.get_by_text("화면을 누르면 닫혀요").count()
            assert left == 0, "답 화면이 닫히지 않았습니다"

        await r.step("장면2", "답 화면을 닫는다", close_answer)
        async def open_writing() -> None:
            await tap(pg.get_by_role("button", name="⌨ 글로 쓰기"))
            await pg.wait_for_timeout(400)
            await pg.get_by_placeholder("하고 싶은 말을 쓰세요").wait_for(timeout=5000)

        await r.step("장면2", "[⌨ 글로 쓰기]로 입력창 열기", open_writing)
        await r.step("장면2", "자유 문장 입력",
                     lambda: pg.get_by_placeholder("하고 싶은 말을 쓰세요")
                     .fill("어제부터 머리가 아파요"))
        async def speak_written() -> None:
            await tap(pg.get_by_role("button", name="🔊 소리로 말하기"))
            await pg.wait_for_timeout(600)
            spoken = await pg.evaluate("window.__spoken")
            assert "어제부터 머리가 아파요" in spoken, f"소리로 나간 말: {spoken}"

        await r.step("장면2", "[🔊 소리로 말하기] → 문장이 소리로", speak_written)
        await r.step("장면2", "닫고 이어서", close_answer)
        await r.step("장면2", "[🤟 수어로 답하기] 입구가 있다(카메라는 사람이)",
                     lambda: pg.get_by_role("button", name="🤟 수어로 답하기").wait_for(timeout=5000))

        await r.step("장면3", "[🙋 질문] 탭(카메라 인식)",
                     lambda: pg.get_by_role("button", name="🙋 질문").click(timeout=8000))
        await pg.wait_for_timeout(1500)

        await r.step("장면4", "[📥 오프라인] 버튼이 있다",
                     lambda: pg.get_by_role("button", name="📥", exact=False).first.wait_for(timeout=5000))
        await r.step("장면4", "[💬 대화]로 돌아가 🆘 긴급",
                     lambda: pg.get_by_role("button", name="💬 대화").click(timeout=5000))
        await pg.wait_for_timeout(600)
        # 장소 화면으로 나가야 긴급 버튼이 보인다
        back = pg.get_by_role("button", name="← 장소")
        if await back.count():
            await back.click()
            await pg.wait_for_timeout(400)
        await r.step("장면4", "🆘 긴급 화면",
                     lambda: pg.get_by_role("button", name="🆘 긴급 도움 요청").click(timeout=5000))
        await pg.wait_for_timeout(500)
        await r.step("장면4", "SOS 문구가 크게 뜬다",
                     lambda: pg.get_by_text("저는 청각장애인입니다").wait_for(timeout=5000))

        await pg.screenshot(path=str(ROOT / "리허설_마지막화면.png"))
        await browser.close()
    httpd.shutdown()

    print()
    if r.fails:
        print(f"[리허설] ✗ 촬영 전에 고칠 것 {len(r.fails)}건")
        for f in r.fails:
            print(f"   · {f}")
        return 1
    print("[리허설] ✓ 대본의 모든 조작이 됩니다 — 카메라·마이크만 사람이 채우면 됩니다")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
