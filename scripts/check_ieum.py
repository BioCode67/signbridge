#!/usr/bin/env python3
"""이음 화면(`#/ieum`)이 예시 문서마다 **실제로 수어를 재생하는지** 수치로 본다.

    npm run build && python3 scripts/check_ieum.py          # 빠른 검사(문서마다 첫 문장 끝까지)
    python3 scripts/check_ieum.py --full                    # 문서 6건을 끝 문장까지 재생

**왜 따로 재나.** 이 화면은 해커톤 심사위원이 루트 주소로 들어와 처음 누르는 곳이다.
아바타가 서 있기만 해도 화면은 멀쩡해 보인다 — 합성 실패(한 장짜리)와 재생 중을
눈으로는 구분할 수 없다. 그래서 계측점(`data-ieum-*`, `data-sign-*`)으로 잰다.

`dist/`를 GitHub Pages와 같은 하위 경로(`/signbridge/`)로 띄운다 — 루트로만 띄우면
절대 경로 실수가 가려진다. dev 서버로는 재지 않는다(CLAUDE.md).

**`--full`은 오래 걸린다.** GPU 없는 환경(소프트웨어 렌더링)에서는 아바타가 한 틱에
3초쯤 걸려 문서 하나에 몇 분, 여섯 건에 30분 안팎이다(실측). 재생기는 틱마다 최대
6프레임만 건너뛰기 때문이다. 그래서 기본은 **첫 문장이 끝나 둘째 문장으로 넘어가는
것까지만** 보고, 합성 수치(문장·글로스·프레임·낱말 카드)는 두 방식 모두 전부 잰다.

재는 것 (예시 문서 6건 각각)
  · 문장 수 = 수어로 재생된 문장 수 = 끝까지 재생한 문장 수
  · 이어 붙인 수어 낱말(글로스) 수 · 프레임 수 · 수어가 없어 낱말 카드로 간 낱말
  · 재생 중에 무대가 실제로 도는가(data-sign-playing=1 · 프레임>1 · 손 깊이)
  · 낱말 카드가 무대에도 뜨는가(정보가 조용히 사라지지 않는가)
그리고
  · 루트 소개 페이지에 진입 배너가 있고, 누르면 이 화면으로 오는가
  · 375px 폭에서 가로 넘침이 없는가(루트 · 이음)
  · 콘솔 오류·페이지 오류·404가 없는가
"""
from __future__ import annotations

import functools
import http.server
import json
import socketserver
import sys
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
BASE = "/signbridge/"
SAMPLES = ["receipt", "medication", "water-bill", "fine-notice", "welfare", "typhoon"]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):  # noqa: D401, ANN002
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):  # noqa: ANN001
        pass  # 브라우저가 창을 닫으며 끊은 연결 — 검사 결과와 무관한 소음이다


def attrs(pg, sel: str) -> dict:
    return pg.evaluate(
        """(sel) => { const e = document.querySelector(sel); if (!e) return {}
            const o = {}; for (const a of e.attributes) if (a.name.startsWith('data-')) o[a.name] = a.value
            return o }""",
        sel,
    )


