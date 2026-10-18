"""최종보고서용 다이어그램 — HTML/SVG로 그리고 Chromium으로 2배 해상도 PNG를 찍는다.

실선 = 구현·운영한 것, 점선 = KOREN 확장 설계(아직 실측 전). 그림마다 범례로 밝힌다.
수치는 저장소의 측정값만 쓴다.
"""
import json
import math
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
OUT = HERE / "img"
OUT.mkdir(exist_ok=True)
FONT_B = (ROOT / "ppt/제출/글꼴/Pretendard-Bold.ttf").as_uri()
FONT_R = (ROOT / "ppt/제출/글꼴/Pretendard-Regular.ttf").as_uri()

CSS = f"""
@font-face {{ font-family: P; src: url('{FONT_R}'); font-weight: 400; }}
@font-face {{ font-family: P; src: url('{FONT_B}'); font-weight: 700; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: P, sans-serif; color: #17202a; background: #fff; }}
.wrap {{ padding: 36px 44px; }}
h1 {{ font-size: 30px; font-weight: 700; letter-spacing: -0.5px; }}
.sub {{ font-size: 17px; color: #5b6673; margin-top: 6px; }}
.legend {{ display: flex; gap: 22px; font-size: 14px; color: #5b6673; align-items: center; }}
.legend i {{ display: inline-block; width: 34px; height: 0; border-top: 3px solid #0b6e79; margin-right: 6px; vertical-align: middle; }}
.legend i.d {{ border-top-style: dashed; border-color: #c2410c; }}
.tag {{ display: inline-block; font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 99px; }}
.tag.ok {{ background: #dff3f1; color: #0b6e79; }}
.tag.plan {{ background: #ffedd5; color: #c2410c; }}
"""

C = dict(core="#3b2f8f", coreBg="#efedfb", edge="#0b6e79", edgeBg="#e3f4f3",
         user="#a15c07", userBg="#fdf3e3", ink="#17202a", sub="#5b6673", line="#9aa6b2",
         plan="#c2410c", land="#e9edf1", landStroke="#c3ccd5")


def shoot(name, html, w, h):
    page_html = f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{html}</body></html>"
    f = HERE / f"_{name}.html"
    f.write_text(page_html, encoding="utf-8")
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
        pg.goto(f.as_uri())
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(OUT / f"{name}.png"), full_page=False)
        b.close()
    f.unlink()
    print("saved", name)


# ── 지도 투영 ───────────────────────────────────────────
GEO = json.loads((HERE / "skorea_provinces.json").read_text())
LON0, LON1, LAT0, LAT1 = 125.0, 130.0, 33.1, 38.65
K = math.cos(math.radians(36))


def proj(lon, lat, x0, y0, W, H):
    sx = W / ((LON1 - LON0) * K)
    sy = H / (LAT1 - LAT0)
    s = min(sx, sy)
    return x0 + (lon - LON0) * K * s, y0 + (LAT1 - lat) * s


