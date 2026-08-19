#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""중간평가 발표자료(PPT) 생성.
    python3 ppt/build_ppt.py
사진 8장은 `ppt/photos/`에 01.jpg … 08.jpg 로 넣으면 자동으로 들어간다.
없으면 자리표시자가 그려진다(비어 보이지 않게 안내 문구 포함).
"""
from pptx import Presentation
from pptx.util import Inches as I, Pt, Emu
from pptx.dml.color import RGBColor as C
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pathlib import Path

W, H = 13.333, 7.5
INK   = C(0x16,0x18,0x1D)
MUT   = C(0x6B,0x72,0x80)
CY    = C(0x0E,0xA5,0xB7)
CY_D  = C(0x0A,0x7C,0x8A)
LIGHT = C(0xF4,0xF7,0xF9)
LINE  = C(0xE3,0xE8,0xEE)
AMB   = C(0xD9,0x7B,0x1A)
GRN   = C(0x2F,0xA3,0x7A)
WHITE = C(0xFF,0xFF,0xFF)
BG_D  = C(0x0B,0x0E,0x14)

ASSETS = Path("ppt/assets")
PHOTOS = Path("ppt/photos")
FONT   = "나눔스퀘어"

prs = Presentation()
prs.slide_width, prs.slide_height = I(W), I(H)
BLANK = prs.slide_layouts[6]


PAGE = {"n": 0}


def sld():
    PAGE["n"] += 1
    return prs.slides.add_slide(BLANK)


def rect(s, x, y, w, h, fill=None, line=None, lw=1.0, shape=MSO_SHAPE.RECTANGLE):
    sh = s.shapes.add_shape(shape, I(x), I(y), I(w), I(h))
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid(); sh.fill.fore_color.rgb = fill
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line; sh.line.width = Pt(lw)
    sh.shadow.inherit = False
    return sh


def text(s, x, y, w, h, runs, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=1.0):
    """runs: [(문자열, 크기, 굵게, 색)] — 줄바꿈은 \n"""
    tb = s.shapes.add_textbox(I(x), I(y), I(w), I(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    first = True
    for content, size, bold, color in runs:
        for i, line in enumerate(content.split("\n")):
            p = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            p.alignment = align
            p.line_spacing = spacing
            r = p.add_run(); r.text = line
            r.font.size = Pt(size); r.font.bold = bold
            r.font.color.rgb = color; r.font.name = FONT
    return tb


def pic(s, name, x, y, w=None, h=None):
    p = ASSETS / name
    if not p.exists():
        return None
    kw = {}
    if w: kw["width"] = I(w)
    if h: kw["height"] = I(h)
    return s.shapes.add_picture(str(p), I(x), I(y), **kw)


def imgfit(s, name, x, y, w, h, border=True, folder=None):
    """그림을 x,y,w,h 상자에 **정확히** 맞춰 넣는다(넘치는 쪽을 가운데 기준으로 자른다).

    폭만 주고 넣으면 그림의 원래 비율만큼 아래로 자라 다음 요소를 덮는다 —
    실제로 앱 화면(16:10)을 폭 5.9로 넣어 높이 3.69가 되면서 설명 글씨를
    가리고 있었다. 자리 크기를 먼저 정하고 그림을 거기에 맞춘다.
    """
    p = (folder or ASSETS) / name
    if not p.exists():
        rect(s, x, y, w, h, fill=LIGHT, line=LINE, lw=1)
        return None
    from PIL import Image
    iw, ih = Image.open(p).size
    ar, box = iw / ih, w / h
    if ar > box:                      # 원본이 더 넓다 → 높이를 맞추고 좌우를 자른다
        sh = s.shapes.add_picture(str(p), I(x), I(y), height=I(h))
        sh.crop_left = sh.crop_right = (1 - box / ar) / 2
        sh.left, sh.width = I(x), I(w)
    else:                             # 원본이 더 길다 → 폭을 맞추고 위아래를 자른다
        sh = s.shapes.add_picture(str(p), I(x), I(y), width=I(w))
        sh.crop_top = sh.crop_bottom = (1 - ar / box) / 2
        sh.top, sh.height = I(y), I(h)
    if border:
        rect(s, x, y, w, h, fill=None, line=LINE, lw=1)
    return sh


def caption(s, x, y, w, t):
    text(s, x, y, w, 0.3, [(t, 9.5, False, MUT)], align=PP_ALIGN.CENTER)


def header(s, title, sub=None):
    """모든 내용 슬라이드가 같은 머리를 쓴다 — 양식 통일.

    쪽 번호는 sld() 호출 순서에서 자동으로 나온다. 손으로 적으면
    슬라이드를 끼워 넣을 때마다 목차와 어긋난다.
    """
    no = PAGE["n"]
    rect(s, 0, 0, W, 1.02, fill=WHITE)
    rect(s, 0.62, 0.30, 0.055, 0.42, fill=CY)
    text(s, 0.82, 0.24, 9.6, 0.55,
         [(title, 25, True, INK)])
    if sub:
        text(s, 0.82, 0.70, 10.4, 0.3, [(sub, 12.5, False, MUT)])
    text(s, W - 1.5, 0.32, 0.9, 0.35, [(f"{no:02d}", 13, True, C(0xC3,0xCB,0xD4))],
         align=PP_ALIGN.RIGHT)
    rect(s, 0.62, 1.02, W - 1.24, 0.014, fill=LINE)


def footer(s, note=""):
    rect(s, 0, H - 0.44, W, 0.44, fill=LIGHT)
    text(s, 0.62, H - 0.34, 8.0, 0.25, [("SignBridge · 한국수어 양방향 번역", 9.5, False, MUT)])
    if note:
        text(s, W - 8.62, H - 0.34, 8.0, 0.25, [(note, 9.5, False, MUT)], align=PP_ALIGN.RIGHT)


def stat(s, x, y, w, value, label, note="", color=CY, h=1.55):
    rect(s, x, y, w, h, fill=LIGHT)
    rect(s, x, y, w, 0.045, fill=color)
    text(s, x + 0.24, y + 0.24, w - 0.48, 0.55, [(value, 30, True, color)])
    text(s, x + 0.24, y + 0.86, w - 0.48, 0.3, [(label, 12.5, True, INK)])
    if note:
        text(s, x + 0.24, y + 1.16, w - 0.48, 0.3, [(note, 9.5, False, MUT)])


def bullet(s, x, y, w, items, size=13.5, gap=0.42):
    for i, (head, body) in enumerate(items):
        yy = y + i * gap * (1.75 if body else 1.0)
        rect(s, x, yy + 0.07, 0.075, 0.075, fill=CY, shape=MSO_SHAPE.OVAL)
        text(s, x + 0.25, yy, w - 0.25, 0.3, [(head, size, True, INK)])
        if body:
            text(s, x + 0.25, yy + 0.30, w - 0.25, 0.44, [(body, 11.5, False, MUT)], spacing=1.15)


def photo_slot(s, x, y, w, h, cap, idx):
    """현장 사진 자리 — 파일이 있으면 넣고, 없으면 안내 상자를 그린다."""
    got = None
    for ext in (".jpg", ".jpeg", ".png", ".JPG", ".PNG"):
        p = PHOTOS / f"{idx:02d}{ext}"
        if p.exists():
            got = p; break
    if got:
        from PIL import Image
        iw, ih = Image.open(got).size
        ar, box = iw / ih, w / h
        if ar > box:  # 가로가 길다 → 높이 맞추고 좌우를 자른다
            nh, nw = h, h * ar
            pic_ = s.shapes.add_picture(str(got), I(x - (nw - w) / 2), I(y), height=I(h))
            pic_.crop_left = pic_.crop_right = (1 - box / ar) / 2
            pic_.left, pic_.width = I(x), I(w)
        else:
            nw = w
            pic_ = s.shapes.add_picture(str(got), I(x), I(y), width=I(w))
            pic_.crop_top = pic_.crop_bottom = (1 - ar / box) / 2
            pic_.top, pic_.height = I(y), I(h)
    else:
        rect(s, x, y, w, h, fill=C(0xEE,0xF2,0xF6), line=C(0xC9,0xD4,0xDE), lw=1.2)
        text(s, x, y + h / 2 - 0.42, w, 0.35,
             [(f"사진 {idx}", 15, True, C(0x9A,0xA6,0xB2))], align=PP_ALIGN.CENTER)
        text(s, x, y + h / 2 - 0.02, w, 0.6,
             [(cap, 10.5, False, C(0xA8,0xB4,0xC0))], align=PP_ALIGN.CENTER, spacing=1.2)
        text(s, x, y + h - 0.34, w, 0.25,
             [(f"ppt/photos/{idx:02d}.jpg", 8.5, False, C(0xBC,0xC6,0xD0))], align=PP_ALIGN.CENTER)
    # 사진 아래 설명
    text(s, x, y + h + 0.10, w, 0.30, [(cap, 10.5, False, MUT)], align=PP_ALIGN.CENTER)


# ═══════════════════════════════════════════ 01 표지
s = sld()
rect(s, 0, 0, W, H, fill=BG_D)
rect(s, 0, 0, 0.22, H, fill=CY)
text(s, 1.3, 1.62, 11, 0.4, [("K-디지털 챌린지 · 넷 챌린지 캠프 시즌 13 · 중간평가", 14, True, CY)])
text(s, 1.3, 2.20, 11.2, 1.9,
     [("들리지 않아도,", 48, True, WHITE), ("닿습니다", 48, True, CY)], spacing=1.12)
text(s, 1.3, 4.18, 10.8, 0.45,
     [("KOREN 저지연망 기반 재난정보 실시간 AI 수어(KSL) 통역·송출 서비스", 18.5, True, C(0xDA,0xE2,0xEA))])
text(s, 1.3, 4.66, 10.8, 0.35,
     [("SignBridge — 재난 정보를 수어로 전달하고, 농인의 수어를 한국어와 음성으로 되돌린다", 12.5, False, C(0x9A,0xA6,0xB4))])
rect(s, 1.3, 5.12, 3.2, 0.035, fill=CY)
# 양식 확인용 표기 — 참가분야·팀명은 운영계획 붙임2 학생팀 목록 기준
for i, (k, v) in enumerate([("참가 분야", "N/W 활용 서비스"), ("팀    명", "닿다")]):
    x = 1.3 + i * 3.5
    text(s, x, 5.42, 1.15, 0.3, [(k, 10.5, False, C(0x6E,0x7A,0x88))])
    text(s, x + 1.25, 5.40, 2.2, 0.32, [(v, 13, True, WHITE)])
text(s, 1.3, 6.05, 11, 0.9,
     [("서버 없이 브라우저에서 동작 · 통신이 끊긴 재난 상황에서도 작동", 12.5, False, C(0x9A,0xA6,0xB4))], spacing=1.35)
text(s, W - 5.3, H - 1.15, 4.7, 0.4, [("2026. 08. 19.", 12, False, C(0x6E,0x7A,0x88))], align=PP_ALIGN.RIGHT)

# ═══════════════════════════════════════════ 02 목차
s = sld(); header(s, "발표 순서")
# 심사표(붙임3)의 4개 평가부문에 맞춰 묶었다 — 평가위원이 어느 쪽을 볼지 바로 찾도록.
cols = [
    ("도입", None, "문제와 목표",
     ["03  재난 정보 전달의 공백", "04  시스템 개요", "05  4-에이전트 구조"]),
    ("개발구현 정도", "30점", "핵심 기술과 검증",
     ["06–08  두 방향 기술·학습 데이터", "09–11  정확도·번역 품질·자동 검사", "12–13  당사자가 쓰는 화면"]),
    ("KOREN 활용도", "20점", "KOREN 활용",
     ["14  자원 3종 활용 실적", "     과 향후 방안"]),
    ("개발과정 적정성", "30점", "현장과 과정",
     ["15–16  현장 방문과 피드백", "17  일정 준수와 팀 협업", "18  멘토 의견 반영"]),
    ("기대효과", "20점", "한계와 기대효과",
     ["19  아직 안 되는 것", "20  다음 단계", "21  구현 난이도와 기대효과"]),
]
for i, (tag, score, t, items) in enumerate(cols):
    x = 0.62 + i * 2.418
    w = 2.274
    rect(s, x, 1.58, w, 3.10, fill=LIGHT)
    rect(s, x, 1.58, w, 0.05, fill=CY if score else C(0xA9,0xB4,0xBF))
    text(s, x + 0.22, 1.80, w - 0.3, 0.28,
         [(f"{tag}  {score}" if score else tag, 9.5, True, CY_D if score else MUT)])
    text(s, x + 0.22, 2.14, w - 0.3, 0.4, [(t, 14, True, INK)])
    rect(s, x + 0.22, 2.58, 0.55, 0.022, fill=LINE)
    for j, it in enumerate(items):
        text(s, x + 0.22, 2.78 + j * 0.56, w - 0.3, 0.5, [(it, 10.5, False, INK)], spacing=1.25)
rect(s, 0.62, 5.02, 12.09, 1.32, fill=BG_D)
rect(s, 0.62, 5.02, 0.055, 1.32, fill=CY)
text(s, 1.02, 5.28, 11.4, 0.85,
     [("오늘 드릴 말씀은 하나입니다", 11.5, True, CY),
      ("한쪽만 되면 방송이고, 양쪽이 되어야 대화입니다 — 받는 방향과 묻는 방향을 모두 만들었고, "
       "각 숫자를 어떻게 쟀는지까지 함께 말씀드립니다.", 12.5, True, C(0xE3,0xE9,0xEF))], spacing=1.4)
footer(s)

# ═══════════════════════════════════════════ 03 문제
s = sld(); header(s, "재난 정보는 농인에게 도착하지 않습니다",
                  "한국수어는 한국어와 어순·문법이 다른 독립 언어입니다")
imgfit(s, "web_왜.png", 6.95, 1.5, 5.75, 3.42)
for i, (v, l) in enumerate([
        ("약 44만 명", "국내 등록 청각장애인 (복지부 2024)"),
        ("69.3%", "일상에서 수어를 주로 사용 — 제1언어 (국립국어원)"),
        ("수어방송 5%", "자막 100% 대비 의무편성 비율")]):
    y = 5.10 + i * 0.60
    rect(s, 6.95, y, 5.75, 0.52, fill=LIGHT)
    rect(s, 6.95, y, 0.045, 0.52, fill=CY)
    text(s, 7.20, y + 0.13, 1.9, 0.3, [(v, 12.5, True, CY_D)])
    text(s, 9.15, y + 0.16, 3.4, 0.3, [(l, 9.5, False, MUT)])
bullet(s, 0.72, 1.62, 5.9, [
    ("재난문자는 한국어 텍스트로만 발송된다",
     "농인에게는 외국어로 온 경고문과 같다. 문해력의 문제가 아니라 언어가 다른 것이다."),
    ("수어 통역은 사람이 실시간으로 붙어야 한다",
     "재난은 예고 없이, 동시다발로, 전국에서 일어난다. 통역사 배치로는 감당할 수 없다."),
    ("농인은 정보를 '받기만' 해 왔다",
     "대피소가 어디냐고 되물을 방법이 없다. 들리는 사람이 3초에 끝내는 일이다."),
])
rect(s, 0.72, 5.05, 5.9, 1.42, fill=C(0xFF,0xF6,0xE8))
rect(s, 0.72, 5.05, 0.05, 1.42, fill=AMB)
text(s, 1.0, 5.28, 5.4, 1.0,
     [("우리가 푸는 문제", 12, True, AMB),
      ("양방향이어야 한다. 한쪽만 되면 방송이고,\n양쪽이 되어야 대화다.", 14.5, True, INK)], spacing=1.3)
footer(s)

# ═══════════════════════════════════════════ 04 시스템 개요
s = sld(); header(s, "시스템 개요", "서버 없이 브라우저 안에서 두 방향이 모두 동작합니다")
rect(s, 0.72, 1.55, 11.9, 2.35, fill=LIGHT)
flow = [("재난문자\n· 직원 음성", 0.0), ("글로스 변환\n(3단 폴백)", 2.42), ("3D 아바타\n수어 재생", 4.84)]
for label, dx in flow:
    x = 1.05 + dx
    rect(s, x, 1.85, 2.05, 0.95, fill=CY)
    text(s, x, 2.02, 2.05, 0.7, [(label, 12.5, True, WHITE)], align=PP_ALIGN.CENTER, spacing=1.2)
flow2 = [("웹캠 수어\n랜드마크", 0.0), ("낱말 인식\n13,576종", 2.42), ("한국어 문장\n· 음성 출력", 4.84)]
for label, dx in flow2:
    x = 1.05 + dx
    rect(s, x, 2.92, 2.05, 0.95, fill=C(0x2C,0x7A,0x86))
    text(s, x, 3.09, 2.05, 0.7, [(label, 12.5, True, WHITE)], align=PP_ALIGN.CENTER, spacing=1.2)
text(s, 8.05, 1.95, 4.3, 1.9,
     [("출력  한국어 → 수어", 12.5, True, CY_D),
      ("입력  수어 → 한국어·음성", 12.5, True, C(0x2C,0x7A,0x86)),
      ("", 6, False, MUT),
      ("두 방향을 같은 특징 정의(155차원)로\n묶어, 학습과 추론이 어긋나지 않게 했다.", 11, False, MUT)], spacing=1.5)
for i, (v, l, n) in enumerate([
        ("12,833", "수어 동작", "실제 농인 수어자 영상"),
        ("13,576", "인식 낱말", "수어자 분리 학습"),
        ("28,125", "전국 장소", "대피소 14,134곳"),
        ("0", "서버", "전부 브라우저 안에서")]):
    stat(s, 0.72 + i * 3.05, 4.28, 2.85, v, l, n)
rect(s, 0.72, 6.08, 11.9, 0.72, fill=C(0xEC,0xF7,0xF9))
rect(s, 0.72, 6.08, 0.05, 0.72, fill=CY)
text(s, 1.02, 6.24, 11.3, 0.45,
     [("두 방향 모두 서버 없이 브라우저 안에서 동작합니다 — 통신이 끊긴 재난 현장에서도 그대로 쓸 수 있습니다.", 12, True, INK)])
footer(s, "수치는 저장소의 검사 스크립트가 재계산합니다")

# ═══════════════════════════════════════════ 05 4-에이전트
s = sld(); header(s, "4개의 에이전트가 이어서 일합니다", "각 단계의 결과를 기록해, 조용한 실패를 검사로 잡아냅니다")
imgfit(s, "web_에이전트.png", 0.72, 1.5, 6.3, 3.75)
agents = [("① 재난 판단", "문자에서 재난 종류·심각도·지역을 뽑는다"),
          ("② 수어 변환", "한국어 문장을 글로스 열로 — 3단 폴백"),
          ("③ 질의응답", "농인의 질문을 의도로 바꾸고 답을 만든다"),
          ("④ 송출", "글로스를 키포인트로 이어 아바타를 움직인다")]
for i, (t, d) in enumerate(agents):
    y = 1.55 + i * 1.0
    rect(s, 7.35, y, 5.28, 0.86, fill=LIGHT)
    rect(s, 7.35, y, 0.05, 0.86, fill=CY)
    text(s, 7.62, y + 0.13, 4.9, 0.3, [(t, 13.5, True, CY_D)])
    text(s, 7.62, y + 0.46, 4.9, 0.3, [(d, 10.5, False, MUT)])
text(s, 0.72, 5.42, 6.3, 0.3, [("② 수어 변환의 3단 폴백 — 앞이 못 하면 뒤가 받는다", 11.5, True, INK)])
fb = [("① 학습 모델", "t2gs-v2 · 재난문자", CY),
      ("② 통계 사전", "Dice 정렬 · 23만 낱말", CY_D),
      ("③ 규칙", "조사·어미 처리", C(0x8A,0x97,0xA4))]
for i, (t, d, col) in enumerate(fb):
    x = 0.72 + i * 2.20
    rect(s, x, 5.80, 1.90, 0.92, fill=col)
    text(s, x, 5.94, 1.90, 0.3, [(t, 11.5, True, WHITE)], align=PP_ALIGN.CENTER)
    text(s, x, 6.26, 1.90, 0.3, [(d, 9, False, C(0xE8,0xEF,0xF3))], align=PP_ALIGN.CENTER)
    if i < 2:
        text(s, x + 1.90, 6.06, 0.30, 0.3, [("→", 13, True, MUT)], align=PP_ALIGN.CENTER)
rect(s, 7.35, 5.42, 5.28, 1.30, fill=C(0xFF,0xF6,0xE8))
rect(s, 7.35, 5.42, 0.045, 1.30, fill=AMB)
text(s, 7.62, 5.60, 4.85, 1.0,
     [("모델이 조용히 빠져도 화면은 똑같습니다.", 11.5, True, INK),
      ("그래서 어느 단계가 답했는지를 화면 속성으로 남기고,\n자동 검사가 이를 확인합니다.", 10.3, False, MUT)], spacing=1.3)
footer(s)

# ═══════════════════════════════════════════ 06 한국어 → 수어
s = sld(); header(s, "핵심기술 ① 한국어를 수어로", "문장 → 글로스 열 → 실제 수어자의 키포인트를 이어 재생")
imgfit(s, "app_받기.png", 0.72, 1.42, 2.27, 4.86)
caption(s, 0.72, 6.36, 2.27, "받기 화면 — 재난문자가 수어로")
bullet(s, 3.40, 1.55, 4.70, [
    ("학습 모델 t2gs-v2", "한국어 음절 → 글로스 seq2seq. 23.3M 파라미터를 int8 30MB로 줄여 브라우저에 넣었다."),
    ("통계 정렬 사전 23만 낱말", "어떤 한국어 낱말이 어떤 글로스와 함께 나오는지 Dice 계수로 세어 만들었다. 활용형·조사형 포함."),
    ("동작 사전 12,833종", "AI Hub 수어 영상의 실제 농인 수어자 키포인트. 사람이 그린 애니메이션이 아니다."),
])
rect(s, 3.40, 4.05, 4.70, 2.30, fill=LIGHT)
rect(s, 3.40, 4.05, 0.045, 2.30, fill=CY)
text(s, 3.68, 4.24, 4.2, 1.9,
     [("지금 앱에 붙어 있는 것", 12, True, CY_D),
      ("t2gs-v2를 int8로 줄인 30MB 모델이 브라우저 안에서 돕니다.\n1스레드에서 문장당 144ms — 서버로 보내지 않습니다.", 10.5, False, INK),
      ("", 5, False, MUT),
      ("줄인 뒤에도 품질이 무너지지 않았는지 따로 쟀습니다.\n검증 400문장에서 BLEU 27.3 · 글로스 F1 62.6.", 10.5, False, INK)], spacing=1.32)
rect(s, 8.45, 1.60, 4.18, 2.35, fill=C(0xFF,0xF6,0xE8))
text(s, 8.72, 1.82, 3.7, 1.9,
     [("행동요령은 모델을 쓰지 않습니다", 12.5, True, AMB),
      ("모델은 공지 말투로 배웠고 행동요령은 명령 말투다.\n맡겨 보니 “엘리베이터를 타지 말고 계단으로\n대피하세요”가 엉뚱한 글로스로 나갔다.", 10.5, False, INK),
      ("목숨이 걸린 안내라 도메인으로 분기했다.", 10.5, True, INK)], spacing=1.28)
imgfit(s, "chart_번역.png", 8.45, 4.02, 4.18, 2.35, border=False)
caption(s, 8.45, 6.42, 4.18, "번역 품질 — 사람 번역가 정답과 비교")
footer(s)

# ═══════════════════════════════════════════ 07 수어 → 한국어
s = sld(); header(s, "핵심기술 ② 수어를 한국어와 음성으로", "웹캠 → 관절 좌표 → 낱말 인식 → 문장 → 음성. 영상은 기기 밖으로 나가지 않습니다")
imgfit(s, "web_인식.png", 0.72, 1.5, 6.55, 4.09)
steps = [("① 랜드마크 추출", "MediaPipe로 상반신·양손 관절 좌표"),
         ("② 155차원 특징", "어깨 기준 정규화 — 학습·추론이 같은 정의"),
         ("③ 트랜스포머 분류", "2.8M 파라미터 · ONNX int8 · 브라우저 추론"),
         ("④ 문장·음성", "낱말을 잇고 규칙으로 한국어 문장을 만든다")]
for i, (t, d) in enumerate(steps):
    y = 1.55 + i * 1.02
    rect(s, 7.6, y, 5.03, 0.88, fill=LIGHT)
    text(s, 7.85, y + 0.13, 4.6, 0.3, [(t, 13, True, CY_D)])
    text(s, 7.85, y + 0.47, 4.6, 0.3, [(d, 10.5, False, MUT)])
rect(s, 0.72, 5.82, 11.9, 1.0, fill=C(0xEC,0xF7,0xF9))
rect(s, 0.72, 5.82, 0.05, 1.0, fill=CY)
text(s, 1.0, 6.00, 11.4, 0.7,
     [("가장 찾기 어려운 실패 — 학습 특징과 추론 특징이 어긋나면 “검증 정확도 95%인데 웹캠에선 0%”가 됩니다.", 12, True, INK),
      ("파이썬 학습 코드와 브라우저 추론 코드의 수치를 대조하는 검사를 두어 현재 오차 0을 유지합니다.", 11, False, MUT)], spacing=1.3)
footer(s)

# ═══════════════════════════════════════════ 08 데이터
s = sld(); header(s, "학습 데이터", "AI Hub 수어 말뭉치 — 원본을 직접 열어 확인하며 가공했습니다")
imgfit(s, "chart_규모.png", 0.72, 1.45, 6.1, 3.30, border=False)
text(s, 7.15, 1.55, 5.48, 0.35, [("실데이터에서 확인한 함정", 14, True, INK)])
traps = [("확장자가 .zip인데 실제로는 7z", "매직 바이트로 판별. 통짜 압축이라 한 번만 훑으며 처리"),
         ("메타가 중첩되어 있음", "signer가 최상위에 없다 — 못 찾으면 수어자 분리가 무력화"),
         ("파일명 표기가 문서와 다름", "가이드 FINSP · 실데이터 FS — 0건인데 오류도 안 난다"),
         ("좌표 단위가 제각각", "mm·m·픽셀 혼재. 절대 임계값 대신 중앙값 기준으로 판정"),
         ("깊이 추정 실패 프레임", "-25,000,000 같은 값 혼입 — 정제 없이는 학습이 망가진다")]
for i, (t, d) in enumerate(traps):
    y = 2.05 + i * 0.92
    rect(s, 7.15, y, 5.48, 0.8, fill=LIGHT)
    text(s, 7.4, y + 0.11, 5.0, 0.28, [(t, 11.5, True, INK)])
    text(s, 7.4, y + 0.42, 5.0, 0.28, [(d, 9.8, False, MUT)])
rect(s, 0.72, 5.15, 6.1, 1.62, fill=C(0xEC,0xF7,0xF9))
text(s, 1.0, 5.36, 5.6, 1.3,
     [("평가는 수어자 분리로", 12.5, True, CY_D),
      ("같은 사람이 학습과 평가에 함께 있으면 모델이 그 사람의\n버릇을 외워 정확도가 부풀어 오릅니다. 발표하는 숫자는\n모두 수어자 단위로 완전히 분리해서 잰 값입니다.", 10.8, False, INK)], spacing=1.3)
footer(s)

# ═══════════════════════════════════════════ 09 인식 정확도
s = sld(); header(s, "검증 ① 수어 낱말 인식 정확도", "처음 보는 수어자에서도 검증치와 같은 성능이 나왔습니다")
imgfit(s, "chart_정확도.png", 0.72, 1.45, 6.4, 3.45, border=False)
for i, (v, l, n) in enumerate([
        ("13,576", "인식 클래스", "이전 판 8,147 → 1.7배 어려운 문제"),
        ("49,721", "미지 수어자 표본", "학습에 없던 13명"),
        ("0", "특징 정의 오차", "파이썬 학습 ↔ 브라우저 추론")]):
    stat(s, 7.45, 1.55 + i * 1.78, 5.18, v, l, n)
rect(s, 0.72, 5.35, 6.4, 1.45, fill=C(0xEC,0xF7,0xF9))
text(s, 1.0, 5.56, 5.9, 1.1,
     [("왜 78%가 낮은 수치가 아닌가", 12, True, CY_D),
      ("13,576개 중에서 하나를 고르는 문제입니다. 그리고 학습에\n없던 사람에게서도 같은 값이 나왔습니다 — 외운 것이 아니라\n일반화되었다는 뜻입니다.", 10.8, False, INK)], spacing=1.3)
footer(s)

# ═══════════════════════════════════════════ 10 번역 품질
s = sld(); header(s, "검증 ② 번역 품질", "표현률은 “나갔는가”만 잽니다 — 맞게 나갔는지는 따로 쟀습니다")
imgfit(s, "chart_표현률.png", 0.72, 1.45, 6.25, 3.35, border=False)
text(s, 7.3, 1.55, 5.33, 0.35, [("표현률만으로는 부족합니다", 14, True, INK)])
rect(s, 7.3, 2.02, 5.33, 1.55, fill=C(0xFF,0xF1,0xF1))
text(s, 7.55, 2.20, 4.85, 1.2,
     [("복합어 처리 버그로", 10.5, False, MUT),
      ("“어디가 아프신지” → 어디 아프다 신다(신발)", 11.5, True, C(0xB0,0x39,0x39)),
      ("로 번역되던 동안에도 표현률은 그대로였습니다.\n잘못된 수어는 표현되지 않은 것보다 나쁩니다 —\n농인은 그것을 믿기 때문입니다.", 10.3, False, INK)], spacing=1.28)
for i, (v, l, n) in enumerate([("137", "오역 회귀 사례", "한 번이라도 틀렸던 문장을 박아 두었다"),
                               ("2,388", "재생 확인 글로스", "번역이 낸 글로스가 실제로 재생되는가")]):
    stat(s, 7.3, 3.78 + i * 1.60, 5.33, v, l, n, h=1.48)
rect(s, 0.72, 5.05, 6.25, 1.72, fill=C(0xEC,0xF7,0xF9))
text(s, 1.0, 5.26, 5.75, 1.4,
     [("튜닝에 쓴 문장으로 재지 않습니다", 12.5, True, CY_D),
      ("사전을 고칠 때는 튜닝 집합만 보고, 홀드아웃은 결과 확인에만 씁니다.\n"
       "홀드아웃을 보고 고치기 시작하면 그 순간 홀드아웃이 아니기 때문입니다.\n"
       "창구 대화 홀드아웃 94.8% — 이 숫자가 일반화를 재는 정직한 값입니다.", 10.6, False, INK)], spacing=1.32)
footer(s)

# ═══════════════════════════════════════════ 11 자동 검증
s = sld(); header(s, "검증 ③ 자동 검증 체계", "이 앱의 실패는 대부분 “화면은 정상인데 알맹이가 없는” 모양입니다")
imgfit(s, "chart_검증.png", 0.72, 1.45, 6.25, 3.20, border=False)
text(s, 7.3, 1.55, 5.33, 0.35, [("눈으로는 잡히지 않는 실패들", 14, True, INK)])
cases = [("아바타가 조용히 서 있음", "글로스가 사전에 없으면 오류 없이 건너뛴다.\n한국어 자막은 그대로 떠 있어 정상으로 보인다."),
         ("부정이 사라짐", "“약을 안 먹었어요” → 약 먹다.\n한 글자라 “너무 짧다”는 규칙에 걸려 버려졌다."),
         ("방향이 뒤집힘", "“북동쪽”이 “km 지진 크기”로 번역됐다.\n화살표도 그려지고 숫자도 떠서 화면은 멀쩡했다.")]
for i, (t, d) in enumerate(cases):
    y = 2.05 + i * 1.35
    rect(s, 7.3, y, 5.33, 1.2, fill=LIGHT)
    rect(s, 7.3, y, 0.05, 1.2, fill=AMB)
    text(s, 7.58, y + 0.14, 4.85, 0.3, [(t, 12, True, INK)])
    text(s, 7.58, y + 0.48, 4.85, 0.6, [(d, 10.2, False, MUT)], spacing=1.25)
rect(s, 0.72, 5.15, 6.25, 1.62, fill=C(0xEC,0xF7,0xF9))
text(s, 1.0, 5.36, 5.75, 1.3,
     [("전 항목 통과 · 매 변경마다 실행", 12.5, True, CY_D),
      ("폰·태블릿(가로/세로)·키오스크·오프라인에서 실제로 눌러 보고,\n번역이 낸 글로스가 실제로 재생되는지까지 확인합니다.\n숫자가 아니라 동작으로 확인합니다.", 10.8, False, INK)], spacing=1.3)
footer(s)

# ═══════════════════════════════════════════ 12 앱 화면
s = sld(); header(s, "당사자 화면 — 네 개의 탭", "농인이 실제로 쓰는 화면입니다")
tabs = [("web_app_받기.png", "받기", "재난문자가 수어로 나온다", 0.72, 1.45),
        ("web_app_묻기.png", "묻기", "수어로 묻고 수어로 답받는다", 6.72, 1.45),
        ("web_app_대화.png", "대화", "창구 — 직원 말 ↔ 농인 답", 0.72, 4.28),
        ("web_app_사전.png", "사전", "낱말을 찾아 수어 확인", 6.72, 4.28)]
for f, t, d, x, y in tabs:
    imgfit(s, f, x, y, 5.9, 2.35)
    text(s, x, y + 2.42, 1.0, 0.3, [(t, 14, True, CY_D)])
    text(s, x + 0.95, y + 2.45, 4.9, 0.3, [(d, 10.5, False, MUT)])
footer(s, "키오스크 모드 · 오프라인 · PWA 설치 지원")

# ═══════════════════════════════════════════ 13 묻기 + 오프라인
s = sld(); header(s, "농인이 ‘묻는’ 쪽이 됩니다", "통신이 끊긴 상태에서도 위치 기반으로 답합니다")
imgfit(s, "web_app_묻기.png", 0.72, 1.45, 7.0, 2.79)
caption(s, 0.72, 4.30, 7.0, "묻기 화면 — 방향 · 거리 · 걸리는 시간 · 방향 지도 · 아바타 수어 응답")
bullet(s, 0.72, 4.78, 7.0, [
    ("의도 판정 · 방향과 거리 계산",
     "낱말 묶음을 의도로 바꾸고, 지구 곡률을 반영해 거리와 여덟 방위를 계산해 어림수 수어로 답한다."),
    ("타일 없는 지도",
     "지도 이미지를 내려받지 않고 직접 그린다. 그래서 오프라인에서도 방향을 보여 준다."),
])
rect(s, 7.95, 1.45, 4.68, 2.05, fill=BG_D)
text(s, 8.25, 1.66, 4.1, 1.7,
     [("비행기 모드에서도 답합니다", 13, True, CY),
      ("인식 모델·동작 사전·장소 목록을 모두\n기기에 저장해 둡니다.", 10.5, False, C(0xC5,0xCE,0xD8)),
      ("재난이 나면 통신이 먼저 끊깁니다.\n재난 때가 곧 오프라인입니다.", 11, True, WHITE)], spacing=1.3)
for i, (v, l, n) in enumerate([("28,125", "전국 장소", "대피소 14,134 · 병원 5,992"),
                               ("0", "지도 서버 요청", "SVG로 직접 그린다")]):
    stat(s, 7.95, 3.66 + i * 1.5, 4.68, v, l, n, h=1.36)
footer(s, "장소 목록은 OSM 기반 참고용 — 공공데이터 인증키로 공식 목록 교체 예정")

# ═══════════════════════════════════════════ KOREN 활용
s = sld(); header(s, "KOREN 자원을 셋으로 나눠 씁니다",
                  "성격이 다른 세 자원이라 하나로 다 하려 하면 어느 쪽도 제대로 안 됩니다")
res = [("① AI Cloud (CHEETAH)", "학습 전용", CY,
        "NVIDIA H200 MIG 1g.35GB · vCPU 16 · RAM 128Gi",
        "AI Hub 실데이터 133GB 수신, 무해제 스트리밍 ETL로 40만 클립 가공.\n"
        "인식·번역 모델 학습과 평가 — 에폭당 21~25분에 215만 세그먼트 처리."),
       ("② HPC 이노베이션 허브", "CPU 전처리", CY_D,
        "Xeon Gold VM 여러 대 · PBS Torque 스케줄러",
        "영상 → 랜드마크 변환은 클립마다 독립이라 나누기 쉽습니다.\n"
        "샤딩 옵션과 잡 스크립트를 준비했고, 8월 4주 VM 4대로 분산 변환합니다."),
       ("③ KOREN VM", "상시 서버", C(0x2C,0x7A,0x86),
        "24시간 가동 · NOC 발급 SSH",
        "9월부터 정적 사이트와 번역 API를 상시 운영합니다.\n"
        "심사·시연에서 언제든 열리는 고정 주소를 둡니다.")]
for i, (t, role, col, spec, done) in enumerate(res):
    y = 1.42 + i * 1.62
    rect(s, 0.72, y, 6.35, 1.5, fill=LIGHT)
    rect(s, 0.72, y, 0.05, 1.5, fill=col)
    text(s, 1.02, y + 0.14, 3.5, 0.3, [(t, 13, True, INK)])
    rect(s, 4.72, y + 0.15, 1.25, 0.30, fill=col)
    text(s, 4.72, y + 0.19, 1.25, 0.26, [(role, 9.5, True, WHITE)], align=PP_ALIGN.CENTER)
    text(s, 1.02, y + 0.50, 5.8, 0.28, [(spec, 9.5, False, CY_D)])
    text(s, 1.02, y + 0.80, 5.8, 0.6, [(done, 10.2, False, MUT)], spacing=1.25)
rect(s, 0.72, 6.32, 6.35, 0.62, fill=C(0xFF,0xF6,0xE8))
rect(s, 0.72, 6.32, 0.05, 0.62, fill=AMB)
text(s, 1.02, 6.46, 5.9, 0.4,
     [("MIG는 메모리는 넉넉하고 연산이 부족합니다 — 영상 CNN 대신 랜드마크 트랜스포머를 골랐습니다.", 10, True, INK)])
text(s, 7.42, 1.42, 5.21, 0.32, [("이용 내역", 13.5, True, INK)])
log = [("8월 5일", "HPC 이노베이션 허브", "활용 교육 · PBS 분산 작업 구성 습득"),
       ("8월 7일", "KOREN AI Cloud", "활용 교육 · GPU 워크스페이스·볼륨 운영"),
       ("8월 2주", "KOREN AI Cloud", "워크스페이스 구축, 회선·AI Hub 접속 점검"),
       ("8월 2~3주", "KOREN AI Cloud", "실데이터 133GB 수신 · 40만 클립 ETL"),
       ("8월 3주", "KOREN AI Cloud", "인식·번역 학습 · 수어자 분리 교차평가 · ONNX"),
       ("8월 4주", "HPC (예정)", "다각도 48,000클립 분산 변환 — VM 4대"),
       ("9월", "KOREN VM (예정)", "상시 데모 서버 운영"),
       ("10월", "KOREN 실회선·POP (예정)", "다지점 송출 종단 지연 실측 · 현장 시연")]
for i, (d, place, what) in enumerate(log):
    y = 1.86 + i * 0.50
    done = i < 5
    col = CY if done else C(0xA9,0xB4,0xBF)
    rect(s, 7.42, y + 0.10, 0.07, 0.07, fill=col, shape=MSO_SHAPE.OVAL)
    text(s, 7.62, y, 1.05, 0.28, [(d, 9.8, True, INK if done else MUT)])
    text(s, 8.72, y, 1.55, 0.28, [(place, 9.8, True, col)])
    text(s, 10.32, y, 2.31, 0.28, [(what, 9.3, False, MUT)])
rect(s, 7.42, 5.95, 5.21, 0.99, fill=BG_D)
text(s, 7.70, 6.10, 4.75, 0.75,
     [("왜 KOREN에 맞는 과제인가", 10.5, True, CY),
      ("영상 대신 관절좌표를 보냅니다 — 문장당 약 2.4KB, 영상의 1/2,000.\n"
       "10월 실회선 POP에서 다지점 송출 종단 지연을 실측합니다.", 10, False, C(0xD5,0xDD,0xE5))], spacing=1.3)
footer(s, "심사항목 · KOREN 활용도 20점")

# ═══════════════════════════════════════════ 14 현장 방문 (건물 + 개요)
s = sld(); header(s, "현장 방문 — 두 곳의 복지관에서 직접 확인했습니다",
                  "수어 이용자에게 시연하고, 개선점과 피드백을 받았습니다")
# 건물 사진 두 장
photo_slot(s, 0.72, 1.5, 3.35, 2.25, "경산시장애인종합복지관", 8)
photo_slot(s, 4.32, 1.5, 3.35, 2.25, "대구광역시청각언어장애인복지관", 9)
rect(s, 8.05, 1.5, 4.58, 2.25, fill=BG_D)
text(s, 8.35, 1.72, 4.0, 1.9,
     [("왜 현장에 갔는가", 13, True, CY),
      ("표현률과 BLEU는 “낱말이 나갔는가 / 맞게 나갔는가”\n까지만 잽니다. 농인이 보고 뜻이 통하는지는\n다른 질문입니다.", 10.5, False, C(0xC5,0xCE,0xD8)),
      ("실험실 숫자만으로는 알 수 없는 것을\n사용자에게 직접 물었습니다.", 11, True, WHITE)], spacing=1.3)
# 현장 사진 3장
photo_slot(s, 0.72, 4.28, 3.85, 2.05, "수어 이용자에게 직접 시연", 1)
photo_slot(s, 4.82, 4.28, 3.85, 2.05, "질의응답 화면 확인", 2)
photo_slot(s, 8.92, 4.28, 3.71, 2.05, "함께 조작하며 관찰", 3)
footer(s, "2026년 8월 · 경산 · 대구")

# ═══════════════════════════════════════════ 15 시연과 피드백 (사진 4)
s = sld(); header(s, "실제 이용을 돕고, 개선점을 받았습니다",
                  "아바타 수어를 함께 보며 무엇이 읽히고 무엇이 안 읽히는지 확인했습니다")
photo_slot(s, 0.72, 1.5, 2.85, 1.95, "아바타 수어 확인", 4)
photo_slot(s, 3.77, 1.5, 2.85, 1.95, "화면 조작 안내", 5)
photo_slot(s, 6.82, 1.5, 2.85, 1.95, "에이전트 구조 설명", 7)
photo_slot(s, 9.87, 1.5, 2.76, 1.95, "기대효과 공유", 6)
text(s, 0.72, 3.92, 11.9, 0.35, [("현장에서 확인한 것", 15, True, INK)])
found = [("아바타를 보는 거리와 각도", "노트북 화면으로 보면 손이 작아진다. 화면 크기와 앉는 거리에 따라 읽히는 정도가 달라졌다."),
         ("연령대에 따른 수어 차이", "같은 뜻이라도 세대·지역에 따라 쓰는 동작이 다르다. 사전이 한 가지만 알면 못 알아본다."),
         ("‘눌러서 묻기’의 필요", "수어를 쓰지 않는 중도 실청 이용자도 있었다. 눌러서 묻는 경로가 실제로 필요했다."),
         ("다음에 물어야 할 것", "어순의 자연스러움과 표정의 부재를 어떻게 느끼는지 — 9월 정식 평가에서 측정한다.")]
for i2, (t, d) in enumerate(found):
    x = 0.72 + (i2 % 2) * 6.05
    y = 4.32 + (i2 // 2) * 1.18
    rect(s, x, y, 5.85, 1.05, fill=LIGHT)
    rect(s, x, y, 0.045, 1.05, fill=CY)
    text(s, x + 0.28, y + 0.13, 5.35, 0.3, [(t, 12, True, INK)])
    text(s, x + 0.28, y + 0.45, 5.35, 0.55, [(d, 10, False, MUT)], spacing=1.22)
footer(s, "9월 정식 당사자 평가로 이어집니다")

# ═══════════════════════════════════════════ 16 한계
s = sld(); header(s, "아직 안 되는 것 — 먼저 말합니다",
                  "숨기면 질문 한 번에 무너집니다. 무엇이 있으면 풀리는지까지 적었습니다")
limits = [("이어서 하는 수어", "학습 완료 · 미적용",
           "연속 인식 모델(CTC)은 검증 오류율 0.218까지 학습을 마쳤습니다. 그런데 붙이지 않았습니다.\n"
           "클래스가 8,147개라 배포본 13,576개와 집합이 달라, 교체하면 ‘화장실’이 사라집니다.\n"
           "농인이 화장실을 물어도 영영 못 알아듣게 되는데 오류도 경고도 나지 않습니다.", AMB),
          ("지문자 (이름·지명)", "데이터 확보 · 학습 대기",
           "이름과 지명에는 수어 단어가 없어 자모를 하나씩 씁니다. 지금은 낱말 카드로 정보 손실만 막았습니다.\n"
           "‘공개 데이터가 없다’고 알았으나 실은 있었습니다 — 파일명 갈래가 문서와 달라 0건으로 걸렸습니다.\n"
           "클립 17,000개 · 지명 1,015종 · 자모 37종을 확인했고, 키포인트만 받으면 학습할 수 있습니다.", CY),
          ("표정 (비수지 신호)", "지어내지 않기로",
           "수어에서 표정은 문법입니다. 판정 의문문과 설명 의문문은 눈썹 방향이 반대입니다.\n"
           "원본에 8채널이 시간 구간까지 있지만 ‘어떻게 움직였는지’는 마우징을 빼면 비어 있습니다.\n"
           "뜻이 분명한 고개 끄덕임·흔들기와 마우징만 쓰고, 눈썹 방향은 규칙으로 지어내지 않습니다.", MUT)]
for i, (t, state, d, col) in enumerate(limits):
    y = 1.5 + i * 1.72
    rect(s, 0.72, y, 11.9, 1.55, fill=LIGHT)
    rect(s, 0.72, y, 0.05, 1.55, fill=col)
    text(s, 1.05, y + 0.16, 4.2, 0.32, [(t, 15, True, INK)])
    rect(s, 4.55, y + 0.18, 1.85, 0.32, fill=col)
    text(s, 4.55, y + 0.22, 1.85, 0.26, [(state, 9.5, True, WHITE)], align=PP_ALIGN.CENTER)
    text(s, 1.05, y + 0.58, 11.3, 0.9, [(d, 10.5, False, INK)], spacing=1.28)
footer(s, "모두 재어 보고 내린 판단입니다")

# ═══════════════════════════════════════════ 17 다음 단계
s = sld(); header(s, "다음 단계", "중간평가 이후 최종까지")
phases = [("9월", "농인 당사자 평가",
           ["농아인협회·복지관 정식 평가", "자연스러움·전달률 측정", "연속 수어 표본 수집"], CY),
          ("9~10월", "인식 확장",
           ["연속 수어 모델 병행 적용 판단", "지문자 자모 CTC 학습", "고개 동작·마우징 반영"], CY_D),
          ("10월", "데이터 공식화",
           ["행정안전부 공식 대피소 목록", "행정구역 이름표로 오역 제거", "고정 주소 배포"], C(0x2C,0x7A,0x86))]
for i, (when, t, items, col) in enumerate(phases):
    x = 0.72 + i * 4.06
    rect(s, x, 1.55, 3.85, 4.2, fill=LIGHT)
    rect(s, x, 1.55, 3.85, 0.05, fill=col)
    rect(s, x + 0.25, 1.85, 1.3, 0.36, fill=col)
    text(s, x + 0.25, 1.90, 1.3, 0.3, [(when, 11.5, True, WHITE)], align=PP_ALIGN.CENTER)
    text(s, x + 0.25, 2.38, 3.35, 0.35, [(t, 15, True, INK)])
    for j, it in enumerate(items):
        yy = 2.92 + j * 0.62
        rect(s, x + 0.25, yy + 0.09, 0.07, 0.07, fill=col, shape=MSO_SHAPE.OVAL)
        text(s, x + 0.45, yy, 3.15, 0.55, [(it, 11, False, INK)], spacing=1.2)
rect(s, 0.72, 6.02, 11.9, 0.85, fill=C(0xEC,0xF7,0xF9))
text(s, 1.02, 6.20, 11.3, 0.6,
     [("우선순위는 ‘정확도’가 아니라 ‘틀렸을 때의 피해’로 정합니다. "
       "잘못된 수어는 표현되지 않은 것보다 나쁩니다 — 농인은 그것을 믿기 때문입니다.", 12, True, INK)],
     align=PP_ALIGN.CENTER)
footer(s)

# ═══════════════════════════════════════════ 18 기대효과
s = sld(); header(s, "기대효과", "재난 상황의 정보 접근권을 기술로 메웁니다")
imgfit(s, "web_기대효과.png", 0.72, 1.5, 6.0, 3.75)
eff = [("즉시성", "통역사 배치를 기다리지 않는다. 문자가 오는 즉시 수어로 바뀐다."),
       ("동시성", "전국에서 동시에 일어나도 사람 수에 제약받지 않는다."),
       ("가용성", "통신이 끊긴 재난 현장에서도 기기 안에서 동작한다."),
       ("양방향", "농인이 정보를 받기만 하는 것이 아니라 되물을 수 있다.")]
for i, (t, d) in enumerate(eff):
    y = 1.55 + i * 0.98
    rect(s, 7.05, y, 5.58, 0.84, fill=LIGHT)
    text(s, 7.32, y + 0.12, 5.0, 0.3, [(t, 13, True, CY_D)])
    text(s, 7.32, y + 0.45, 5.0, 0.3, [(d, 10.3, False, MUT)])
rect(s, 0.72, 5.55, 11.9, 1.25, fill=BG_D)
text(s, 1.02, 5.78, 11.3, 0.85,
     [("확장 가능성", 11.5, True, CY),
      ("같은 구조로 병원·주민센터 창구, 공공 키오스크, 교육 현장에 적용할 수 있습니다. "
       "서버가 필요 없어 기관마다 별도 인프라 없이 배포됩니다.", 11.5, False, C(0xD5,0xDD,0xE5))], spacing=1.35)
footer(s)

# ═══════════════════════════════════════════ 19 마무리
s = sld()
rect(s, 0, 0, W, H, fill=BG_D)
rect(s, 0, 0, 0.22, H, fill=CY)
text(s, 1.3, 2.35, 11, 1.6,
     [("한쪽만 되면 방송이고,", 40, True, WHITE),
      ("양쪽이 되어야 대화입니다.", 40, True, CY)], spacing=1.2)
rect(s, 1.3, 4.35, 3.2, 0.035, fill=CY)
for i, (v, l) in enumerate([("78.6%", "처음 보는 수어자 인식"), ("27.1", "번역 BLEU-4"),
                            ("12,833", "실제 수어자 동작 사전"), ("0", "서버")]):
    x = 1.3 + i * 2.75
    text(s, x, 4.75, 2.5, 0.5, [(v, 26, True, CY)])
    text(s, x, 5.32, 2.5, 0.3, [(l, 11, False, C(0x94,0xA0,0xAE))])
text(s, 1.3, 6.25, 11, 0.4, [("감사합니다.", 17, True, C(0xD5,0xDD,0xE5))])

out = Path("ppt/중간평가 발표자료_SignBridge.pptx")
prs.save(str(out))
print(f"저장: {out}  ({out.stat().st_size:,} 바이트 · {len(prs.slides.__iter__.__self__._sldIdLst)}장)")
