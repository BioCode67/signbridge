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
import time
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


class ReusableServer(socketserver.ThreadingTCPServer):
    """TIME_WAIT 소켓 재사용 + **요청 동시 처리**.

    단일 스레드 TCPServer로 두면 브라우저가 연결을 붙잡고 있는 동안 다른 요청이 줄을
    선다. 실측에서 창구 문구 하나를 재생하는 데 5~7초가 걸리는 것처럼 보였는데,
    앱이 아니라 **이 서버가 막고 있던 것**이었다(같은 문구를 처음 누를 때는 126ms).
    검증 도구가 만든 지연을 앱의 지연으로 오해하면 엉뚱한 곳을 고치게 된다.
    """

    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        """끊긴 연결은 조용히 넘긴다.

        서비스워커가 배경 갱신 요청을 취소하면 `ConnectionResetError`가 나는데,
        정상 동작이다. 그대로 두면 파이썬이 스택 트레이스를 찍어 **검증 로그가
        오류처럼 보인다**(실제로 이 때문에 통과한 판을 실패로 읽었다).
        진짜 오류는 그대로 올린다.
        """
        import sys as _sys
        if _sys.exc_info()[0] in (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            return
        super().handle_error(request, client_address)


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
    """검사 결과를 모으고 **그 자리에서 바로 찍는다.**

    예전에는 끝에서 한 번에 찍었는데, 검사 한 판이 길어지자(카메라 화면이 들어온
    뒤로 20분을 넘겼다) 로그가 0바이트라 **멈춘 건지 도는 건지 알 수 없었다.**
    진행이 보이면 어디서 느려지는지도 함께 보인다."""

    def __init__(self) -> None:
        self.fails: list[str] = []
        self.lines: list[str] = []
        self.t0 = time.monotonic()

    def check(self, ok: bool, label: str, detail: str = "") -> bool:
        mark = "✓" if ok else "✗"
        line = f"    {mark} {label}{(' — ' + detail) if detail else ''}"
        self.lines.append(line)
        print(f"[{time.monotonic() - self.t0:6.0f}s]{line}", flush=True)
        if not ok:
            self.fails.append(label)
        return ok

    def note(self, line: str) -> None:
        self.lines.append(line)
        print(f"[{time.monotonic() - self.t0:6.0f}s]{line}", flush=True)



async def visible(loc, timeout: int = 12000) -> bool:
    """요소가 보일 때까지 기다린다 — **고정 대기 뒤에 count()를 세지 않는다.**

    `wait_for_timeout(600)` 뒤에 `count()`를 세면, 부하가 걸린 판에서 아직 안
    그려진 화면을 "없다"로 읽는다. 실제로 2026-08-19~20에 묻기 검사 네 항목이
    함께 실패했다가 단독으로 돌리면 늘 통과했다. **부하에 따라 답이 바뀌는 검사는
    못 믿는다** — 없으면 없다고, 늦으면 기다렸다가 답해야 한다.
    """
    try:
        await loc.first.wait_for(state="visible", timeout=timeout)
        return True
    except Exception:
        return False

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
        # 위치를 준다. 없으면 `묻기`의 **답변 화면과 방향 지도가 통째로 검사 밖**에
        # 남는다 — 계산이 맞는지는 check_nearby.mjs가 재지만, 그림이 실제로
        # 그려지는지는 아무도 재지 않았다(2026-08-20에 알았다). 서울시청 좌표.
        geolocation={"latitude": 37.5665, "longitude": 126.9780},
        permissions=["geolocation"],
    )
    await ctx.add_init_script(TTS_STUB)
    pg = await ctx.new_page()
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    # console.warn 은 따로 모은다 — 동봉 모델 로드 실패는 예외가 아니라 경고로 나온다.
    # (오류 목록에 섞으면 무해한 라이브러리 경고까지 검사를 깨뜨린다.)
    warns: list[str] = []
    pg.on("console", lambda m: warns.append(m.text) if m.type == "warning" else None)
    # 학습 번역 모델(models/t2g)은 **있으면 쓰고 없으면 사전으로 되돌아가는** 선택 자산이다.
    # 아직 안 실은 배포본에서 404가 나는 것은 정상 동작이라 오류로 세지 않는다.
    # (그 외 404는 그대로 잡는다 — 조각·모델이 빠진 배포를 놓치면 안 된다.)
    OPTIONAL_404 = "/models/t2g/"
    pg.on("response", lambda r: errors.append(f"HTTP {r.status} {r.url}")
          if r.status >= 400 and OPTIONAL_404 not in r.url else None)

    rep.note(f"  [{name} {w}×{h}]")
    # **networkidle을 기다리지 않는다.** 이 앱은 첫 방문 뒤 오프라인 필수 세트
    # 13MB를 조용히 내려받기 시작해서, 망이 한가해지는 순간이 한동안 오지 않는다.
    # 기기가 바쁠 때는 30초 안에 오지 않아 검사가 통째로 죽는다(실측).
    # 화면이 뜬 것만 확인하고 넘어간다 — 이어지는 검사들이 어차피 결과를 기다린다.
    await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="domcontentloaded")
    await pg.wait_for_timeout(2500)

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

    # ── 행동요령: 재난 종류에 맞는 요령을 문장 단위로 수어로 본다
    guide = pg.get_by_role("button", name="📋 행동요령")
    # 갈래 41종 중 21종에만 행동요령이 있다 — 없는 갈래가 뜨면 버튼도 없다.
    # 그때 검사를 조용히 건너뛰면 "통과"에 이 항목이 통째로 빠진다. 남긴다.
    if not await guide.count():
        rep.note("    · 이 재난 갈래에는 행동요령이 없어 관련 검사 2건을 건너뜀")
    if await guide.count():
        # 재생 중에는 자막 줄이 프레임마다 다시 그려져 배지가 흔들린다 —
        # 클릭이 "element is not stable"로 실패할 수 있다(실측에서 한 번 났고,
        # **그 예외 하나가 검사 전체를 중단시켰다**). 흔들림은 재생을 멈추면
        # 사라지므로 무대를 한 번 눌러 세운 뒤 클릭한다.
        try:
            await pg.locator("[data-sign-frames]").first.click(timeout=3000)
            await pg.wait_for_timeout(300)
        except Exception:
            pass
        await guide.first.click(timeout=15000)
        await pg.wait_for_timeout(500)
        steps = pg.locator("button", has_text="세요")
        rep.check(await visible(steps), "받기: 행동요령 문장 목록")
        prev = await pg.locator("[data-sign-frames]").first.evaluate("e=>e.dataset.signFrames")
        await steps.first.click()
        played = False
        for _ in range(8):
            await pg.wait_for_timeout(500)
            now = await pg.locator("[data-sign-frames]").first.evaluate("e=>e.dataset.signFrames")
            if now != prev and int(now) > 20:
                played = True
                break
        rep.check(played, "받기: 행동요령 문장이 수어로 재생")
    else:
        rep.lines.append("    · 행동요령 버튼이 이번 문자에는 없어 건너뜀")

    # ── 화면 밖으로 밀린 요소가 없는가(폰에서 탭이 잘리던 회귀)
    overflow = await pg.evaluate(
        "() => { const d=document.documentElement;"
        " return {sw: d.scrollWidth, cw: d.clientWidth}; }"
    )
    rep.check(overflow["sw"] <= overflow["cw"] + 1, "가로 스크롤 없음",
              f"{overflow['sw']}px ≤ {overflow['cw']}px")

    # ── 무엇이 번역했는가 · 고개 동작이 붙었는가
    #
    # **"오류가 없다"로는 부족하다.** 학습 모델이 안 뜨면 통계 사전이 대신 답하는데
    # 화면도 콘솔도 똑같다(실측: ORT 진입점이 달라 wasm을 404로 못 찾아 30MB짜리
    # 모델이 한 번도 안 쓰이고 있었다). 재지 않으면 영영 모른다.
    #
    # 모델은 30MB라 첫 문장은 일부러 사전으로 답한다 — 그래서 몇 문장 흘려보내며 본다.
    backend = None
    for _ in range(20):
        await pg.wait_for_timeout(1000)
        st = await pg.locator("[data-sign-backend]").first.evaluate(
            "e => ({backend: e.dataset.signBackend, head: +e.dataset.signHead})"
        )
        backend = st["backend"]
        if backend == "nn":
            break
        # 다음 문자를 재생시켜 번역을 한 번 더 돌게 한다
        nxt = pg.get_by_role("button", name=re.compile("다음"))
        if await nxt.count():
            await nxt.first.click()
    if (DIST / "models/t2g/meta.json").exists():
        rep.check(backend == "nn", "번역: 학습 모델이 실제로 쓰임", str(backend))
    else:
        rep.note("    · 학습 모델이 배포본에 없어 사전 사용(정상) — 검사 건너뜀")

    # ── 대화 모드: 직원 카드 → 수어, 답 카드 → 소리
    await pg.get_by_role("button", name="💬 대화").click()
    await pg.wait_for_timeout(500)
    # 응급 정보 카드 — 응급실에서 말 대신 보여주는 정보. 입구가 사라지면 안 된다.
    #
    # **기다렸다가 본다.** count() 한 번으로 보면 화면이 아직 안 그려졌을 때
    # 없다고 판정한다 — 실측에서 다른 검사가 같이 돌아 느려진 판에서만
    # 이 항목이 실패했고, 따로 열어 보면 멀쩡했다. 부하에 따라 결과가 바뀌는
    # 검사는 있으나 마나다.
    info_btn = pg.get_by_role("button", name=re.compile("🆔 내 정보")).first
    try:
        await info_btn.wait_for(state="visible", timeout=15000)
        info_ok = True
    except Exception:
        info_ok = False
    rep.check(info_ok, "대화: 내 정보 입구")

    await pg.get_by_role("button", name="🏥 병원").click()
    await pg.wait_for_timeout(500)
    # 직원 안내 — 창구에서 가장 먼저 보이는 화면이다. 사라지면 직원이 쓸 줄 모른다.
    rep.check(await visible(pg.get_by_text("저는 소리를 듣지 못합니다")), "대화: 직원 안내 표시")
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
    rep.check(await visible(pg.locator("text=어디가 아픕니까?")), "대화: 기록에 남음")

    # 답 카드 — 차례 토글로 내 카드를 펼친 뒤 짚는다
    await pg.get_by_role("button", name="🤟 내 답 카드").click()
    await pg.wait_for_timeout(300)
    await pg.get_by_role("button", name="머리", exact=True).click()
    await pg.wait_for_timeout(400)
    spoken = await pg.evaluate("window.__spoken")
    rep.check("머리" in spoken, "대화: 답 카드 → 소리로 전달", str(spoken[-2:]))
    rep.check(await visible(pg.get_by_text("소리로 전달했어요")), "대화: 전달 확인 문구")
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

    # ── 대화 저장 → 지난 대화에서 다시 보이는가(진료 안내를 나중에 확인하는 길)
    await pg.get_by_role("button", name="💾 저장").click()
    await pg.wait_for_timeout(400)
    await pg.get_by_role("button", name="← 장소").click()
    await pg.wait_for_timeout(400)
    # 장소 화면으로 나오면 접혔던 탭·헤더가 다시 나타난다
    rep.check(await visible(pg.get_by_role("button", name="💬 대화")), "대화: 나오면 탭이 돌아옴")
    await pg.get_by_role("button", name=re.compile("📜 지난 대화")).click()
    await pg.wait_for_timeout(400)
    rep.check(await visible(pg.locator("text=어디가 아픕니까?")), "대화: 저장한 대화 다시 보기")
    await pg.get_by_role("button", name="← 뒤로").click()
    await pg.wait_for_timeout(300)
    await pg.get_by_role("button", name="🏥 병원").click()
    await pg.wait_for_timeout(400)
    await pg.get_by_text("화면을 누르면 시작합니다").click()
    await pg.wait_for_timeout(300)
    await pg.get_by_role("button", name="🤟 내 답 카드").click()
    await pg.wait_for_timeout(300)

    # ── 자유 입력 → 소리
    # 수어로 답하기 입구가 있는가 — 모어로 말하는 유일한 길이라 사라지면 안 된다
    rep.check(await visible(pg.get_by_role("button", name="🤟 수어로 답하기")),
              "대화: 수어로 답하기 입구")
    await pg.get_by_role("button", name="⌨ 글로 쓰기").click()
    await pg.wait_for_timeout(300)
    await pg.get_by_placeholder("하고 싶은 말을 쓰세요").fill("어제부터 머리가 아파요")
    await pg.get_by_role("button", name="🔊 소리로 말하기").click()
    await pg.wait_for_timeout(400)
    spoken = await pg.evaluate("window.__spoken")
    rep.check("어제부터 머리가 아파요" in spoken, "대화: 직접 쓴 말 → 소리로")

    # ── 묻기: 수어로 물어 위치 기반 답을 받는 화면
    #
    # 카메라 앞 실제 수어는 자동으로 재현할 수 없다(가짜 카메라는 빈 영상이다).
    # 그래서 여기서는 **입구가 살아 있는지**와 **장소 목록이 실려 있는지**만 본다.
    # 낱말→의도→답 계산은 check_intent.mjs · check_nearby.mjs 가 따로 잰다.
    # 창구 대화 중에는 탭이 접혀 있다 — 장소에서 나와야 탭이 돌아온다.
    # 방금 소리로 내보낸 답이 전체화면으로 떠 있으면 먼저 닫는다(상대에게 보여주는 화면).
    closer = pg.get_by_text("화면을 누르면 닫혀요")
    if await closer.count():
        await closer.first.click()
        await pg.wait_for_timeout(400)
    await pg.get_by_role("button", name="← 장소").click()
    await pg.wait_for_timeout(500)
    await pg.get_by_role("button", name="📹 묻기").click()
    rep.check(await visible(pg.get_by_text("수어로 물어보세요")), "묻기: 시작 화면")
    rep.check(await visible(pg.get_by_role("button", name="수어로 묻기")), "묻기: 시작 버튼")
    # **시작 화면에서는 탭이 남아 있어야 한다.** 접어 버리면 다른 화면으로 나갈 길이
    # 없어 사용자가 갇힌다(실측: 묻기에 들어가면 탭 막대가 통째로 사라져 있었다).
    rep.check(await visible(pg.get_by_role("button", name="💬 대화")),
              "묻기: 시작 화면에서 탭이 살아 있음")
    # 장소 목록 — 오프라인에서도 답하려면 이 파일이 기기에 있어야 한다
    nearby = await pg.evaluate(
        "async () => { const r = await fetch('./data/nearby.json');"
        " if(!r.ok) return null; const d = await r.json();"
        " return {n: d.places.length, official: d.official,"
        "         kinds: [...new Set(d.places.map(p=>p.kind))].length}; }"
    )
    rep.check(nearby and nearby["n"] > 100, "묻기: 주변 장소 목록",
              f"{nearby['n']}곳 · 갈래 {nearby['kinds']}종 · 공식={nearby['official']}"
              if nearby else "nearby.json 없음")
    # 목록이 공식 지정이 아니면 화면이 그 사실을 말해야 한다 — 대피소는 특히.
    if nearby and not nearby["official"]:
        rep.check(await visible(pg.get_by_text("참고용")), "묻기: 출처가 참고용임을 표시")

    # ── 답변 화면과 방향 지도. **눌러서 묻는 길**로 확인한다(카메라 없이 된다).
    # 여기까지 오지 않으면 방향 지도가 그려지는지 아무도 모른다. 화살표도 숫자도
    # 다 뜨는데 엉뚱한 쪽을 가리키는 실패가 이 앱에 실제로 있었다.
    shelter = pg.get_by_role("button", name=re.compile("대피소 어디"))
    if await visible(shelter, 8000):
        await shelter.first.click()
        # 답이 만들어지고 아바타가 붙을 때까지 기다린다
        got = await visible(pg.get_by_text(re.compile(r"(미터|킬로미터)")), 20000)
        rep.check(got, "묻기: 눌러서 물으면 답이 나온다")
        if got:
            body = await pg.inner_text("body")
            rep.check(any(d in body for d in ("북", "남", "동", "서")), "묻기: 방위가 표시된다")
            # 방향 지도 — 나침반 글자와 목표 표시가 **그려져** 있어야 한다.
            m = await pg.evaluate("""() => {
              const svg = [...document.querySelectorAll('svg')]
                .find(s => (s.getAttribute('aria-label') || '').includes('쪽'))
              if (!svg) return null
              const r = svg.getBoundingClientRect()
              const txt = [...svg.querySelectorAll('text')].map(t => t.textContent)
              const line = svg.querySelector('line')
              return { w: Math.round(r.width), labels: txt,
                       hasLine: !!line,
                       len: line ? Math.hypot(line.x2.baseVal.value - line.x1.baseVal.value,
                                              line.y2.baseVal.value - line.y1.baseVal.value) : 0 }
            }""")
            rep.check(bool(m) and m["w"] > 100, "묻기: 방향 지도가 그려짐",
                      f"{m['w']}px" if m else "svg 없음")
            if m:
                rep.check(all(k in m["labels"] for k in ("북", "동", "남", "서")),
                          "묻기: 나침반 네 방위", str(m["labels"])[:40])
                # 목표 선의 길이가 0이면 **중앙에 붙어 있다** — 방향이 계산되지 않은 것
                rep.check(m["hasLine"] and m["len"] > 5, "묻기: 목표가 중앙이 아님",
                          f"선 길이 {m['len']:.0f}px")
            # 아바타가 답을 수어로 재생하는가.
            # **화면에 계측점이 여러 개 있다**(받기 무대가 숨어 있어도 DOM에 남는다).
            # 첫 번째만 보면 0을 읽는다 — 가장 큰 값을 본다.
            # **바로 읽지 않는다.** 답 문장이 뜬 뒤에도 아바타 합성은 비동기라
            # 몇 초 더 걸린다. 즉시 세면 0을 읽는다(2026-08-20에 그랬다).
            fr = 0
            for _ in range(20):
                fr = await pg.evaluate(
                    "() => Math.max(0, ...[...document.querySelectorAll('[data-sign-frames]')]"
                    ".map(e => Number(e.getAttribute('data-sign-frames')) || 0))")
                if int(fr) > 1:
                    break
                await pg.wait_for_timeout(1000)
            rep.check(int(fr) > 1, "묻기: 답을 수어로 재생", f"{fr}프레임")
        # 다음 검사를 위해 **처음부터 다시 연다.**
        # "또 묻기"로 돌아가면 화면 상태가 뒤 검사가 기대하는 것과 달라
        # 그 뒤가 전부 무너진다(2026-08-20에 겪었다).
        await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="domcontentloaded")
        await pg.wait_for_timeout(2500)
    else:
        rep.check(False, "묻기: 눌러서 묻는 버튼")
    # 촬영 화면 진입은 **폰에서만** 본다. 카메라를 켜면 MediaPipe와 인식 모델을
    # 함께 내려받아 소프트웨어 렌더링으로 몇 분이 걸린다 — 기기마다 되풀이할 이유가
    # 없다(화면 구성은 세 기기가 같은 컴포넌트다).
    if name == "폰":
        await pg.get_by_role("button", name="수어로 묻기").click()
        await pg.wait_for_timeout(2500)
        rep.check(await visible(pg.get_by_role("button", name="💬 답 받기")),
                  "묻기: 촬영 화면 진입")
        # **화면이 실제로 자리를 차지하는가.** 버튼이 있는지만 보면 부모에서 높이를
        # 못 받아 카메라 칸이 0px로 찌부러진 것을 놓친다 — 실측에서 버튼만 화면
        # 맨 위에 뜨고 아래가 통째로 까맣게 비어 있었는데 검사는 전부 통과했다.
        box = await pg.evaluate(
            "() => { const v=document.querySelector('video');"
            " const n=document.querySelector('nav');"
            " if(!v||!n) return null;"
            " const a=v.getBoundingClientRect(), b=n.getBoundingClientRect();"
            " return {vh:a.height, navTop:b.top, ih:innerHeight}; }"
        )
        rep.check(bool(box) and box["vh"] > 200,
                  "묻기: 카메라 칸이 화면을 채움",
                  f"{box['vh']:.0f}px" if box else "video/nav 없음")
        rep.check(bool(box) and box["navTop"] > box["ih"] * 0.5,
                  "묻기: 버튼이 화면 아래쪽에 있음",
                  f"nav {box['navTop']:.0f}px / 화면 {box['ih']}px" if box else "")
        # **인식 부품이 동봉돼 있는가.** MediaPipe를 CDN에서 받아 오면 회선이 끊긴
        # 곳에서 카메라가 아예 켜지지 않는다 — 정작 그때가 대피소를 물어야 하는
        # 때다. 파일이 실제로 서빙되는지와, 동봉본으로 떴는지(폴백 경고 없음)를 본다.
        mp = await pg.evaluate(
            "async () => { const out = {};"
            " for (const f of ['vision_wasm_internal.wasm','holistic_landmarker.task']) {"
            "   const r = await fetch('./mediapipe/' + f, {method:'HEAD'});"
            "   out[f] = r.ok; }"
            " return out; }"
        )
        rep.check(all(mp.values()), "묻기: MediaPipe 인식 부품 동봉", str(mp))
        rep.check(not any("동봉 모델 로드 실패" in w for w in warns),
                  "묻기: 동봉본으로 인식기 기동(CDN 폴백 아님)",
                  next((w[:60] for w in warns if "동봉" in w), ""))
        # **카메라를 꼭 꺼야 한다.** 켜 둔 채로 두면 MediaPipe가 매 프레임 추론을
        # 계속하고, 소프트웨어 렌더링 환경에서는 CPU를 다 먹어 뒤 검사가 몇 배로
        # 느려진다(실측: 검사 한 판이 13분 → 40분 넘게). 화면을 떠나면 멈춘다.
        await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="domcontentloaded")
        await pg.wait_for_timeout(800)

    # ── 사전: 첫 화면이 비어 있지 않은가 · 눌러서 **사전 안에서** 보이는가
    #
    # 사전은 낱말을 잇따라 넘겨 보는 화면이다. 하나 누를 때마다 다른 탭으로 튀면
    # 검색 결과로 돌아오는 데만 두 번을 더 눌러야 한다(실측 사진에서 그랬다).
    await pg.get_by_role("button", name="📖 사전").click()
    await pg.wait_for_timeout(700)
    rep.check(await visible(pg.get_by_text("낱말을 누르면 수어로 보여드려요")),
              "사전: 첫 화면에 시작 낱말")
    # 시작 낱말 '병원'은 DICT_STARTERS에 **반드시 있다.** 없으면 화면이 바뀐 것이니
    # 조용히 건너뛰지 말고 실패로 본다.
    starter = pg.get_by_role("button", name="병원", exact=True)
    rep.check(await visible(starter), "사전: 시작 낱말 '병원'이 있음")
    if await starter.count():
        await starter.first.click()
        played = False
        for _ in range(10):
            await pg.wait_for_timeout(600)
            st = await stage_state(pg)
            if st["frames"] > 5:
                played = True
                break
        rep.check(played, "사전: 낱말을 누르면 수어로 재생")
        # 탭이 그대로여야 한다 — 사전 안에서 보여주는 것이 요점이다
        rep.check(await visible(pg.get_by_placeholder("🔍 단어 찾기")),
                  "사전: 재생해도 사전 화면에 머무름")

    # ── 손가락으로 누를 수 있는 크기인가(모바일 접근성 최소 44px)
    small = await pg.evaluate(
        "() => [...document.querySelectorAll('button')]"
        ".filter(b=>b.offsetParent && b.getBoundingClientRect().height < 36)"
        ".map(b=>b.textContent.trim().slice(0,10))"
    )
    rep.check(len(small) == 0, "버튼 높이 36px 이상", f"작은 버튼 {small[:4]}" if small else "")

    # 🆘 긴급 화면 — **지금까지 아무도 재지 않던 자리다.**
    # 농인이 말이 안 통하는 응급 상황에서 상대에게 보여 주는 화면이다.
    # 조용히 비어 있으면 정작 그때 아무것도 못 보여 준다.
    #
    # **맨 뒤에서 독립적으로 한다.** 처음에는 대화 흐름 중간에 끼워 넣었는데,
    # 닫고 나온 자리가 뒤 검사가 기대하는 화면과 달라 그 뒤가 전부 무너졌다
    # (2026-08-20). 검사가 검사를 깨뜨리면 무엇이 진짜 고장인지 알 수 없다.
    await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="domcontentloaded")
    await pg.wait_for_timeout(2500)
    talk = pg.get_by_role("button", name=re.compile("대화"))
    if await visible(talk, 10000):
        await talk.first.click()
        await pg.wait_for_timeout(1200)
        # **장소를 고르기 전** 화면에 있다(`if (!place)`). 병원을 먼저 누르면
        # 그 화면을 지나쳐 버려 버튼을 못 찾는다(2026-08-20에 그랬다).
        sos_btn = pg.get_by_role("button", name=re.compile("긴급 도움"))
        if await visible(sos_btn, 10000):
            rep.check(True, "긴급: 입구가 있다")
            await sos_btn.first.click()
            rep.check(await visible(pg.get_by_text(re.compile("청각장애인"))),
                      "긴급: 첫 문구 — 청각장애인임을 알림")
            await pg.get_by_text("화면을 탭하면 다음 문구").first.click()
            await pg.wait_for_timeout(400)
            rep.check(await visible(pg.get_by_text(re.compile("119"))),
                      "긴급: 탭하면 119 신고 문구")
            body = await pg.inner_text("body")
            rep.check("위치" in body or "좌표" in body or "소리로" in body,
                      "긴급: 위치·소리 안내가 있음")
            # **"닫기"로 잡히는 버튼이 둘이다** — 머리줄의 오프라인 안내에도 있다.
            # `.first`를 누르면 엉뚱한 것을 닫고 긴급 화면은 그대로 남는다.
            await pg.get_by_role("button", name=re.compile("✕ 닫기")).last.click()
            await pg.wait_for_timeout(1000)
            gone = not await pg.get_by_text(re.compile("화면을 탭하면 다음 문구")).count()
            rep.check(gone, "긴급: 닫으면 화면이 사라짐")
            rep.check(await visible(sos_btn, 8000), "긴급: 닫으면 대화로 돌아옴")
        else:
            rep.check(False, "긴급: 입구가 있다")

    real_errors = [e for e in errors if "vibrate" not in e]
    rep.check(not real_errors, "콘솔 오류 없음", str(real_errors[:2]))

    if keep or rep.fails:
        shot = ROOT / f"e2e_{name}.png"
        await pg.screenshot(path=str(shot))
        rep.lines.append(f"    · 스크린샷 {shot}")
    await ctx.close()