def korea_paths(x0, y0, W, H):
    out = []
    for ft in GEO["features"]:
        g = ft["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            ring = poly[0]
            if len(ring) < 8:
                continue
            pts = [proj(lo, la, x0, y0, W, H) for lo, la in ring if 124.5 < lo < 130.5]
            if len(pts) < 4:
                continue
            d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + "Z"
            out.append(f"<path d='{d}' fill='{C['land']}' stroke='{C['landStroke']}' stroke-width='1'/>")
    return "\n".join(out)


POPS = {  # KOREN PoP(지역 거점) — 서울은 Core
    "서울": (126.98, 37.57), "대전": (127.38, 36.35), "대구": (128.60, 35.87),
    "부산": (129.07, 35.18), "광주": (126.85, 35.16),
}
LINKS = [("서울", "대전"), ("대전", "대구"), ("대구", "부산"), ("대전", "광주"), ("광주", "부산"), ("서울", "대구")]
SITES = {"경산시장애인종합복지관": (128.74, 35.83), "대구광역시청각언어장애인복지관": (128.57, 35.90)}


# ── 그림 A: KOREN 활용 네트워크 구성도(지도 + 3계층) ─────────
def koren_network():
    W, H = 1600, 1020
    mx, my, mw, mh = 40, 120, 620, 860
    P = {k: proj(*v, mx, my, mw, mh) for k, v in POPS.items()}
    svg = [f"<svg width='{W}' height='{H}' style='position:absolute;left:0;top:0'>",
           "<defs><marker id='ah' markerWidth='10' markerHeight='10' refX='8' refY='5' orient='auto'><path d='M0,0 L10,5 L0,10z' fill='#0b6e79'/></marker>"
           "<marker id='ahp' markerWidth='10' markerHeight='10' refX='8' refY='5' orient='auto'><path d='M0,0 L10,5 L0,10z' fill='#c2410c'/></marker>"
           "<marker id='ahc' markerWidth='10' markerHeight='10' refX='8' refY='5' orient='auto'><path d='M0,0 L10,5 L0,10z' fill='#3b2f8f'/></marker>"
           "<filter id='sh' x='-20%' y='-20%' width='140%' height='140%'><feDropShadow dx='0' dy='3' stdDeviation='5' flood-opacity='0.12'/></filter></defs>",
           korea_paths(mx, my, mw, mh)]
    # 백본
    for a, b in LINKS:
        (x1, y1), (x2, y2) = P[a], P[b]
        svg.append(f"<line x1='{x1}' y1='{y1}' x2='{x2}' y2='{y2}' stroke='#3b2f8f' stroke-width='5' stroke-linecap='round' opacity='0.85'/>")
    # 현장(경산·대구)
    for name, ll in SITES.items():
        x, y = proj(*ll, mx, my, mw, mh)
        svg.append(f"<circle cx='{x}' cy='{y}' r='7' fill='#a15c07' stroke='#fff' stroke-width='2'/>")
    # PoP
    for k, (x, y) in P.items():
        core = k == "서울"
        r = 20 if core else 14
        fill = C["core"] if core else C["edge"]
        svg.append(f"<circle cx='{x}' cy='{y}' r='{r + 8}' fill='{fill}' opacity='0.15'/>")
        svg.append(f"<circle cx='{x}' cy='{y}' r='{r}' fill='{fill}' stroke='#fff' stroke-width='3' filter='url(#sh)'/>")
        dx, dy = {"서울": (-104, 7), "대전": (-98, 7), "광주": (-98, 7), "대구": (16, -22), "부산": (-120, 44)}[k]
        svg.append(f"<text x='{x + dx}' y='{y + dy}' font-size='19' font-weight='700' fill='{fill}'>{k} PoP</text>")
    # 연결선(지도 → 오른쪽 상자)
    sx, sy = P["서울"]
    svg.append(f"<path d='M{sx + 24},{sy - 6} C {sx + 160},{sy - 80} 640,240 702,240' stroke='#3b2f8f' stroke-width='2.5' fill='none' marker-end='url(#ahc)'/>")
    dx_, dy_ = P["대구"]
    svg.append(f"<path d='M{dx_ + 18},{dy_ - 4} C {dx_ + 130},{dy_ + 20} 640,490 702,490' stroke='#0b6e79' stroke-width='2.5' fill='none' stroke-dasharray='8 6' marker-end='url(#ah)'/>")
    gx, gy = proj(*SITES["경산시장애인종합복지관"], mx, my, mw, mh)
    svg.append(f"<path d='M{gx + 8},{gy + 6} C {gx + 170},{gy + 30} 600,760 702,760' stroke='#a15c07' stroke-width='2.5' fill='none' marker-end='url(#ahp)'/>")
    svg.append("</svg>")

    def layer(top, h, color, bg, title, tag, rows, badge=""):
        cells = "".join(
            f"<div style='flex:1;background:#fff;border:1.5px solid {color}33;border-radius:12px;padding:12px 14px'>"
            f"<div style='font-size:17px;font-weight:700;color:{color}'>{t}</div>"
            f"<div style='font-size:14px;color:#3d4752;margin-top:5px;line-height:1.5'>{d}</div></div>" for t, d in rows)
        return (f"<div style='position:absolute;left:712px;top:{top}px;width:850px;height:{h}px;background:{bg};"
                f"border:2px solid {color};border-radius:18px;padding:16px 18px'>"
                f"<div style='display:flex;align-items:center;gap:10px'><div style='font-size:22px;font-weight:700;color:{color}'>{title}</div>{tag}{badge}</div>"
                f"<div style='display:flex;gap:10px;margin-top:12px'>{cells}</div></div>")

    def flow(top, color, k, v):
        return (f"<div style='position:absolute;left:712px;top:{top}px;width:850px;display:flex;align-items:center;gap:10px;font-size:14px;color:#3d4752'>"
                f"<span style='font-size:18px;color:{color}'>▼</span><b style='color:{color}'>{k}</b>{v}</div>")

    ok = "<span class='tag ok'>구현·운영</span>"
    plan = "<span class='tag plan'>확장 설계</span>"
    html = [f"<div class='wrap' style='position:relative;width:{W}px;height:{H}px'>",
            "<h1>KOREN 활용 네트워크 구성도 — Core · Edge · 단말 3계층</h1>",
            "<div class='sub'>무거운 데이터·학습은 KOREN Core에, 가벼운 수어 패키지는 지역 PoP Edge로, 추론은 단말에서. 통신이 끊기면 단말이 혼자 답한다.</div>",
            "<div class='legend' style='position:absolute;left:44px;top:982px'>"
            "<span><i></i>구현·운영</span><span><i class='d'></i>KOREN 확장 설계</span>"
            "<span><b style='color:#3b2f8f'>●</b> Core PoP</span><span><b style='color:#0b6e79'>●</b> 지역 PoP(Edge)</span>"
            "<span><b style='color:#a15c07'>●</b> 현장 시연·평가(경산·대구)</span><span style='color:#3b2f8f'>━ KOREN 백본</span></div>",
            "".join(svg),
            layer(140, 196, C["core"], C["coreBg"], "Core Cloud · 수도권 KOREN", ok, [
                ("AI Cloud (CHEETAH)", "H200 MIG 1g.35GB · vCPU 16<br>AI Hub 133GB 수신 · 40만 클립 ETL<br>모델 4종 학습·평가·ONNX"),
                ("HPC 이노베이션 허브", "Xeon Gold VM · PBS Torque<br>영상 → 관절 좌표<br>클립 단위 분산 변환"),
                ("KOREN VM · 원천 서버", "24시간 상시 운영<br>웹앱·모델·동작 사전 배포<br>재난문자 수집 → 판단 → 변환"),
            ]),
            flow(348, C["core"], "Core → Edge", "모델 50MB · 동작 사전 갱신분 · 수어 패키지(약 2.4KB/문장) — KOREN 백본으로 지역 PoP에 동기화"),
            layer(392, 196, C["edge"], C["edgeBg"], "Edge Cloud · 지역 PoP (대전·대구·부산·광주)", plan, [
                ("수어 패키지 캐시", "글로스열 + 키포인트<br>문장당 약 2.4KB<br>(영상 대비 약 1/2,000)"),
                ("동작 사전·모델 미러", "동작 사전 12,833종<br>인식 20MB · 번역 30MB<br>가까운 PoP에서 내려받기"),
                ("지역 재난 송출", "재난 지역 PoP로만 푸시<br>전국 동시 발령은<br>PoP 병렬 송출"),
            ]),
            flow(600, C["edge"], "Edge → 단말", "첫 방문 때 앱·모델·사전을 받아 저장 → 이후에는 새 재난 패키지(KB 단위)만 받는다"),
            layer(644, 196, C["user"], C["userBg"], "End User · 단말 (폰 · 태블릿 · 기관 키오스크)", ok, [
                ("기기 안 추론", "인식·번역·길 안내를<br>브라우저에서 실행<br>영상은 기기 밖으로 안 나감"),
                ("오프라인 폴백", "통신이 끊겨도 저장된<br>모델·사전·전국 28,125곳으로<br>수어로 묻고 답한다"),
                ("현장 시연·평가", "경산시장애인종합복지관<br>대구광역시청각언어장애인복지관<br>→ 최근접 대구 PoP 권역"),
            ]),
            "<div style='position:absolute;left:712px;top:872px;width:850px;height:86px;border-radius:14px;background:#17202a;color:#fff;padding:14px 18px;display:flex;gap:18px'>"
            + "".join(f"<div style='flex:1'><div style='font-size:24px;font-weight:700;color:{c}'>{v}</div><div style='font-size:13px;color:#c9d1d9;margin-top:2px'>{k}</div></div>"
                      for v, k, c in (("133GB", "AI Hub 원본 KOREN 수신", "#b9b0ff"), ("40만 클립", "AI Cloud 스트리밍 ETL", "#b9b0ff"),
                                      ("215만/에폭", "학습 세그먼트 · 21~25분", "#b9b0ff"), ("1/2,000", "영상 대비 송출 크기", "#7fd6cf"),
                                      ("24시간", "KOREN VM 상시 운영", "#f6c177")))
            + "</div>",
            "</div>"]
    shoot("koren_network", "".join(html), W, H)


# ── 그림 B: 데이터·모델 파이프라인 ───────────────────────────
def pipeline():
    W, H = 1600, 700
    stages = [
        ("AI Hub", "수어 말뭉치 원본", "133GB", "#17202a", "#f3f5f7", "재난안전 수어영상<br>수어영상(WORD·SEN·FS)<br>7z 통짜 압축 · 메타 중첩"),
        ("KOREN 전송", "연구망으로 수신", "133GB", "#3b2f8f", "#efedfb", "AI Cloud 워크스페이스로<br>직접 수신 · 개인 PC 경유 없음<br>내려받는 중 최대 약 3배 공간"),
        ("ETL (AI Cloud)", "무해제 스트리밍 가공", "40만 클립", "#3b2f8f", "#efedfb", "한 번만 훑는 stream_7z<br>좌표 정제 · 수어자 분리<br>pack.feature_health 검사"),
        ("학습 (H200 MIG)", "모델 4종 · 에폭당 세그먼트", "215만", "#3b2f8f", "#efedfb", "iso-v2 · t2gs-v2<br>ctc-v1 · g2ts-v1<br>에폭당 21~25분"),
        ("내보내기", "ONNX · int8", "20MB + 30MB", "#0b6e79", "#e3f4f3", "특징 일치 검사 오차 0<br>CTC 디코딩 3,000판 일치<br>int8 품질 재측정"),
        ("배포 (KOREN VM)", "웹앱 · PWA", "단말 저장", "#a15c07", "#fdf3e3", "모델·동작 사전·장소 목록<br>비행기 모드에서도 동작"),
    ]
    cards = []
    x = 44
    w = 230
    for i, (t, s, big, col, bg, body) in enumerate(stages):
        cards.append(
            f"<div style='position:absolute;left:{x}px;top:140px;width:{w}px;height:262px;background:{bg};border:2px solid {col};border-radius:16px;padding:16px'>"
            f"<div style='font-size:13px;font-weight:700;color:#fff;background:{col};display:inline-block;padding:2px 10px;border-radius:99px'>STEP {i + 1}</div>"
            f"<div style='font-size:21px;font-weight:700;color:{col};margin-top:10px'>{t}</div>"
            f"<div style='font-size:14px;color:#5b6673'>{s}</div>"
            f"<div style='font-size:26px;font-weight:700;margin-top:12px;letter-spacing:-0.5px'>{big}</div>"
            f"<div style='font-size:14px;color:#3d4752;margin-top:10px;line-height:1.55'>{body}</div></div>")
        if i < len(stages) - 1:
            cards.append(f"<div style='position:absolute;left:{x + w + 2}px;top:272px;font-size:26px;color:#9aa6b2'>▶</div>")
        x += w + 24
    # 크기 축소 막대
    bars = [("원본 영상", "133GB", 1.0, "#17202a"), ("모델 2종(단말 저장)", "약 50MB", 0.42, "#0b6e79"),
            ("문장 하나의 수어 패키지", "약 2.4KB", 0.06, "#a15c07")]
    rows = []
    for i, (n, v, frac, col) in enumerate(bars):
        rows.append(f"<div style='display:flex;align-items:center;gap:14px;margin-top:12px'>"
                    f"<div style='width:230px;font-size:16px;text-align:right'>{n}</div>"
                    f"<div style='height:28px;width:{max(frac * 1000, 8):.0f}px;background:{col};border-radius:6px'></div>"
                    f"<div style='font-size:18px;font-weight:700'>{v}</div></div>")
    html = (f"<div class='wrap' style='position:relative;width:{W}px;height:{H}px'>"
            "<h1>데이터·모델 파이프라인 — 무거운 것은 KOREN 안에, 가벼운 것만 밖으로</h1>"
            "<div class='sub'>원본은 연구망 안에서만 다루고, 단말과 송출망에는 수십 MB 모델과 KB 단위 수어 패키지만 나간다.</div>"
            + "".join(cards) +
            "<div style='position:absolute;left:44px;top:440px;width:1512px;border-top:1.5px solid #e3e7ec;padding-top:18px'>"
            "<div style='font-size:20px;font-weight:700'>단계별로 옮기는 크기 (막대 길이는 개념 표시 · 실제 비율 아님)</div>"
            + "".join(rows) +
            "<div style='font-size:14px;color:#5b6673;margin-top:14px'>문장 하나를 영상으로 보내는 대신 관절 좌표 + 글로스로 보내면 약 1/2,000 크기다. 전국 동시 송출에서 회선 부담이 그만큼 작다.</div>"
            "</div></div>")
    shoot("pipeline", html, W, H)


# ── 그림 C: 양방향 처리 흐름(4개 에이전트) ──────────────────
def bidir():
    W, H = 1600, 650

    def row(top, color, bg, label, steps):
        out = [f"<div style='position:absolute;left:44px;top:{top}px;font-size:20px;font-weight:700;color:{color}'>{label}</div>"]
        x = 44
        w = 352
        for i, (t, d, ag) in enumerate(steps):
            agent = f"<div style='font-size:12px;font-weight:700;color:{color};margin-bottom:4px'>{ag}</div>" if ag else ""
            out.append(f"<div style='position:absolute;left:{x}px;top:{top + 38}px;width:{w}px;height:150px;background:{bg};border:2px solid {color};border-radius:16px;padding:14px 16px'>"
                       f"{agent}<div style='font-size:20px;font-weight:700;color:{color}'>{t}</div>"
                       f"<div style='font-size:14.5px;color:#3d4752;margin-top:8px;line-height:1.55'>{d}</div></div>")
            if i < len(steps) - 1:
                out.append(f"<div style='position:absolute;left:{x + w + 4}px;top:{top + 96}px;font-size:24px;color:{color}'>▶</div>")
            x += w + 34
        return "".join(out)

    html = (f"<div class='wrap' style='position:relative;width:{W}px;height:{H}px'>"
            "<h1>양방향 처리 흐름 — 4개 에이전트가 이어서 일한다</h1>"
            "<div class='sub'>두 방향이 같은 155차원 특징 정의를 쓴다. 학습(파이썬)과 추론(브라우저)의 수치 차이는 0으로 유지한다.</div>"
            + row(120, C["edge"], C["edgeBg"], "① 한국어 → 수어  (받기 · 대화)", [
                ("재난문자 · 직원 음성", "재난 종류·심각도·지역을 뽑는다<br>행동요령(명령 말투)은 사전 경로로 분기", "AGENT 1 · 재난 판단"),
                ("수어 변환 3단 폴백", "① t2gs-v2(재난문자, int8 30MB)<br>② Dice 통계 사전 230,240낱말<br>③ 조사·어미 규칙 · 부정어 고정", "AGENT 2 · 수어 변환"),
                ("동작 사전 12,833종", "실제 농인 수어자 키포인트 조각<br>손 깊이(z) 수록률 96%<br>클립 없는 낱말은 낱말 카드", "AGENT 4 · 송출"),
                ("3D 아바타 재생", "팔·손가락 리타게팅<br>고개 끄덕임·흔들기<br>폰·태블릿·키오스크", ""),
            ])
            + row(330, C["user"], C["userBg"], "② 수어 → 한국어 · 음성  (묻기 · 대화)", [
                ("웹캠", "MediaPipe(동봉 32MB)로<br>상반신·양손 관절 추출<br>영상은 기기 밖으로 안 나감", ""),
                ("155차원 특징", "어깨 기준 정규화<br>features.py == landmarks.ts<br>오차 0 검사", ""),
                ("낱말 인식 iso-v2", "트랜스포머 2.8M · ONNX int8 20MB<br>13,576종 · 미지 수어자 top-5 91.9%", ""),
                ("의도 판정 · 답", "낱말 묶음 → 의도 27/27<br>거리·8방위·어림수 → 수어+지도<br>한국어 문장 → 음성 출력", "AGENT 3 · 질의응답"),
            ])
            + "<div style='position:absolute;left:44px;top:560px;width:1512px;background:#f3f5f7;border-radius:12px;padding:14px 18px;font-size:15px;color:#3d4752'>"
              "<b>조용한 실패를 잡는 계측</b> — 어느 단계가 답했는지·재생 프레임 수·손 깊이 적용 여부를 화면 속성(data-sign-*)으로 남기고 자동 검사가 확인한다. "
              "화면은 정상인데 알맹이가 없는 실패(아바타 정지, 부정 손실, 방향 뒤집힘)를 눈 대신 수치로 잡는다.</div>"
            "</div>")
    shoot("bidir", html, W, H)


# ── 그림 D: 재난 발령 → 수어 표출 송출 시퀀스(KOREN 설계) ─────
def sequence():
    W, H = 1600, 900
    lanes = [("재난문자 원천", "행정안전부 CBS · 공공데이터", "#17202a"),
             ("Core · KOREN VM", "판단 · 변환 · 패키징", C["core"]),
             ("KOREN 백본", "연구망 전송", "#6b5bd6"),
             ("Edge · 지역 PoP", "캐시 · 지역 송출", C["edge"]),
             ("단말", "폰 · 태블릿 · 키오스크", C["user"])]
    lx = [150 + i * 315 for i in range(5)]
    svg = [f"<svg width='{W}' height='{H}' style='position:absolute;left:0;top:0'>"
           "<defs><marker id='m' markerWidth='10' markerHeight='10' refX='9' refY='5' orient='auto'><path d='M0,0 L10,5 L0,10z' fill='#3d4752'/></marker>"
           "<marker id='mp' markerWidth='10' markerHeight='10' refX='9' refY='5' orient='auto'><path d='M0,0 L10,5 L0,10z' fill='#c2410c'/></marker></defs>"]
    for (t, s, col), x in zip(lanes, lx):
        svg.append(f"<line x1='{x}' y1='210' x2='{x}' y2='800' stroke='{col}' stroke-width='2' stroke-dasharray='4 6' opacity='0.6'/>")
    steps = [
        (0, 1, 250, "① 재난문자 수신(텍스트)", True),
        (1, 1, 300, "② 재난 판단 → 수어 변환 → 패키징(글로스+키포인트)", None),
        (1, 3, 380, "③ 해당 지역 PoP로만 푸시 · 약 2.4KB/문장", True),
        (3, 4, 450, "④ 가까운 PoP에서 단말로 전달", True),
        (4, 4, 500, "⑤ 단말이 아바타 수어로 재생", None),
        (4, 3, 590, "⑥ 최신 대피소·재난 정보 요청(선택)", True),
        (3, 1, 650, "⑦ Edge 캐시에 없을 때만 Core 조회", True),
    ]
    for a, b, y, label, planned in steps:
        col = "#c2410c" if planned else "#3d4752"
        mk = "mp" if planned else "m"
        dash = "stroke-dasharray='9 6'" if planned else ""
        if a == b:
            x = lx[a]
            svg.append(f"<rect x='{x - 8}' y='{y - 18}' width='16' height='36' rx='4' fill='{col}'/>")
            anchor = "end" if a == 4 else "start"
            tx_ = x - 18 if a == 4 else x + 18
            svg.append(f"<text x='{tx_}' y='{y + 6}' font-size='16' fill='{col}' font-weight='700' text-anchor='{anchor}'>{label}</text>")
        else:
            x1, x2 = lx[a], lx[b]
            off = 10 if x2 > x1 else -10
            svg.append(f"<line x1='{x1 + off}' y1='{y}' x2='{x2 - off}' y2='{y}' stroke='{col}' stroke-width='3' {dash} marker-end='url(#{mk})'/>")
            tx = min(x1, x2) + 18
            svg.append(f"<text x='{tx}' y='{y - 10}' font-size='16' fill='{col}' font-weight='700'>{label}</text>")
    # 오프라인 폴백
    svg.append(f"<rect x='{lx[2] + 40}' y='700' width='{1556 - lx[2] - 40}' height='86' rx='14' fill='#fdf3e3' stroke='#a15c07' stroke-width='2'/>")
    svg.append(f"<text x='{lx[2] + 60}' y='734' font-size='17' font-weight='700' fill='#a15c07'>통신 단절 시 — 단말 단독 동작(구현)</text>")
    svg.append(f"<text x='{lx[2] + 60}' y='764' font-size='15' fill='#3d4752'>저장된 인식·번역 모델, 동작 사전, 전국 28,125곳으로 수어 질의응답·방향 안내</text>")
    svg.append("</svg>")
    heads = "".join(
        f"<div style='position:absolute;left:{x - 140}px;top:130px;width:280px;text-align:center'>"
        f"<div style='display:inline-block;background:{col};color:#fff;font-weight:700;font-size:18px;padding:8px 18px;border-radius:10px'>{t}</div>"
        f"<div style='font-size:14px;color:#5b6673;margin-top:6px'>{s}</div></div>" for (t, s, col), x in zip(lanes, lx))
    html = (f"<div class='wrap' style='position:relative;width:{W}px;height:{H}px'>"
            "<h1>재난 발령 → 수어 표출 송출 시퀀스 (KOREN 설계)</h1>"
            "<div class='sub'>영상이 아니라 KB 단위 수어 패키지를 지역 PoP로 보내 전국 동시 발령에서도 회선이 막히지 않게 한다.</div>"
            + heads + "".join(svg) +
            "<div class='legend' style='position:absolute;left:44px;top:858px'><span><b style='color:#3d4752'>▮</b> 처리 단계</span><span><i class='d'></i>KOREN Core·PoP 송출 설계(실측 예정)</span><span style='color:#a15c07'>■ 단말 단독 동작은 구현·검증 완료</span></div>"
            "</div>")
    shoot("sequence", html, W, H)


# ── 그림 E: 추진 일정 ────────────────────────────────────
def gantt():
    W, H = 1600, 640
    months = ["7월", "8월", "9월", "10월"]
    x0, cw = 330, 300
    rows = [
        ("데모 웹앱 · 아바타 리타게팅 · 규칙 MVP", 0.0, 1.0, C["edge"], "완료"),
        ("AI Cloud 구축 · 133GB 수신 · ETL", 1.0, 1.5, C["core"], "완료"),
        ("인식·번역 모델 학습 · 브라우저 배포", 1.3, 1.9, C["core"], "완료"),
        ("복지관 2곳 현장 시연 (경산 · 대구)", 1.4, 1.9, C["user"], "완료"),
        ("연속 인식 CTC · 글로스→한국어 학습", 1.6, 1.95, C["core"], "학습 완료"),
        ("농인 당사자 평가", 2.0, 3.5, C["user"], "실시"),
        ("KOREN VM 상시 서버 운영", 2.0, 4.0, C["edge"], "운영"),
        ("최종보고 · 시연 준비 · 최종평가(10/30)", 3.3, 4.0, "#17202a", "진행"),
    ]
    head = "".join(f"<div style='position:absolute;left:{x0 + i * cw}px;top:120px;width:{cw}px;text-align:center;font-size:22px;font-weight:700;border-bottom:2px solid #d6dce3;padding-bottom:8px'>{m}</div>" for i, m in enumerate(months))
    grid = "".join(f"<div style='position:absolute;left:{x0 + i * cw}px;top:160px;width:0;height:420px;border-left:1px dashed #d6dce3'></div>" for i in range(5))
    bars = []
    for i, (n, a, b, col, st) in enumerate(rows):
        y = 180 + i * 50
        bars.append(f"<div style='position:absolute;left:44px;top:{y + 4}px;width:280px;font-size:19px;text-align:right'>{n}</div>"
                    f"<div style='position:absolute;left:{x0 + a * cw + 6}px;top:{y}px;width:{(b - a) * cw - 12}px;height:30px;background:{col};border-radius:8px;color:#fff;font-size:16px;font-weight:700;padding:4px 10px'>{st}</div>")
    ms = [(1.6, "중간평가 8/19"), (3.95, "최종평가 10/30")]
    mk = "".join(f"<div style='position:absolute;left:{x0 + m * cw - 1}px;top:160px;height:420px;border-left:3px solid #c2410c'></div>"
                 f"<div style='position:absolute;left:{x0 + m * cw - 80}px;top:590px;width:160px;text-align:center;font-size:17px;font-weight:700;color:#c2410c'>◆ {t}</div>" for m, t in ms)
    html = (f"<div class='wrap' style='position:relative;width:{W}px;height:{H}px'>"
            "<h1>추진 일정과 실적</h1><div class='sub'>5단계 계획 대비 실제 진행. 3단계에서 계획에 없던 오프라인·창구 대화·묻기 화면을 추가했다.</div>"
            + head + grid + "".join(bars) + mk + "</div>")
    shoot("gantt", html, W, H)


if __name__ == "__main__":
    koren_network()
    pipeline()
    bidir()
    sequence()
    gantt()
