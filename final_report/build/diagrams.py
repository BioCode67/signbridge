"""최종보고서용 구성도 2장(시스템 구성도 · KOREN 네트워크 구성도)을 그린다."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "img"
OUT.mkdir(parents=True, exist_ok=True)
FB = str(ROOT / "ppt/제출/글꼴/Pretendard-Bold.ttf")
FR = str(ROOT / "ppt/제출/글꼴/Pretendard-Regular.ttf")
f = lambda p, s: ImageFont.truetype(p, s)

INK, SUB, LINE = "#1b1f24", "#55606b", "#9aa5b1"
TEAL, TEAL_BG = "#0e7c86", "#e3f4f5"
AMB, AMB_BG = "#a8620a", "#fdf1e0"
VIO, VIO_BG = "#5b4bb7", "#eeebfb"
GRY_BG = "#f2f4f6"


def box(d, xy, title, lines, fg, bg, tsize=34, lsize=26):
    x0, y0, x1, y1 = xy
    d.rounded_rectangle(xy, radius=22, fill=bg, outline=fg, width=4)
    cx = (x0 + x1) // 2
    d.text((cx, y0 + 22), title, font=f(FB, tsize), fill=fg, anchor="ma")
    y = y0 + 22 + tsize + 16
    for ln in lines:
        d.text((cx, y), ln, font=f(FR, lsize), fill=INK, anchor="ma")
        y += lsize + 10


def arrow(d, a, b, color=LINE, w=6, label=None, lpos=None):
    d.line([a, b], fill=color, width=w)
    import math
    ang = math.atan2(b[1] - a[1], b[0] - a[0])
    L = 22
    p1 = (b[0] - L * math.cos(ang - 0.45), b[1] - L * math.sin(ang - 0.45))
    p2 = (b[0] - L * math.cos(ang + 0.45), b[1] - L * math.sin(ang + 0.45))
    d.polygon([b, p1, p2], fill=color)
    if label:
        x, y = lpos or ((a[0] + b[0]) // 2, (a[1] + b[1]) // 2 - 34)
        d.text((x, y), label, font=f(FR, 24), fill=SUB, anchor="ma")


def system():
    W, H = 2400, 1250
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    d.text((60, 40), "SignBridge 시스템 구성 — 브라우저 안에서 두 방향이 모두 동작", font=f(FB, 46), fill=INK)
    d.text((60, 104), "학습은 KOREN AI Cloud, 추론은 사용자 기기. 서버로 영상·문장을 보내지 않는다.", font=f(FR, 28), fill=SUB)
    # 출력 방향
    d.text((60, 190), "① 한국어 → 수어 (받기·대화)", font=f(FB, 32), fill=TEAL)
    y0, y1 = 250, 500
    xs = [(60, 470), (540, 1030), (1100, 1560), (1630, 2340)]
    box(d, (xs[0][0], y0, xs[0][1], y1), "재난문자·직원 음성", ["재난 판단 에이전트", "종류·심각도·지역"], TEAL, TEAL_BG)
    box(d, (xs[1][0], y0, xs[1][1], y1), "수어 변환(3단 폴백)", ["① 학습 모델 t2gs-v2", "② 통계 사전 23만 낱말", "③ 규칙(조사·어미)"], TEAL, TEAL_BG)
    box(d, (xs[2][0], y0, xs[2][1], y1), "동작 사전 12,833종", ["실제 농인 수어자", "키포인트 조각 잇기"], TEAL, TEAL_BG)
    box(d, (xs[3][0], y0, xs[3][1], y1), "3D 아바타 출력", ["손가락 리타게팅·손 깊이(z)", "고개 끄덕임·흔들기", "폰·태블릿·키오스크"], TEAL, TEAL_BG)
    for a, b in zip(xs, xs[1:]):
        arrow(d, (a[1] + 6, (y0 + y1) // 2), (b[0] - 6, (y0 + y1) // 2), TEAL)
    # 입력 방향
    d.text((60, 580), "② 수어 → 한국어·음성 (묻기·대화)", font=f(FB, 32), fill=AMB)
    y0, y1 = 640, 890
    box(d, (xs[0][0], y0, xs[0][1], y1), "웹캠", ["영상은 기기 밖으로", "나가지 않음"], AMB, AMB_BG)
    box(d, (xs[1][0], y0, xs[1][1], y1), "MediaPipe 랜드마크", ["상반신·양손 관절", "155차원 특징(학습과 동일)"], AMB, AMB_BG)
    box(d, (xs[2][0], y0, xs[2][1], y1), "낱말 인식 iso-v2", ["트랜스포머 2.8M", "13,576종 · ONNX int8"], AMB, AMB_BG)
    box(d, (xs[3][0], y0, xs[3][1], y1), "의도 판정 · 답 생성", ["한국어 문장 → 음성 출력", "대피소 방향·거리(오프라인)", "아바타가 수어로 답함"], AMB, AMB_BG)
    for a, b in zip(xs, xs[1:]):
        arrow(d, (a[1] + 6, (y0 + y1) // 2), (b[0] - 6, (y0 + y1) // 2), AMB)
    # 하단: 학습
    y0, y1 = 980, 1200
    box(d, (60, y0, 2340, y1), "KOREN AI Cloud에서 학습 → 모델 파일만 기기로",
        ["AI Hub 수어 말뭉치 133GB 수신 · 40만 클립 가공 · 수어자 분리 평가",
         "인식(iso-v2) · 번역(t2gs-v2) 모델을 ONNX로 내보내 브라우저(PWA)에 동봉 → 비행기 모드에서도 동작"], VIO, VIO_BG)
    im.save(OUT / "system.png")


def network():
    W, H = 2400, 1300
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    d.text((60, 40), "KOREN 활용 네트워크 구성도", font=f(FB, 46), fill=INK)
    d.text((60, 104), "성격이 다른 KOREN 자원 셋을 역할별로 나누고, 무거운 데이터는 제자리에 두고 가벼운 것만 옮긴다.", font=f(FR, 28), fill=SUB)
    # KOREN 백본 영역
    d.rounded_rectangle((400, 180, 2000, 900), radius=30, fill=GRY_BG, outline=LINE, width=3)
    d.text((1200, 200), "KOREN 연구망", font=f(FB, 34), fill=SUB, anchor="ma")
    box(d, (60, 330, 340, 560), "AI Hub", ["수어 말뭉치", "원본 133GB"], INK, "white")
    box(d, (460, 280, 940, 560), "HPC 이노베이션 허브", ["Xeon Gold VM · PBS Torque", "영상→랜드마크 분산 변환", "(CPU 전처리)"], AMB, AMB_BG)
    box(d, (1060, 280, 1540, 560), "AI Cloud (CHEETAH)", ["H200 MIG 1g.35GB", "ETL · 학습 · 평가", "ONNX 내보내기"], VIO, VIO_BG)
    box(d, (1460 - 0, 640, 1940, 870), "KOREN VM (상시 서버)", ["데모 웹앱 · 고정 주소", "24시간 운영"], TEAL, TEAL_BG)
    box(d, (460, 640, 1300, 870), "저장소 · 배포", ["GitHub 저장소(코드·모델)", "GitHub Pages 공개 주소"], INK, "white")
    arrow(d, (346, 445), (454, 445), INK, label="원본 수신", lpos=(400, 392))
    arrow(d, (946, 420), (1054, 420), LINE, label="랜드마크 팩", lpos=(1000, 372))
    arrow(d, (1300, 566), (1300, 634), VIO)
    d.text((1320, 584), "모델 20~30MB", font=f(FR, 24), fill=SUB)
    arrow(d, (1306, 755), (1454, 755), LINE)
    # 사용자 기기
    users = [("폰", "받기·묻기"), ("태블릿", "창구 대화"), ("키오스크", "기관 창구"), ("오프라인", "비행기 모드")]
    for i, (t, s) in enumerate(users):
        x = 160 + i * 560
        box(d, (x, 1010, x + 440, 1230), t, [s, "기기 안에서 추론"], TEAL, "white", tsize=32)
        arrow(d, (1700, 876), (x + 220, 1004), TEAL, w=4)
    d.text((2040, 930), "웹앱·모델을 한 번 받으면", font=f(FR, 24), fill=SUB)
    d.text((2040, 962), "이후는 서버 없이 동작", font=f(FR, 24), fill=SUB)
    im.save(OUT / "network.png")


system()
network()
print("ok", OUT)
