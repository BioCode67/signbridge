#!/usr/bin/env python3
"""카메라 화면 검사 — **모델이 보는 프레임이 사람에게도 다 보이는가.**

    npm run build && python3 scripts/check_camera.py

**왜 따로 재는가.** 이 앱의 카메라 실패는 화면상 완벽하게 정상으로 보인다.
2026-08-28까지 두 촬영 화면은 4:3 영상을 세로로 긴 칸에 `object-cover`로 넣고 있었다 —
상자를 채우려고 **좌우 61.5%를 잘라낸다.** 사람에게는 가로의 38.5%만 보이는데
모델은 640×480 전체를 봤다. 그래서 화면에 적힌 "양손이 화면 안에 들어오게 해 주세요"는
**따를 수 없는 지시**였다(화면 안 ≠ 프레임 안). 사용자는 손을 프레임 안에 두고도
화면 밖으로 보여 자꾸 뒤로 물러났다. 신고는 "너무 가깝게 잡힌다"로 들어왔다.

같은 뿌리에서 오버레이도 어긋나 있었다. 캔버스 비트맵은 영상 원본 크기인데 `object-fit`이
없어 기본값 fill(늘이기)이었고, 옆의 영상은 cover(잘라내기)라 배율이 서로 달랐다.
정중앙에서만 맞아서 얼굴 근처만 보면 정상으로 보인다.

**이걸 아무도 안 재고 있었다.** e2e_app.py는 카메라 칸이 "높이 200px을 넘는가"만 보고
(칸이 0px로 찌부러진 고장을 잡으려고 넣은 것이다), 그나마 폰에서만 연다. 그리고 세
복제본 중 소개 페이지 데모만 컨테이너가 `aspect-[4/3]`라 유일하게 안 잘려서, 개발·시연
때 보는 화면이 유일하게 멀쩡한 화면이었다.

**e2e_app.py에 붙이지 않고 따로 둔 이유** — 저기는 폰 한 기기에서만 카메라를 열고
(카메라를 켜면 MediaPipe 추론이 CPU를 다 먹어 뒤 검사가 몇 배로 느려진다), 앞의
받기·행동요령 단계를 다 지나야 카메라에 닿는다. 잘림은 기기마다 다르므로 네 크기를
전부 봐야 하고, 그러려면 짧은 길로 바로 들어가는 검사가 따로 있어야 한다.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_app import DEVICES, Report, port_of, serve, visible  # noqa: E402

# 촬영을 건드렸는지 감시한다. 화면 거리 조절은 표시 계층에만 두기로 했고
# (DECISIONS.md 2026-08-28), 그 약속을 지키는지 재는 검사가 이것 하나뿐이다.
# `python -m ml.tools.feature_parity`는 난수 랜드마크를 파이썬·TS 양쪽에 **같은 숫자로**
# 넣고 산술만 대조하므로, 촬영 화면비를 4:3에서 16:9로 넓혀 모든 y 특징이 1.333배
# 밀려도 여전히 "오차 0"을 찍는다. 화면은 멀쩡하고 검사는 다 통과하면서 웹캠 정확도만
# 무너지는 길이 정확히 이쪽이다.
CAM_SPY = """
window.__cam = { calls: [], applied: 0 };
(() => {
  const md = navigator.mediaDevices;
  if (!md) return;
  const real = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    window.__cam.calls.push(JSON.parse(JSON.stringify(c && c.video ? c.video : c)));
    const s = await real(c);
    for (const t of s.getVideoTracks()) {
      const ac = t.applyConstraints.bind(t);
      t.applyConstraints = (x) => { window.__cam.applied++; return ac(x); };
    }
    return s;
  };
})();
"""

# 카메라 상자를 재는 한 판. 요소 상자(getBoundingClientRect)는 transform이 반영된
# 값이라 배율이 이미 들어 있다 — 배율을 따로 곱하지 않는다.
#
# **상자를 계측 속성으로 찾지 않는다.** `[data-sign-camfit]`으로 찾으면, 속성이 없는
# 코드에서는 "못 찾음"으로 떨어져 잘림을 **재지 못한 채** 실패한다. 그러면 이 검사가
# 정말 잘림을 잡는지 확인할 길이 없다(실제로 처음에 그렇게 짰다가 알았다).
# 영상에서 위로 올라가며 `overflow: hidden`인 조상을 찾는다 — 잘라내는 주체가 그것이다.
PROBE = """
() => { const v=document.querySelector('video');
 if(!v||!v.videoWidth) return null;
 let b=v.parentElement;
 while(b && getComputedStyle(b).overflow !== 'hidden') b=b.parentElement;
 if(!b) return null;
 const c=b.querySelector('canvas');
 if(!c) return null;
 const br=b.getBoundingClientRect(), vr=v.getBoundingClientRect(),
       cr=c.getBoundingClientRect();
 const fv=getComputedStyle(v).objectFit, fc=getComputedStyle(c).objectFit;
 const iw=v.videoWidth, ih=v.videoHeight;
 const k = fv==='contain' ? Math.min(vr.width/iw, vr.height/ih)
                          : Math.max(vr.width/iw, vr.height/ih);
 return {fv, fc, iw, ih, zoom:b.dataset.signCamzoom ?? '(계측 없음)', box:[br.width, br.height],
   visible: Math.min(1, br.width/(iw*k)) * Math.min(1, br.height/(ih*k)),
   dx: Math.abs(vr.x-cr.x)+Math.abs(vr.y-cr.y)
      +Math.abs(vr.width-cr.width)+Math.abs(vr.height-cr.height)}; }