def main() -> int:
    full = "--full" in sys.argv
    if not (DIST / "index.html").is_file():
        print("dist가 없습니다 — 먼저 npm run build")
        return 1
    # dist를 /signbridge/ 아래에 둔 것처럼 보이게 한다(심볼릭 링크).
    web = Path(tempfile.mkdtemp(prefix="ieum-web-"))
    (web / "signbridge").symlink_to(DIST, target_is_directory=True)
    httpd = Server(("127.0.0.1", 0), functools.partial(Quiet, directory=str(web)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{httpd.server_address[1]}{BASE}"

    fails: list[str] = []
    rows: list[dict] = []

    def ok(name: str, cond: bool, note: str = "") -> None:
        print(f"  {'✓' if cond else '✗'} {name}" + (f" — {note}" if note else ""))
        if not cond:
            fails.append(name)

    try:
        with sync_playwright() as p:
            exe = next((c for c in ("/usr/bin/google-chrome", "/usr/bin/chromium-browser",
                                    "/usr/bin/chromium") if Path(c).exists()), None)
            b = p.chromium.launch(executable_path=exe, args=["--no-sandbox"])

            def new_page(w: int, h: int):
                ctx = b.new_context(viewport={"width": w, "height": h}, service_workers="block")
                pg = ctx.new_page()
                errs: list[str] = []
                pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:160]))
                # onnxruntime의 그래프 정리 경고([W:onnxruntime …])는 오류가 아니다 —
                # 소개 페이지의 인식 모델 자가 점검이 콘솔 error 채널로 내보낸다(이전부터 있던 것).
                pg.on("console", lambda m: errs.append("console: " + m.text[:160])
                      if m.type == "error" and "[W:onnxruntime" not in m.text else None)
                pg.on("response", lambda r: errs.append(f"{r.status}: {r.url[-80:]}")
                      if r.status >= 400 else None)
                return ctx, pg, errs

            # ── 1) 루트 배너 → 이음 ──────────────────────────────────────
            print("[루트]")
            ctx, pg, errs = new_page(1440, 900)
            pg.goto(url, wait_until="domcontentloaded")
            pg.wait_for_selector("[data-ieum-banner]", timeout=90000)
            box = pg.eval_on_selector("[data-ieum-banner]", "e => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.width)] }")
            ok("배너가 첫 화면 안에 있음", 0 <= box[0] and box[1] <= 900, f"top {box[0]}px · bottom {box[1]}px · 폭 {box[2]}px")
            pg.wait_for_timeout(1200)  # 등장 애니메이션
            # 진짜 클릭으로 누른다(다른 요소에 가려졌는지까지 본다). 히어로의 3D 지구본이
            # 주 스레드를 잡고 있어 부하가 걸린 판에서는 30초를 넘기기도 한다(실측).
            pg.click("[data-ieum-banner]", timeout=120000)
            pg.wait_for_selector("[data-ieum-doc]", timeout=90000)
            ok("배너를 누르면 #/ieum으로 감", pg.evaluate("location.hash") == "#/ieum")
            ok("루트: 오류 없음", not errs, "; ".join(errs[:3]))
            ctx.close()

            # ── 2) 예시 문서 6건 ─────────────────────────────────────────
            print("[이음 — 문서별 재생]")
            print("   (전체 재생)" if full else "   (빠른 검사 — 첫 문장이 끝나 다음 문장으로 넘어가는 것까지. 끝까지는 --full)")
            # 세 칸이 유지되는 가장 작은 폭 — 캔버스가 작을수록 소프트웨어 렌더링이 빠르다.
            ctx, pg, errs = new_page(1100, 800)
            pg.goto(url + "#/ieum", wait_until="domcontentloaded")
            pg.wait_for_selector("[data-ieum-doc]", timeout=90000)
            for sid in SAMPLES:
                if attrs(pg, "[data-ieum-doc]").get("data-ieum-doc") != sid:
                    # 렌더링에 주 스레드가 묶여 있으면 Playwright의 "요소가 멈췄는가" 판정이
                    # 30초를 넘긴다(실측). 판정을 건너뛰고 DOM 클릭을 직접 보낸다.
                    pg.evaluate("(id) => document.querySelector(`[data-ieum-pick='${id}']`).click()", sid)
                else:
                    # 첫 문서는 자동 재생이 이미 시작됐을 수 있다 — 처음부터 다시 잰다.
                    pg.wait_for_function("document.querySelector('[data-ieum-doc]').dataset.ieumState !== 'loading'", timeout=60000)
                    pg.evaluate("document.querySelector('[data-ieum-replay]').click()")
                pg.wait_for_function(
                    "(id) => { const d = document.querySelector('[data-ieum-doc]').dataset; return d.ieumDoc === id && d.ieumState === 'playing' }",
                    arg=sid, timeout=60000)
                # 재생 중 무대를 표본으로 본다 — 끝날 때까지.
                seen_playing = 0
                max_frames = 0
                handz = 0
                stage_cards = 0
                stage_gloss = 0
                t_end = time.time() + (1500 if full else 420)
                while time.time() < t_end:
                    st = attrs(pg, "[data-sign-frames]")
                    pa = attrs(pg, "[data-ieum-doc]")
                    if st.get("data-sign-playing") == "1":
                        seen_playing += 1
                    max_frames = max(max_frames, int(st.get("data-sign-frames", 0)))
                    handz = max(handz, int(st.get("data-sign-handz", 0)))
                    stage_cards = max(stage_cards, int(st.get("data-sign-cards", 0)))
                    stage_gloss = max(stage_gloss, int(st.get("data-sign-glosses", 0)))
                    if pa.get("data-ieum-state") in ("done", "error"):
                        break
                    if not full and int(pa.get("data-ieum-played", 0)) >= 1 and seen_playing > 0:
                        break
                    pg.wait_for_timeout(1000)
                pa = attrs(pg, "[data-ieum-doc]")
                img_ok = pg.evaluate("() => { const i = document.querySelector('section img'); return !!i && i.complete && i.naturalWidth > 0 }")
                missing_words = pg.evaluate("() => [...new Set([...document.querySelectorAll('section ol span[title]')].map(e => e.textContent))]")
                row = {
                    "문서": sid,
                    "문장": int(pa.get("data-ieum-sentences", 0)),
                    "수어로 나간 문장": int(pa.get("data-ieum-signed", 0)),
                    "끝까지 재생": int(pa.get("data-ieum-played", 0)),
                    "글로스": int(pa.get("data-ieum-glosses", 0)),
                    "프레임": int(pa.get("data-ieum-frames", 0)),
                    "낱말카드": missing_words,
                    "손깊이": handz,
                    "번역기": attrs(pg, "[data-sign-frames]").get("data-sign-backend"),
                }
                rows.append(row)
                n = row["문장"]
                if full:
                    ok(f"{sid}: 상태 done", pa.get("data-ieum-state") == "done", pa.get("data-ieum-state", ""))
                ok(f"{sid}: 문장 {n}개가 모두 수어로 나감",
                   n > 0 and row["수어로 나간 문장"] == n, f"수어 {row['수어로 나간 문장']}")
                ok(f"{sid}: " + ("끝 문장까지 재생" if full else "첫 문장을 끝까지 재생"),
                   row["끝까지 재생"] == n if full else row["끝까지 재생"] >= 1,
                   f"끝까지 재생한 문장 {row['끝까지 재생']}/{n}")
                ok(f"{sid}: 무대가 실제로 돎", seen_playing > 0 and max_frames > 1 and stage_gloss > 0,
                   f"재생 표본 {seen_playing}회 · 한 문장 최대 {max_frames}프레임")
                ok(f"{sid}: 손 깊이 실림", handz == 1)
                # 빠른 검사는 첫 문장에서 멈추므로, 카드가 뒤 문장에 있으면 무대에서 볼 수 없다.
                if full:
                    ok(f"{sid}: 낱말 카드가 무대에도 뜸", (stage_cards > 0) == (len(missing_words) > 0),
                       f"목록 {len(missing_words)} · 무대 최대 {stage_cards}")
                ok(f"{sid}: 문서 그림 뜸", img_ok)
                print(f"      글로스 {row['글로스']} · 프레임 {row['프레임']} · 낱말카드 {missing_words} · 번역기 {row['번역기']}")
            ok("이음: 오류 없음", not errs, "; ".join(errs[:3]))
            ctx.close()

            # ── 3) 375px 폭 ─────────────────────────────────────────────
            print("[375px]")
            for name, path in (("루트", ""), ("이음", "#/ieum")):
                ctx, pg, errs = new_page(375, 812)
                pg.goto(url + path, wait_until="domcontentloaded")
                pg.wait_for_selector("[data-ieum-banner]" if not path else "[data-ieum-doc]", timeout=90000)
                if path:
                    pg.wait_for_function("document.querySelector('[data-ieum-doc]').dataset.ieumState !== 'loading'", timeout=60000)
                pg.wait_for_timeout(2500)
                m = pg.evaluate("() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth })")
                # 넘치는 요소가 있는지도 직접 센다(overflow-x-hidden이 가린 것까지).
                over = pg.evaluate(
                    """() => [...document.querySelectorAll('main *, header *')].filter(e => {
                        const r = e.getBoundingClientRect()
                        return r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed'
                    }).length""") if path else 0
                ok(f"{name}: 가로 넘침 없음", m["sw"] <= m["iw"] + 1 and m["bw"] <= m["iw"] + 1 and over == 0,
                   f"scrollWidth {m['sw']} · 창 {m['iw']} · 넘치는 요소 {over}")
                if not path:
                    box = pg.eval_on_selector("[data-ieum-banner]", "e => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)] }")
                    box = box + [pg.eval_on_selector("[data-ieum-banner]", "e => Math.round(e.getBoundingClientRect().right)")]
                    ok("루트(375): 배너가 첫 화면 안", 0 <= box[0] and box[1] <= 812 and box[2] <= 375,
                       f"top {box[0]} · bottom {box[1]} · right {box[2]}")
                ok(f"{name}(375): 오류 없음", not errs, "; ".join(errs[:3]))
                ctx.close()
            b.close()
    finally:
        httpd.shutdown()

    print()
    print(json.dumps(rows, ensure_ascii=False, indent=1))
    if fails:
        print(f"[이음] ✗ 실패 {len(fails)}건: {fails}")
        return 1
    print("[이음] ✓ 전부 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