async def run_kiosk(browser, rep: Report, port: int) -> None:
    """키오스크 모드 — 로비에 세워 두는 기기는 대화 화면으로 시작해야 한다."""
    ctx = await browser.new_context(viewport={"width": 1080, "height": 1920},
                                    service_workers="block")
    pg = await ctx.new_page()
    rep.note("  [키오스크 모드 ?kiosk=1]")
    await pg.goto(f"http://127.0.0.1:{port}/#/app?kiosk=1", wait_until="domcontentloaded")
    await pg.wait_for_timeout(2000)
    await pg.wait_for_timeout(1500)
    rep.check(await visible(pg.get_by_text("어디에 계신가요?")), "키오스크: 대화 화면으로 시작")
    rep.check(await pg.get_by_role("link", name="✕").count() == 0, "키오스크: 닫기 버튼 숨김")

    # ── **앞사람 대화가 남지 않는가.** 로비·창구에 세워 두는 기기는 여러 사람이
    # 돌려 쓴다. "머리가 아파요"라고 답한 화면이 다음 사람에게 그대로 보이면
    # 그건 고장이 아니라 **개인정보 유출**이다. 5분 유휴 초기화가 실제로 도는지
    # 문서로만 적어 두고 아무도 재지 않았다.
    #
    # 5분을 기다리지 않는다 — 브라우저 시계를 앞으로 돌린다. 앱 코드에 검사용
    # 뒷문을 내지 않으려면 이 방법뿐이다.
    await pg.clock.install()
    await pg.goto(f"http://127.0.0.1:{port}/#/app?kiosk=1", wait_until="domcontentloaded")
    await pg.wait_for_timeout(1500)
    # 장소 목록의 '병원'도 반드시 있다(places.ts 고정 목록).
    hospital = pg.get_by_role("button", name="🏥 병원")
    rep.check(await visible(hospital), "키오스크: 장소 목록에 병원이 있음")
    if await hospital.count():
        await hospital.first.click()
        await pg.wait_for_timeout(800)
        # 장소를 고르면 **직원에게 보여주는 안내 화면**이 먼저 뜬다. 한 번 눌러
        # 지나야 대화 화면이다(처음에 이걸 빼먹어 "대화가 시작됐다"고 착각했다 —
        # 실제로는 기록이 하나도 없어 초기화 타이머가 아예 걸리지 않았다).
        start = pg.get_by_text("화면을 누르면 시작합니다")
        if await start.count():
            await start.first.click()
            await pg.wait_for_timeout(800)
        answer = pg.get_by_role("button", name="🤟 내 답 카드")
        if await answer.count():
            await answer.first.click()
            await pg.wait_for_timeout(400)
        card = pg.get_by_role("button", name="머리", exact=True)
        if await card.count():
            await card.first.click()
            await pg.wait_for_timeout(800)
        # **기록이 실제로 생겼는지**로 확인한다. 장소 화면을 벗어난 것만으로는
        # 부족하다 — 기록이 없으면 초기화 타이머가 걸리지 않아 검사가 헛돈다.
        logged = await pg.evaluate(
            "() => document.body.innerText.includes('머리')"
        )
        rep.check(logged, "키오스크: 대화 기록이 생김(초기화 시험 준비)")

        await pg.clock.fast_forward("05:30")
        await pg.wait_for_timeout(1200)
        back = await pg.get_by_text("어디에 계신가요?").count() > 0
        rep.check(back, "키오스크: 5분 뒤 앞사람 대화가 지워짐")

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
    await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="domcontentloaded")

    # 필수 세트를 조용히 받아 둘 때까지 기다린다(첫 방문 뒤 자동으로 받는다).
    # **손 깊이를 실으면서 필수 세트가 14.7MB → 18.7MB로 커졌다.** 60초로는
    # 부하가 걸린 판에서 모자란다 — 못 받은 것과 늦은 것을 구분해야 한다.
    level = None
    for _ in range(150):
        await pg.wait_for_timeout(1000)
        level = await pg.evaluate("localStorage.getItem('sb-offline')")
        if level:
            break
    rep.check(level is not None, "오프라인: 필수 세트 자동 준비", str(level))

    await ctx.set_offline(True)
    await pg.reload(wait_until="domcontentloaded")
    await pg.wait_for_timeout(2500)
    rep.check(await visible(pg.get_by_text("SignBridge")), "오프라인: 앱이 열림")

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
    # 인터넷이 없으면 마이크는 원리상 안 된다 — 그 사실과 대안을 화면이 말해야 한다.
    rep.check(await visible(pg.get_by_text("인터넷이 없어요")), "오프라인: 마이크 대안 안내")

    # ── **묻기도 오프라인에서 살아 있어야 한다.** "재난 때가 곧 오프라인"이라
    # 적어 두고 정작 창구 화면만 재고 있었다. 대피소를 물어야 하는 순간이 바로
    # 회선이 끊긴 순간이다. 지도 타일을 안 쓰는 것이 요점이므로, 주변 장소 목록이
    # 캐시에서 열리는지 본다(카메라·인식은 이 환경에서 못 돌린다).
    # 대화 화면에 들어가 있으면 탭이 접혀 있다 — **다시 열고** 시작한다.
    # 처음에 이걸 안 해서 `count()`가 0이 나왔고, 검사가 통째로 조용히 빠진 채
    # "전부 통과"가 찍혔다(있어야 할 것을 count 한 번으로 판단하면 늘 이렇게 된다).
    await pg.reload(wait_until="domcontentloaded")
    await pg.wait_for_timeout(1500)
    ask = pg.get_by_role("button", name="📹 묻기").first
    try:
        await ask.wait_for(state="visible", timeout=10000)
        found = True
    except Exception:
        found = False
    rep.check(found, "오프라인: 묻기 탭이 열림")
    if found:
        await ask.click()
        await pg.wait_for_timeout(1200)
        places = await pg.evaluate(
            "async () => { try { const r = await fetch('./data/nearby.json');"
            " if(!r.ok) return 0; const d = await r.json();"
            " return d.places.length; } catch { return 0; } }"
        )
        rep.check(places > 0, "오프라인: 주변 장소 목록이 캐시에서 열림", f"{places}곳")
        rep.check(await visible(pg.get_by_text("참고용")),
                  "오프라인: 출처가 참고용임을 그대로 표시")

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
            # 가짜 카메라 — '묻기'(수어로 묻기) 화면은 getUserMedia가 성공해야
            # 촬영 화면까지 들어간다. 진짜 인식은 여기서 재지 않는다(내용 없는
            # 영상이라 낱말이 나오지 않는다). 인식→의도→답 계산은 별도로
            # scripts/check_intent.mjs · scripts/check_nearby.mjs 에서 잰다.
            browser = await p.chromium.launch(
                executable_path=exe,
                args=["--no-sandbox",
                      "--use-fake-ui-for-media-stream",
                      "--use-fake-device-for-media-stream"])
            for name, w, h, mobile in DEVICES:
                # **한 기기에서 예외가 나도 나머지를 계속 돈다.** 예전에는 클릭
                # 하나가 흔들려 실패하자 그 뒤 검사 200여 건이 통째로 사라졌다 —
                # 실패보다 나쁜 것은 재지 못한 채 끝나는 것이다.
                try:
                    await run_device(browser, name, w, h, mobile, keep, rep, port_of(httpd))
                except Exception as error:
                    rep.check(False, f"{name}: 검사 도중 예외",
                              f"{type(error).__name__}: {str(error)[:120]}")
            for label, fn in (("키오스크", run_kiosk), ("오프라인", run_offline)):
                try:
                    if fn is run_kiosk:
                        await fn(browser, rep, port_of(httpd))
                    else:
                        await fn(browser, keep, rep, port_of(httpd))
                except Exception as error:
                    rep.check(False, f"{label}: 검사 도중 예외",
                              f"{type(error).__name__}: {str(error)[:120]}")
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