"""

# 알약 안내가 **정말 보이는가.** 확대가 인식 범위를 넓히지 않는다는 경고라, 다른 안내에
# 가리면 없는 것과 같다. 눈으로는 못 잡는다 — 3초짜리라 느린 기기에서는 스크린샷을
# 찍기 전에 사라지고(실측 11.9초), 그러면 "가려졌다"로 잘못 읽는다.
# 그래서 **클릭과 판정을 페이지 안에서 한 번에** 한다. 왕복이 없으면 시간도 안 간다.
# pointer-events-none이라 hit test에서 빠지므로 재는 동안만 켠다.
HINT_PROBE = """() => {
  const btn=[...document.querySelectorAll('button')].find(b=>b.title==='화면 크기');
  if(!btn) return 'BUTTON MISSING';
  btn.click();
  return new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const p=[...document.querySelectorAll('p')].find(e=>e.textContent.includes('화면만 커져요'));
    if(!p) return res('HINT MISSING');
    const prev=p.style.pointerEvents; p.style.pointerEvents='auto';
    const r=p.getBoundingClientRect();
    const pts=[[r.x+r.width/2,r.y+r.height/2],[r.x+8,r.y+8],[r.right-8,r.bottom-8]];
    const on=pts.map(([x,y])=>{const t=document.elementFromPoint(x,y); return !!t&&(t===p||p.contains(t))});
    p.style.pointerEvents=prev;
    res({onTop:on.every(Boolean), where:on, size:[r.width|0, r.height|0]});
  })));
}"""


async def run_device(browser, name: str, w: int, h: int, mobile: bool, rep: Report, port: int) -> None:
    ctx = await browser.new_context(
        viewport={"width": w, "height": h}, is_mobile=mobile, has_touch=mobile,
        service_workers="block",
        geolocation={"latitude": 37.5665, "longitude": 126.9780},
        permissions=["geolocation"],
    )
    await ctx.add_init_script(CAM_SPY)
    pg = await ctx.new_page()
    rep.note(f"  [{name} {w}×{h}]")
    try:
        # **받기·행동요령을 지나지 않고 곧장 묻기로.** 카메라만 재는 검사라
        # 앞 단계가 흔들려도 카메라 결과가 사라지지 않아야 한다.
        await pg.goto(f"http://127.0.0.1:{port}/#/app", wait_until="domcontentloaded")
        await pg.get_by_role("button", name="📹 묻기").first.click()
        if not await visible(pg.get_by_role("button", name="수어로 묻기")):
            rep.check(False, f"{name}: 묻기 시작 화면")
            return
        await pg.get_by_role("button", name="수어로 묻기").first.click()
        # 카메라가 뜨고 첫 프레임이 올 때까지. MediaPipe 내려받기까지 기다리지 않는다 —
        # 재는 것은 화면 배치이지 인식이 아니다.
        ok = False
        for _ in range(30):
            await pg.wait_for_timeout(1000)
            if await pg.evaluate(PROBE):
                ok = True
                break
        if not ok:
            rep.check(False, f"{name}: 카메라 화면 진입", "video가 프레임을 못 받음")
            return

        cam = await pg.evaluate(PROBE)
        # 프레임 전체가 보이는가. 예전 값은 폰 38.5%였다.
        rep.check(cam["visible"] >= 0.99, f"{name}: 잡은 프레임이 다 보임",
                  f"{cam['visible'] * 100:.1f}% ({cam['iw']}×{cam['ih']} {cam['fv']} "
                  f"칸 {cam['box'][0]:.0f}×{cam['box'][1]:.0f})")
        # 뼈대가 영상 위에 정확히 얹히는가.
        rep.check(cam["fv"] == cam["fc"] and cam["dx"] < 1.0,
                  f"{name}: 랜드마크 뼈대가 영상과 겹침",
                  f"video {cam['fv']} / canvas {cam['fc']} / 어긋남 {cam['dx']:.1f}px")

        # 거리 조절이 실제로 값을 바꾸는가. 있는지만 보면 아무 일도 안 하는 버튼이 통과한다.
        btn = pg.get_by_role("button", name="화면 크기").first
        if await visible(btn):
            steps = []
            for _ in range(3):
                await btn.click()
                await pg.wait_for_timeout(200)
                steps.append(await pg.evaluate(
                    "() => document.querySelector('[data-sign-camfit]')?.dataset.signCamzoom"))
            rep.check(steps == ["1.3", "1.6", "1"], f"{name}: 거리 조절이 값을 바꿈",
                      " → ".join(map(str, steps)))
            after = await pg.evaluate(PROBE)
            rep.check(bool(after) and after["visible"] >= 0.99,
                      f"{name}: 한 바퀴 돌면 전체로 돌아옴",
                      f"{after['visible'] * 100:.1f}%" if after else "")
            # 안내 알약이 다른 안내에 가리지 않는가.
            hint = await pg.evaluate(HINT_PROBE)
            rep.check(isinstance(hint, dict) and hint["onTop"],
                      f"{name}: 확대 안내가 가려지지 않음", str(hint))
        else:
            rep.check(False, f"{name}: 거리 조절 버튼")

        # **거리 조절이 촬영을 건드리지 않았는가.** 여기까지 배율을 다 돌려 봤다.
        # 그 사이 getUserMedia가 640×480 말고 다른 것으로 불렸거나 applyConstraints가
        # 불렸다면 모델이 보는 프레임이 바뀐 것이고, 155차원 특징이 조용히 어긋난다.
        spy = await pg.evaluate("() => window.__cam")
        want = [{"width": 640, "height": 480, "facingMode": "user"}]
        rep.check(spy["calls"] == want and spy["applied"] == 0,
                  f"{name}: 거리 조절이 촬영 제약을 바꾸지 않음",
                  f"getUserMedia {spy['calls']} · applyConstraints {spy['applied']}회")
    finally:
        # 카메라를 켠 채 두면 MediaPipe가 매 프레임 추론을 계속해 다음 기기가 느려진다.
        await ctx.close()


async def main() -> int:
    if not (Path(__file__).resolve().parents[1] / "dist" / "index.html").exists():
        print("[camera] dist/ 가 없다 — 먼저 npm run build")
        return 1
    from playwright.async_api import async_playwright

    httpd = serve()
    rep = Report()
    try:
        async with async_playwright() as p:
            exe = None
            for cand in ("/opt/pw-browsers/chromium",
                         "/usr/bin/google-chrome", "/usr/bin/chromium-browser"):
                if Path(cand).exists():
                    exe = cand
                    break
            browser = await p.chromium.launch(
                executable_path=exe,
                args=["--no-sandbox", "--use-fake-ui-for-media-stream",
                      "--use-fake-device-for-media-stream"])
            for name, w, h, mobile in DEVICES:
                try:
                    await run_device(browser, name, w, h, mobile, rep, port_of(httpd))
                except Exception as error:
                    rep.check(False, f"{name}: 검사 도중 예외",
                              f"{type(error).__name__}: {str(error)[:120]}")
            await browser.close()
    finally:
        httpd.shutdown()

    if rep.fails:
        print(f"[camera] ✗ 실패 {len(rep.fails)}건: {rep.fails}")
        return 1
    print(f"[camera] ✓ {len(rep.lines) - len(DEVICES)}건 통과")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
