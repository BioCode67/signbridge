"""최종보고서_닿다.docx — 사무국 양식(2-1)의 목차·서식을 그대로 따른다.

한글에서 열어 '다른 이름으로 저장 → .hwp'로 바꿔 제출한다.
노란 형광 [ ] 자리는 사람이 채워야 하는 곳이다(저장소에 근거가 없는 정보).
수치는 전부 저장소의 측정 결과(CLAUDE.md · DECISIONS.md · 중간발표)에서 옮겼다.
"""
import sys
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_COLOR_INDEX
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[2]
IMG = Path(__file__).parent / "img"
ASSET = ROOT / "ppt/assets"
PHOTO = ROOT / "ppt/photos"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "final_report/제출본/최종보고서_닿다.docx"

FONT = "휴먼명조"
BODY, BIG = 13, 15

doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
sec.left_margin = sec.right_margin = Cm(2.5)
sec.top_margin, sec.bottom_margin = Cm(2.0), Cm(2.0)

st = doc.styles["Normal"]
st.font.name = FONT
st.font.size = Pt(BODY)
st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
st.paragraph_format.line_spacing = 1.45
st.paragraph_format.space_after = Pt(3)


# ── 도우미 ─────────────────────────────────────────────
def run(p, text, bold=False, size=None, color=None, hl=False):
    r = p.add_run(text)
    r.bold = bold
    r.font.name = FONT
    r._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    if size:
        r.font.size = Pt(size)
    if color:
        r.font.color.rgb = RGBColor.from_string(color)
    if hl:
        r.font.highlight_color = WD_COLOR_INDEX.YELLOW
    return r


def para(text="", bold=False, size=None, align=None, indent=0, after=None, before=None):
    """[[...]] 로 감싼 부분은 노란 형광(사람이 채울 자리)."""
    p = doc.add_paragraph()
    if align == "c":
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    elif align == "r":
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    else:
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    if indent:
        p.paragraph_format.left_indent = Cm(indent)
    if after is not None:
        p.paragraph_format.space_after = Pt(after)
    if before is not None:
        p.paragraph_format.space_before = Pt(before)
    parts = text.split("[[")
    run(p, parts[0], bold, size)
    for part in parts[1:]:
        fill, rest = part.split("]]", 1)
        run(p, f"[{fill}]", bold, size, hl=True)
        run(p, rest, bold, size)
    return p


def bullet(text, level=0, mark="○"):
    marks = {0: mark, 1: "-", 2: "·"}
    p = para(f"{marks[level]} {text}", indent=0.4 + 0.6 * level)
    p.paragraph_format.first_line_indent = Cm(-0.4)
    return p


def shade(cell, hexcolor):
    tcPr = cell._element.get_or_add_tcPr()
    s = OxmlElement("w:shd")
    s.set(qn("w:val"), "clear")
    s.set(qn("w:color"), "auto")
    s.set(qn("w:fill"), hexcolor)
    tcPr.append(s)


def cell_text(cell, text, bold=False, size=11, align="l"):
    cell.text = ""
    lines = text.split("\n")
    for i, ln in enumerate(lines):
        p = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
        p.paragraph_format.line_spacing = 1.2
        p.paragraph_format.space_after = Pt(0)
        p.alignment = {"c": WD_ALIGN_PARAGRAPH.CENTER, "l": WD_ALIGN_PARAGRAPH.LEFT}[align]
        parts = ln.split("[[")
        run(p, parts[0], bold, size)
        for part in parts[1:]:
            fill, rest = part.split("]]", 1)
            run(p, f"[{fill}]", bold, size, hl=True)
            run(p, rest, bold, size)


def table(caption, header, rows, widths=None, size=11):
    cap = para(caption, bold=True, size=11, align="c", before=6, after=2)
    t = doc.add_table(rows=1 + len(rows), cols=len(header))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for j, h in enumerate(header):
        cell_text(t.rows[0].cells[j], h, bold=True, size=size, align="c")
        shade(t.rows[0].cells[j], "D9E2F3")
    for i, r in enumerate(rows, 1):
        for j, v in enumerate(r):
            cell_text(t.rows[i].cells[j], str(v), size=size, align="c" if j == 0 else "l")
    if widths:
        t.autofit = False
        for j, w in enumerate(widths):
            t.columns[j].width = Cm(w)
        for row in t.rows:
            for j, w in enumerate(widths):
                row.cells[j].width = Cm(w)
    para("", after=2)
    return t


def figure(path, caption, width=15.5):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(path), width=Cm(width))
    para(caption, bold=True, size=11, align="c", after=8)


def figure_row(paths, caption, width=3.6):
    t = doc.add_table(rows=1, cols=len(paths))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for j, (pth, sub) in enumerate(paths):
        c = t.rows[0].cells[j]
        p = c.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run().add_picture(str(pth), width=Cm(width))
        q = c.add_paragraph()
        q.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run(q, sub, size=10)
    para(caption, bold=True, size=11, align="c", after=8)


def chapter(num, title):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(8)
    r = run(p, f" {num} ", bold=True, size=BIG, color="FFFFFF")
    rpr = r._element.get_or_add_rPr()
    s = OxmlElement("w:shd")
    s.set(qn("w:val"), "clear")
    s.set(qn("w:fill"), "1F3864")
    rpr.append(s)
    run(p, f"  {title}", bold=True, size=BIG)
    # 밑줄(양식의 가로줄)
    pPr = p._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    b = OxmlElement("w:bottom")
    for k, v in (("val", "single"), ("sz", "8"), ("space", "1"), ("color", "1F3864")):
        b.set(qn(f"w:{k}"), v)
    bdr.append(b)
    pPr.append(bdr)


def h2(text):
    para(text, bold=True, size=BIG - 1, before=10, after=4)


def h3(text):
    para(text, bold=True, size=BODY, indent=0.3, before=6, after=2)


def page_break():
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def page_numbers():
    for s in doc.sections:
        p = s.footer.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run(p, "- ", size=10)
        r = p.add_run()
        for tag, txt in (("begin", None), (None, "PAGE"), ("end", None)):
            if tag:
                e = OxmlElement("w:fldChar")
                e.set(qn("w:fldCharType"), tag)
            else:
                e = OxmlElement("w:instrText")
                e.set(qn("xml:space"), "preserve")
                e.text = txt
            r._r.append(e)
        run(p, " -", size=10)


# ── 표지 ─────────────────────────────────────────────
TITLE = "SignBridge — KOREN 기반 재난정보 한국수어(KSL) 양방향 AI 통역 서비스"
TEAM = "닿다"

t = doc.add_table(rows=1, cols=1)
t.style = "Table Grid"
cell_text(t.rows[0].cells[0], "K-디지털 챌린지 : 넷 챌린지 캠프 시즌13 최종결과보고서", bold=True, size=16, align="c")
shade(t.rows[0].cells[0], "F2F2F2")
para("", after=4)
t = doc.add_table(rows=2, cols=2)
t.style = "Table Grid"
for i, (k, v) in enumerate((("과제제목", TITLE), ("팀    명", TEAM))):
    cell_text(t.rows[i].cells[0], k, bold=True, size=13, align="c")
    shade(t.rows[i].cells[0], "F2F2F2")
    cell_text(t.rows[i].cells[1], v, size=13)
    t.rows[i].cells[0].width, t.rows[i].cells[1].width = Cm(3), Cm(13)
t.autofit = False
t.columns[0].width, t.columns[1].width = Cm(3), Cm(13)
para("", after=6)
para("본 보고서를 K-디지털 챌린지 : 넷 챌린지 캠프 시즌13의 최종결과보고서로 제출합니다.", before=12)
para("2026년  10월  18일", align="r", before=10, after=14)
para("참여 구성원 :  김주형 (영남대학교 [[학과]] [[학위과정]])  ─ 팀장", indent=1.5)
para("류다영 (영남대학교 [[학과]] [[학위과정]])", indent=4.4)
para("", after=40)
para("한국지능정보사회진흥원장 귀하", bold=True, size=18, align="c", before=30, after=30)
para("< 안 내 사 항 >", bold=True, align="c", before=20)
para("1. 본 연구보고서는 한국지능정보사회진흥원의 출연금으로 수행한 K-디지털 챌린지 : 넷 챌린지 캠프 시즌13의 연구망 활용 연구과제 결과입니다.", size=12)
para("2. 본 연구보고서의 내용을 발표할 때에는 반드시 한국지능정보사회진흥원 K-디지털 챌린지 : 넷 챌린지 캠프 시즌13의 연구망 활용 연구과제 결과임을 밝혀야 합니다.", size=12)
page_break()

# ── 요약문 ───────────────────────────────────────────
para("요  약  문", bold=True, size=18, align="c", after=12)
h2("1. 제   목")
para(TITLE, indent=0.5)

h2("2. 아이디어 개발의 목적 및 필요성")
para("국내 등록 청각장애인은 약 44만 명이며, 이 중 다수에게 한국수어는 한국어와 어순·문법이 다른 제1언어이다. "
     "그러나 재난문자와 재난방송은 한국어 텍스트·음성 중심이고, 사람 수어통역은 심야·동시다발 재난에서 즉시 배치될 수 없다. "
     "또한 지금까지 농인은 재난 정보를 '받기만' 했을 뿐, \"가까운 대피소가 어디냐\"고 되물을 수단이 없었다. "
     "본 과제는 재난 정보를 즉시 한국수어로 전달하고, 농인의 수어 질문을 한국어·음성으로 되돌려 답하는 양방향 AI 통역 서비스를 "
     "KOREN 연구망 자원으로 학습·운영하는 것을 목적으로 한다.", indent=0.5)

h2("3. 아이디어 개발의 내용 및 범위")
para("본 과제에서는 AI Hub 실제 농인 수어 말뭉치를 KOREN AI Cloud에서 가공·학습하여, 브라우저 안에서 동작하는 양방향 수어 통역 앱을 개발하였다.", indent=0.5)
bullet("한국어→수어: 재난문자·직원 음성을 글로스(수어 낱말열)로 변환(학습 모델·통계 사전·규칙의 3단 폴백)하고, 실제 수어자 키포인트 12,833종을 이어 3D 아바타로 재생")
bullet("수어→한국어: 웹캠 → MediaPipe 랜드마크 → 155차원 특징 → 트랜스포머 낱말 인식(13,576종) → 의도 판정 → 한국어 문장·음성 출력")
bullet("당사자 화면 4종(받기·묻기·대화·사전), 키오스크 모드, 통신이 끊겨도 동작하는 오프라인(PWA) 구성")
bullet("KOREN 자원 역할 분담: AI Cloud(학습·평가), HPC 이노베이션 허브(CPU 전처리 설계), KOREN VM(상시 데모 서버)")

h2("4. 개 발 결 과")
para("본 과제는 아래 결과를 모두 저장소의 측정 스크립트로 재계산 가능한 수치로 확인하였다.", indent=0.5)
bullet("수어 낱말 인식 iso-v2: 13,576종 중 검증 top-1 78.2%, 학습에 없던 수어자 13명(49,721표본)에서 top-1 78.6% · top-5 91.9%")
bullet("한국어→글로스 학습 모델 t2gs-v2: 글로스 F1 61.3 · BLEU-4 27.1(검증 800문장), int8 30MB로 줄여 브라우저에서 문장당 144ms(1스레드)")
bullet("번역 낱말 표현률: 행동요령·길찾기 100%, 일상회화 96.9%, 재난문자 95.8%, 창구 대화 93.5%(홀드아웃 94.8%)")
bullet("자동 검증: 오역 회귀 사례 156건, 번역 글로스 재생 확인 2,388개 전부, 수어 의도 판정 27/27, 학습↔추론 특징 오차 0")
bullet("전국 장소 28,125곳(대피소 14,134곳) 기반 오프라인 길 안내, 폰·태블릿·키오스크 실조작 자동 검증 통과")
bullet("복지관 2곳 현장 시연(8월) 및 농인 당사자 평가(9~10월) 실시, KOREN VM 상시 데모 서버 운영")

h2("5. 기 대 효 과")
para("본 과제에서 제안한 서비스는 재난 상황의 정보 접근권 공백을 기술로 메운다.", indent=0.5)
bullet("즉시성·동시성: 통역사 배치를 기다리지 않고, 전국 동시다발 재난에도 인력 제약 없이 수어로 전달")
bullet("가용성: 통신이 끊긴 재난 현장에서도 기기 안에서 인식·번역·길 안내가 동작")
bullet("양방향성: 농인이 정보를 받기만 하지 않고 수어로 묻고 답을 받는 첫 단계를 구현")
bullet("확장성: 병원·약국·주민센터 등 공공 창구, 교통·공공안내 방송으로 확장 가능")
page_break()

# ── 목차 ────────────────────────────────────────────
para("목        차", bold=True, size=18, align="c", after=14)
toc = [
    ("Ⅰ. 서 론", 0), ("1. 개발 목적 및 필요성", 1), ("2. 특징(동일·유사 아이디어에 대한 차별성/독창성/혁신성)", 1),
    ("Ⅱ. 아이디어 개발 추진 내용과 범위", 0), ("1. 개발 목표 및 추진 내용", 1),
    ("가. 개발목표   나. 세부 추진내용 및 범위   다. 참여구성원의 역할", 2), ("2. 단계별 세부 구현 계획", 1),
    ("Ⅲ. 아이디어 개발 진행 내용 및 결과", 0), ("1. 개발 수행 현황 및 최종 결과물", 1),
    ("가. 하드웨어 부분   나. 소프트웨어 부분", 2), ("2. KOREN 연동 및 활용 결과", 1),
    ("3. 멘토 의견에 따른 개선사항", 1), ("4. 결과물의 통합 및 시험/검증 결과", 1),
    ("Ⅳ. 결 론", 0), ("1. 개발 최종 결과물", 1), ("2. 기술 구현에 따른 기대 효과", 1),
    ("Ⅴ. 참고문헌", 0), ("별첨  회의록", 0),
]
for text, lv in toc:
    para(text, bold=lv == 0, indent=[0.3, 1.2, 1.8][lv], before=8 if lv == 0 else 0, after=1)
page_break()

FIGS = [
    "그림 1. SignBridge 시스템 구성도",
    "그림 2. 당사자 화면 4종(받기·묻기·대화·사전)",
    "그림 3. KOREN 활용 네트워크 구성도",
    "그림 4. 수어 낱말 인식 정확도(수어자 분리)",
    "그림 5. 4개 에이전트 구조(소개 페이지)",
    "그림 6. 복지관 현장 시연",
]
TABS = [
    "표 1. 기존 방식·유사 서비스 대비 차별성",
    "표 2. 세부 추진 내용 및 범위",
    "표 3. 참여구성원의 역할",
    "표 4. 단계별 세부 구현 계획과 진행 결과",
    "표 5. 학습 모델과 성능",
    "표 6. KOREN 자원별 활용 결과",
    "표 7. 멘토 의견에 따른 개선사항",
    "표 8. 도메인별 번역 낱말 표현률",
    "표 9. 자동 시험·검증 항목과 결과",
]
para("그 림  목 차", bold=True, size=16, align="c", after=10)
for f_ in FIGS:
    para(f_, indent=0.8, after=1)
para("", after=20)
para("표  목 차", bold=True, size=16, align="c", after=10)
for t_ in TABS:
    para(t_, indent=0.8, after=1)
page_break()

# ── Ⅰ 서론 ──────────────────────────────────────────
chapter("Ⅰ", "서 론")
h2("1. 개발 목적 및 필요성")
h3("가. 재난 정보는 농인에게 도착하지 않는다")
para("국내 등록 청각장애인은 약 44만 명(보건복지부, 2024)이며, 2016년 「한국수화언어법」으로 한국수어는 국어와 동등한 공용어로 인정되었다. "
     "한국수어는 한국어를 손으로 옮긴 것이 아니라 어순과 문법이 다른 독립 언어이다. 따라서 한국어 텍스트로만 발송되는 재난문자는 "
     "많은 농인에게 '외국어로 온 경고문'과 같다. 이는 문해력의 문제가 아니라 언어가 다른 문제이다.")
para("수어 통역은 사람이 실시간으로 붙어야 하지만, 재난은 예고 없이 심야에, 동시다발적으로, 전국에서 일어난다. 통역사 배치로는 이를 감당할 수 없으며, "
     "방송의 수어 통역 의무편성 비율은 자막(100%)에 비해 5% 수준에 머문다.")
h3("나. 농인은 정보를 '받기만' 해 왔다")
para("기존 수어 서비스는 정보를 수어로 '보여 주는' 방향에 집중되어 있다. 그러나 재난 상황에서 정말 필요한 것은 "
     "\"가까운 대피소가 어디냐\", \"지금 대피해야 하느냐\"를 되물을 수 있는 수단이다. 들리는 사람은 3초에 끝내는 일이 농인에게는 불가능하다. "
     "한쪽만 되면 방송이고, 양쪽이 되어야 대화이다.")
h3("다. 재난 때가 곧 오프라인이다")
para("재난이 나면 통신이 먼저 끊긴다. 서버에 의존하는 번역 서비스는 정작 가장 필요한 순간에 동작하지 않는다. "
     "따라서 인식·번역·길 안내가 사용자 기기 안에서 동작해야 하며, 이를 위해서는 대규모 학습은 고성능 연구망 자원에서, 추론은 경량 모델로 기기에서 하는 구조가 필요하다.")
para("이에 본 과제는 ① 재난 정보를 즉시 한국수어 아바타로 전달하고, ② 농인의 수어 질문을 인식해 한국어·음성과 위치 기반 답으로 되돌리며, "
     "③ 이 모든 것을 KOREN 연구망 자원으로 학습하고 통신이 끊겨도 동작하도록 만드는 것을 목적으로 한다.")

h2("2. 특징(동일·유사 아이디어에 대한 차별성, 독창성, 혁신성)")
table(TABS[0], ["구분", "기존 방식·유사 서비스", "SignBridge"], [
    ["전달 방향", "수어로 보여 주기(단방향)", "받기 + 묻기(양방향). 수어 질문 → 의도 판정 → 수어·지도로 답"],
    ["데이터", "사람이 만든 애니메이션 또는 소수 정형 문장", "AI Hub 실제 농인 수어자 키포인트 12,833종 동작 사전"],
    ["동작 환경", "서버·방송망 의존", "브라우저 단독 추론, 비행기 모드에서도 동작(PWA)"],
    ["번역 범위", "정형 문장(일기예보 등) 위주", "재난문자·행동요령·창구 대화·일상회화·길찾기 5개 영역 실측"],
    ["검증", "화면 확인 위주", "오역 회귀 156건·재생 확인 2,388개 등 자동 검사로 '조용한 실패'를 잡음"],
    ["개인정보", "영상 업로드 필요", "영상은 기기 밖으로 나가지 않음(관절 좌표만 처리)"],
], widths=[2.6, 5.4, 8.0])
bullet("독창성 ① 양방향: 같은 155차원 특징 정의로 학습과 추론을 묶어, 수어를 '보여 주는' 앱이 아니라 농인이 '묻는 쪽'이 되는 앱을 만들었다.")
bullet("독창성 ② 오프라인: 인식 모델(ONNX 20MB)·번역 모델(int8 30MB)·MediaPipe·동작 사전·전국 장소 목록을 기기에 저장하고, 지도 타일 없이 SVG로 방향 지도를 직접 그려 통신 없이 길을 안내한다.")
bullet("혁신성 ③ '틀렸을 때의 피해'로 판단: 잘못된 수어는 표현되지 않은 것보다 나쁘다(농인은 그것을 믿는다). 그래서 학습 모델은 학습 분야(재난문자)에서만 쓰고, 명령 말투의 행동요령은 사전으로 보낸다. 부정어(안·못) 손실, 방위어 오역 등 화면으로는 보이지 않는 실패를 회귀 검사로 막는다.")
bullet("혁신성 ④ 연산이 부족한 GPU에 맞춘 설계: H200 MIG(전체 연산의 약 29%)에서 영상 CNN 대신 2.8M 파라미터 랜드마크 트랜스포머로 13,576종을 분류했다. 영상 대신 관절 좌표를 다뤄 문장당 데이터가 약 2.4KB로, 영상의 약 1/2,000이다.")
page_break()

# ── Ⅱ 추진 내용과 범위 ───────────────────────────────
chapter("Ⅱ", "아이디어 개발 추진 내용과 범위")
h2("1. 개발 목표 및 추진 내용")
h3("가. 개발 목표")
bullet("최종 목표: 재난 정보를 한국수어로 즉시 전달하고, 농인의 수어 질문에 수어·음성으로 답하는 양방향 통역 서비스를 KOREN 자원으로 학습·운영한다.")
bullet("세부 목표", mark="○")
bullet("실데이터 기반 수어 낱말 인식: 수어자 분리 평가에서 처음 보는 수어자에게도 일반화되는 모델", 1)
bullet("한국어→수어 변환: 재난문자는 학습 모델, 그 밖의 영역은 통계 사전·규칙으로 오역을 최소화", 1)
bullet("당사자 화면: 한국어 의존을 줄인 받기·묻기·대화·사전 화면과 기관용 키오스크", 1)
bullet("오프라인 동작: 통신이 끊긴 상태에서도 인식·번역·길 안내가 동작", 1)
bullet("KOREN 자원 활용: AI Cloud 학습, HPC 전처리 설계, KOREN VM 상시 서버", 1)
figure(IMG / "system.png", FIGS[0])

h3("나. 세부 추진 내용 및 범위")
table(TABS[1], ["영역", "추진 내용", "범위"], [
    ["데이터", "AI Hub 재난안전 수어영상·수어영상 말뭉치 수신, 무해제 스트리밍 ETL", "133GB · 40만 클립 가공, 수어자 단위 분리"],
    ["① 단어 인식", "랜드마크 → 글로스 트랜스포머(iso-v2), ONNX int8 내보내기", "13,576종, 브라우저 추론"],
    ["② 연속 인식", "랜드마크열 → 글로스열 CTC(ctc-v1)", "학습 완료·앱 적용 보류(근거 Ⅲ-4)"],
    ["③ 언어 변환", "한국어→글로스 seq2seq(t2gs-v2), 글로스→한국어(g2ts-v1)", "t2gs는 재난문자에 적용, g2ts는 보류"],
    ["번역 사전", "Dice 계수 정렬 통계 사전 + 활용형·조사형 규칙", "230,240낱말"],
    ["아바타", "키포인트 → 3D 휴머노이드 리타게팅, 손 깊이(z), 고개 동작", "동작 사전 12,833종"],
    ["앱", "받기·묻기·대화·사전, 키오스크, PWA 오프라인", "폰·태블릿·키오스크"],
    ["길 안내", "의도 판정 + 거리·8방위 계산 + 타일 없는 지도", "전국 28,125곳"],
], widths=[2.6, 8.4, 5.0])

h3("다. 참여구성원의 역할")
table(TABS[2], ["성명", "소속", "역할"], [
    ["김주형(팀장)", "영남대학교 [[학과]]", "[[과제 총괄 · AI 모델 학습(인식·번역) · KOREN 자원 운영 · 앱 개발]]"],
    ["류다영", "영남대학교 [[학과]]", "[[당사자 현장 검증(복지관 섭외·시연) · UI/UX · 발표·문서 · 데이터 검수]]"],
], widths=[3.0, 4.5, 8.5])

h2("2. 단계별 세부 구현 계획")
table(TABS[3], ["단계", "기간", "계획", "결과"], [
    ["1단계", "7월", "데모 웹앱 · 아바타 리타게팅 · 규칙 기반 변환 MVP", "완료"],
    ["2단계", "8월 상순", "KOREN AI Cloud 구축 · AI Hub 실데이터 수신 · ETL", "완료(133GB · 40만 클립)"],
    ["3단계", "8월 중순", "번역·인식 모델 학습 · 브라우저 배포 · 양방향 왕복", "완료 + 계획 외 추가(오프라인·창구 대화·묻기)"],
    ["4단계", "8월 하순~9월", "연속 인식 · 일상어휘 편입 · 당사자 평가", "CTC 학습 완료(적용 보류), 당사자 평가 실시"],
    ["5단계", "10월", "KOREN 상시 서버 운영 · 현장 시연 준비", "KOREN VM 상시 서버 운영, 최종평가 시연 준비"],
], widths=[1.8, 2.6, 6.4, 5.2])
page_break()

# ── Ⅲ 진행 내용 및 결과 ──────────────────────────────
chapter("Ⅲ", "아이디어 개발 진행 내용 및 결과")
h2("1. 개발 수행 현황 및 최종 결과물")
h3("가. 하드웨어 부분")
para("본 과제는 별도 하드웨어를 제작하지 않고, 이미 보급된 기기(스마트폰·태블릿·노트북 웹캠·키오스크용 태블릿)에서 동작하도록 설계하였다. "
     "재난 현장에 새 장비를 보내지 않아도 된다는 점이 확산에 유리하다고 판단했다.")
bullet("입력: 기기 내장 카메라(수어 인식), 마이크(직원 음성 → 자막·수어)")
bullet("출력: 화면(3D 아바타·자막·방향 지도), 스피커(농인의 답 → 음성)")
bullet("키오스크: 태블릿을 '#/app?kiosk=1'로 띄우면 대화 화면으로 시작, 큰 글씨, 5분 무조작 시 자동 초기화")
bullet("학습 인프라: KOREN AI Cloud GPU(H200 MIG 1g.35GB, vCPU 16, RAM 128Gi) — Ⅲ-2 참조")

h3("나. 소프트웨어 부분")
para("(1) 한국어 → 수어 (받기·대화)", bold=True)
para("입력 문장은 재난 판단 에이전트가 종류·심각도·지역을 분석한 뒤, 수어 변환 에이전트가 3단 폴백으로 글로스열을 만든다. "
     "① 학습 모델 t2gs-v2(한국어 음절 → 글로스 seq2seq, 23.3M 파라미터, int8 30MB)는 학습 분야인 재난문자에서만 쓰고, "
     "② Dice 계수로 정렬한 23만 낱말 통계 사전과 ③ 조사·어미 규칙이 나머지를 맡는다. "
     "만들어진 글로스는 동작 사전(실제 수어자 키포인트 12,833종)에서 조각을 찾아 이어 붙이고, 3D 아바타의 팔·손가락 뼈에 리타게팅해 재생한다.")
bullet("손 깊이 복원: 웹 사전이 버리던 손의 z좌표를 원본에서 되살려(수록률 96%) 손가락 뼈 길이 변동계수를 0.182 → 0.142로 22% 줄였다.")
bullet("손가락 굽힘: 손가락당 뿌리→끝 직선거리 ÷ 마디 합(줄자 비율)으로 재고 해부학 비율로 마디에 나눠, 투영에 강하고 사람 손 자세만 나오게 했다.")
bullet("비수지: 원본의 고개 끄덕임·흔들기 구간을 반영했다. 눈썹 방향은 원본에 서술이 비어 있어 규칙으로 지어내지 않았다.")
bullet("표현할 수어 클립이 없는 낱말(처방전·번호표 등)은 낱말 카드로 띄워 정보 손실을 막는다.")
para("(2) 수어 → 한국어·음성 (묻기·대화)", bold=True)
para("웹캠 영상에서 MediaPipe로 상반신·양손 관절을 뽑고, 어깨 기준으로 정규화한 155차원 특징을 만든다. "
     "2.8M 파라미터 트랜스포머(iso-v2, ONNX int8)가 13,576종 중 낱말을 고르고, Q&A 에이전트가 낱말 묶음을 의도(대피소·병원·화장실 등)로 판정한다. "
     "이어 기기의 위치로 가장 가까운 장소의 거리와 8방위를 계산해 어림수 수어 + 방향 지도 + 한국어 음성으로 답한다. 영상은 기기 밖으로 나가지 않는다.")
bullet("학습 특징 == 추론 특징: 파이썬 학습 코드(features.py)와 브라우저 추론 코드(landmarks.ts)의 수치를 직접 대조하는 검사를 두어 오차 0을 유지한다. 어긋나면 '검증 95%인데 웹캠에선 0%'가 되는, 가장 찾기 어려운 실패이다.")
bullet("15km를 넘는 장소는 '없어요'로 답한다. 걸어서 못 가는 곳을 가리키는 것은 안내가 아니라 위험이기 때문이다.")
para("(3) 당사자 화면", bold=True)
para("받기(재난문자 → 수어), 묻기(수어로 묻고 수어로 답 받기), 대화(창구 직원 음성 → 자막+수어, 농인의 답 카드·필담·수어 → 음성), "
     "사전(낱말 검색) 4개 탭으로 구성했다. 응급 정보·위치 전송, 지난 대화 보관, 오프라인 준비, PWA 설치를 지원한다.")
figure_row([(ASSET / "app_받기.png", "받기"), (ASSET / "app_묻기답.png", "묻기"),
            (ASSET / "app_대화.png", "대화"), (ASSET / "app_사전.png", "사전")], FIGS[1])

table(TABS[4], ["모델", "구조·크기", "성능(측정값)", "앱 적용"], [
    ["iso-v2\n단어 인식", "랜드마크 트랜스포머 2.8M\nONNX int8 · 13,576종", "검증 top-1 78.2%\n미지 수어자 13명 top-1 78.6% · top-5 91.9%", "적용"],
    ["t2gs-v2\n한국어→글로스", "음절 seq2seq 23.3M\nint8 30MB", "F1 61.3 · BLEU-4 27.1(800문장)\nint8: F1 62.6 · BLEU 27.3(400문장)", "재난문자에 적용"],
    ["ctc-v1\n연속 인식", "CTC · 8,147종", "검증 WER 0.2176", "보류(클래스 집합 불일치)"],
    ["g2ts-v1\n글로스→한국어", "seq2seq", "재난 400문장 음절 BLEU 69.7 · F1 84.0", "보류(일상어 도메인 불일치)"],
], widths=[2.8, 4.2, 6.0, 3.0], size=10)

h2("2. KOREN 연동 및 활용 결과")
para("KOREN 자원 셋은 성격이 완전히 달라, 하나로 모든 일을 하려 하면 어느 쪽도 제대로 되지 않는다. "
     "그래서 멘토링(7/23 KOREN 자원 활용 미팅)에 따라 역할을 나누었다. 핵심은 '옮기는 것이 작다'는 점이다. "
     "원본 영상은 수백 GB라 옮기지 않고, 랜드마크 팩(프레임당 약 0.5KB)과 모델 파일(수십 MB)만 넘긴다.")
figure(IMG / "network.png", FIGS[2])
table(TABS[5], ["자원", "사양", "활용 내용 및 결과"], [
    ["AI Cloud\n(CHEETAH)", "H200 MIG 1g.35GB\nvCPU 16 · RAM 128Gi", "AI Hub 실데이터 133GB를 KOREN으로 수신하고 무해제 스트리밍 ETL로 40만 클립 가공. "
     "인식·번역 모델 4종(iso-v2·t2gs-v2·ctc-v1·g2ts-v1) 학습·평가·ONNX 내보내기. 에폭당 21~25분에 215만 세그먼트 처리."],
    ["HPC 이노베이션 허브", "Xeon Gold VM\nPBS Torque", "8/5 활용 교육 이수. 영상 → 랜드마크 변환을 클립 단위로 나누는 샤딩 옵션과 PBS 잡 스크립트(ml/jobs/pbs_extract)를 구현해 저장소에 포함. "
     "[[실제 분산 변환 실행 여부·규모 기입]]"],
    ["KOREN VM", "NOC 발급 SSH", "상시 데모 서버 운영(웹앱 · 고정 주소). 심사·시연에서 언제든 열리도록 24시간 가동. [[운영 기간 · 주소 · 구성(정적 사이트/번역 API) 기입]]"],
], widths=[3.0, 3.6, 9.4], size=10)
para("KOREN 활용의 설계상 의미는 다음과 같다.")
bullet("MIG는 메모리는 넉넉하고 연산이 부족하다(FP32 17.14 TFLOPS, H200 전체의 약 29%). 이에 맞춰 영상 CNN 대신 랜드마크 트랜스포머를 골라 13,576종 분류를 학습 가능한 범위로 만들었다.")
bullet("AI Hub 배포본의 함정(확장자는 .zip이나 실제 7z 통짜 압축, 메타데이터 중첩, 파일명 표기 불일치, 좌표 단위 혼재, 깊이 추정 실패값 등)을 원본을 직접 열어 확인하고, 한 번만 훑는 스트리밍 처리로 대용량을 연구망 안에서 가공했다.")
bullet("영상 대신 관절 좌표를 전송·처리하므로 문장당 약 2.4KB로, 영상 대비 약 1/2,000이다. 저지연·다지점 송출 시 네트워크 부담이 작다.")
bullet("한계: 계획했던 NIA POP 다지점 송출 종단 지연 실측은 수행하지 못했다(Ⅳ-1 향후 과제).")

h2("3. 멘토 의견에 따른 개선사항")
table(TABS[6], ["일자 · 멘토", "받은 의견", "반영 내용"], [
    ["7/23\nKOREN 자원 활용 미팅", "AI Cloud·HPC·VM 신청·활용 방법, 과제 기간 중 반드시 활용할 것", "자원별 역할 분담: AI Cloud는 학습, HPC는 CPU 전처리, KOREN VM은 상시 데모. 하나로 다 하려던 계획을 접음"],
    ["8/5\nHPC 이노베이션 허브 교육", "VM 구성, PBS Torque 스케줄러, 분산 작업 제출 방법", "영상→랜드마크 변환을 HPC로 분리하는 분산 설계 확정, 샤딩 옵션·PBS 잡 스크립트 구현"],
    ["8/7\nKOREN AI Cloud 교육", "GPU 워크스페이스·볼륨 운영, MIG 연산 특성", "볼륨 운영 원칙 수립(홈은 패키지 전용, 데이터·체크포인트는 사용자 볼륨). MIG 제약에 맞춰 랜드마크 트랜스포머 채택"],
    ["지도교수 멘토링\n(컴퓨터공학)", "평가 수치의 신뢰성 확보, 실데이터 기반 검증, 실시간성·경량화", "수어자 분리 평가를 표준으로 고정, 학습에 없던 수어자 13명으로 이중 평가(78.6%). 브라우저 단독 추론으로 경량화"],
    ["지도교수 멘토링\n(사회복지학)", "농인의 한국어 문해력 편차 고려, 텍스트 중심 화면 지양, 실제 당사자 검증 필요", "한국어를 최소화한 당사자 화면 제작. 복지관 2곳 현장 시연(8월), 농인 당사자 평가(9~10월) 실시"],
    ["중간평가 이후\n[[멘토·심사 의견 기입]]", "[[중간평가 심사 의견]]", "[[반영 내용]]"],
], widths=[3.4, 5.6, 7.0], size=10)

h2("4. 결과물의 통합 및 시험/검증 결과")
para("이 앱의 실패는 대부분 '화면은 정상인데 알맹이가 없는' 모양이다. 아바타가 조용히 서 있어도 한국어 자막은 떠 있고, "
     "방향이 뒤집혀도 화살표와 숫자는 그려진다. 그래서 눈이 아니라 수치로 검증하는 자동 검사 체계를 만들고, 변경할 때마다 실행하였다.")
h3("가. 수어 낱말 인식 — 수어자 분리 평가")
para("같은 사람이 학습과 평가에 함께 있으면 모델이 그 사람의 버릇을 외워 정확도가 부풀려진다. 본 보고서의 인식 수치는 모두 수어자 단위로 분리해 잰 값이다. "
     "13,576종 중 하나를 고르는 문제에서 검증 top-1 78.2%, 학습에 없던 수어자 13명(49,721표본)에서 top-1 78.6%·top-5 91.9%로 검증치와 같은 값이 나와, 외운 것이 아니라 일반화되었음을 확인했다. "
     "이전 판(iso-v1, 8,147종, top-1 78.7%)보다 문제가 1.7배 어려워졌는데도 정확도를 유지했다.")
figure(ASSET / "chart_정확도.png", FIGS[3], width=13)
h3("나. 번역 품질 — 표현률과 오역을 따로 잰다")
para("표현률은 '낱말이 수어로 나갔는가'만 잰다. 실제로 복합어 처리 버그로 \"어디가 아프신지\"가 '어디 아프다 신다(신발)'로 번역되던 동안에도 표현률은 그대로였다. "
     "그래서 맞게 나갔는지는 오역 회귀 사례(must/never) 156건으로 따로 검사한다. 튜닝에 쓰지 않은 홀드아웃 문장으로 일반화를 정직하게 잰다.")
table(TABS[7], ["영역", "표현률", "비고"], [
    ["행동요령", "100%", "사전 경로(명령 말투)"],
    ["길찾기", "100%", "방위어 오역 수정 후"],
    ["일상회화", "96.9%", "홀드아웃 90.2%"],
    ["재난문자", "95.8%", "학습 모델 t2gs-v2 경로"],
    ["창구 대화", "93.5%", "홀드아웃 94.8%"],
], widths=[4, 3, 9])
h3("다. 화면으로는 안 보이는 실패를 잡은 사례")
bullet("부정 손실: '안'·'못'이 한 글자라 '너무 짧다'는 규칙에 걸려 버려져, \"약을 안 먹었어요\"가 '약 먹다'로 뜻이 뒤집혔다. 안→아니다, 못→못하다로 고정하고 회귀 사례에 넣었다.")
bullet("방향 오역: '북동쪽'이 'km 지진 크기'로 번역되고 있었다. 방위어를 고정하고 길찾기 검사에 넣었다.")
bullet("도메인 오적용: 학습 모델이 행동요령 \"엘리베이터를 타지 말고 계단으로 대피하세요\"를 엉뚱한 글로스로 냈다. 목숨이 걸린 안내라 행동요령은 사전으로 분기했다.")
bullet("모델 미적용 판단: ctc-v1은 클래스 집합(8,147종)이 배포 모델(13,576종)과 달라 교체 시 '화장실' 의도가 오류 없이 사라진다. g2ts-v1은 일상 글로스 \"머리 아프다\"를 \"오늘 아침 기온이 크게 오르고 있습니다\"로 바꿔, 직원이 농인의 말을 잘못 듣게 된다. 둘 다 측정 후 적용하지 않았다.")
table(TABS[8], ["검사", "내용", "결과"], [
    ["특징 일치", "파이썬 학습 ↔ 브라우저 추론 155차원 특징 대조", "오차 0"],
    ["CTC 디코딩 일치", "파이썬 ↔ 브라우저", "3,000판 전부 일치"],
    ["오역 회귀", "한 번이라도 틀렸던 문장 must/never", "156건 통과"],
    ["재생 확인", "번역이 낸 글로스가 동작 사전에 실존·재생되는가", "371문장 2,388개 전부"],
    ["의도 판정", "수어 낱말 묶음 → 의도(오검출 포함)", "27/27"],
    ["의도 낱말 실존", "의도 판정 낱말이 인식 클래스에 있는가", "47/47"],
    ["재난 갈래 이름", "재난 갈래별 한국어 이름", "41/41"],
    ["길찾기", "거리·방위·어림수·15km 차단", "통과"],
    ["실조작 e2e", "폰·태블릿(가로/세로)·키오스크·오프라인", "통과"],
], widths=[3.2, 8.8, 4.0], size=10)
h3("라. 당사자 검증")
para("숫자는 '낱말이 나갔는가/맞게 나갔는가'까지만 잰다. 농인이 보고 뜻이 통하는지는 다른 질문이라, "
     "8월에 경산시장애인종합복지관과 대구광역시청각언어장애인복지관에서 수어 이용자에게 직접 시연하고 피드백을 받았다. "
     "화면 크기·보는 거리에 따라 손이 작아져 읽히는 정도가 달라진다는 점, 세대·지역에 따른 수어 차이, 수어를 쓰지 않는 중도 실청 이용자를 위한 '눌러서 묻기' 경로의 필요를 확인했다.")
para("이어 9~10월에 농인 당사자 평가를 실시하였다. [[평가 일자 · 기관 · 참여 인원]] [[주요 결과: 아바타 수어 이해도, 어순 자연스러움, 손이 잘려 보이는지, 고개 동작 등]] [[결과에 따라 바꾼 것]]")
figure_row([(PHOTO / "01.jpg", "수어 이용자에게 시연"), (PHOTO / "04.jpg", "아바타 수어 확인"),
            (PHOTO / "02.jpg", "질의응답 화면 확인")], FIGS[5], width=5.0)
page_break()

# ── Ⅳ 결론 ──────────────────────────────────────────
chapter("Ⅳ", "결 론")
h2("1. 개발 최종 결과물")
para("본 과제의 최종 결과물은 서버 없이 브라우저 안에서 양방향으로 동작하는 한국수어 통역 앱 SignBridge와, 이를 만든 학습·검증 파이프라인이다.")
bullet("웹앱(PWA): 받기·묻기·대화·사전 4개 탭, 키오스크 모드, 오프라인 동작. 공개 주소 https://biocode67.github.io/signbridge/ 및 KOREN VM 상시 서버")
bullet("학습 모델: 수어 낱말 인식 iso-v2(13,576종), 한국어→글로스 t2gs-v2(int8 30MB) 앱 탑재. 연속 인식 ctc-v1, 글로스→한국어 g2ts-v1 학습 완료(적용 보류)")
bullet("데이터 자산: 동작 사전 12,833종(손 깊이 포함), 번역 사전 230,240낱말, 전국 장소 28,125곳(대피소 14,134곳)")
bullet("검증 체계: 특징 일치·오역 회귀·재생 확인·의도 판정·길찾기·실조작 e2e 등 자동 검사, 판단 기록(DECISIONS.md)")
figure(ASSET / "web_에이전트.png", FIGS[4], width=14)
para("남은 한계와 향후 과제는 다음과 같다. 숨기지 않고, 무엇이 있으면 풀리는지까지 적는다.", before=6)
bullet("연속 수어: CTC 모델은 학습되었으나 클래스 집합이 달라 단독 교체 시 일부 의도가 사라진다. 이어서 한 수어 표본을 받아 iso-v2와 병행 적용 여부를 정한다.")
bullet("지문자(이름·지명): 클립 17,000개·지명 1,015종·자모 37종 데이터를 확인했으며, 키포인트를 받아 자모 CTC를 학습하면 처음 보는 이름도 읽을 수 있다.")
bullet("표정(비수지): 눈썹 방향은 원본 서술이 비어 있어 지어내지 않았다. 고개 동작·마우징부터 반영한다.")
bullet("공식 대피소 목록: 현재 OSM 기반 참고용이다. 공공데이터포털 인증키로 행정안전부 공식 목록으로 교체한다.")
bullet("KOREN 실회선: NIA POP 다지점 송출 종단 지연 실측을 수행한다.")

h2("2. 기술 구현에 따른 기대 효과")
h3("가. 사회적 효과")
bullet("즉시성: 통역사 배치를 기다리지 않고 재난문자가 오는 즉시 수어로 전달된다.")
bullet("동시성: 전국 동시다발 재난에서도 인력 제약 없이 같은 품질로 전달된다.")
bullet("가용성: 통신이 끊긴 재난 현장에서도 기기 안에서 동작한다. 재난 때가 곧 오프라인이다.")
bullet("양방향 접근권: 농인이 정보를 받기만 하지 않고 직접 묻고 답을 받는다. 한국수화언어법이 보장하는 정보 접근권의 실질적 구현에 기여한다.")
h3("나. 기술·산업적 효과")
bullet("공공 창구 확장: 병원·약국·주민센터 창구 키오스크로 직원 음성 ↔ 수어·음성 대화를 지원한다.")
bullet("B2G 연계: 지자체 재난방송·재난문자 연계 수어 송출, 공공안내·교통 방송으로 확장할 수 있다.")
bullet("경량 온디바이스 AI: 연산이 제한된 GPU에서 학습하고 브라우저에서 추론하는 구조는 다른 저자원 언어·접근성 서비스에도 재사용할 수 있다.")
bullet("검증 방법론: '화면은 정상인데 알맹이가 없는' 실패를 자동 검사로 잡는 방식은 접근성 서비스 품질 관리의 기준이 될 수 있다.")
page_break()

# ── Ⅴ 참고문헌 ─────────────────────────────────────
chapter("Ⅴ", "참고문헌")
refs = [
    "보건복지부, 「2024년 등록장애인 현황」, 2025.",
    "국립국어원, 「한국수어 사용 실태 조사」.",
    "「한국수화언어법」, 법률 제13978호, 2016.",
    "한국지능정보사회진흥원(NIA), AI Hub 「재난 안전 정보 전달을 위한 수어영상」 데이터셋.",
    "한국지능정보사회진흥원(NIA), AI Hub 「수어 영상」 데이터셋.",
    "C. Lugaresi et al., \"MediaPipe: A Framework for Building Perception Pipelines\", arXiv:1906.08172, 2019.",
    "A. Vaswani et al., \"Attention Is All You Need\", Advances in Neural Information Processing Systems 30, 2017.",
    "A. Graves et al., \"Connectionist Temporal Classification: Labelling Unsegmented Sequence Data with Recurrent Neural Networks\", Proc. ICML, 2006.",
    "K. Papineni et al., \"BLEU: a Method for Automatic Evaluation of Machine Translation\", Proc. ACL, 2002.",
    "L. R. Dice, \"Measures of the Amount of Ecologic Association Between Species\", Ecology, vol. 26, no. 3, 1945.",
    "OpenStreetMap contributors, OpenStreetMap, https://www.openstreetmap.org",
    "ONNX Runtime Web, https://onnxruntime.ai",
]
for i, r_ in enumerate(refs, 1):
    p = para(f"[{i}]  {r_}", size=12, indent=0.8)
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.first_line_indent = Cm(-0.8)
page_break()

# ── 별첨 회의록 ──────────────────────────────────────
chapter("별첨", "회의록")
MEETINGS = [
    ("킥오프 회의", ["과제 범위 확정: 재난정보 한국수어 통역, 단방향이 아닌 양방향으로", "데이터: AI Hub 수어 말뭉치 사용, KOREN 자원 신청", "역할 분담과 일정(5단계) 수립"]),
    ("데이터 전략 회의", ["AI Hub 원본 구조 확인 결과 공유(7z 통짜 압축, 메타 중첩, 파일명 표기 불일치)", "평가는 수어자 분리로 고정", "KOREN 자원별 역할: AI Cloud 학습 · HPC 전처리 · VM 상시 서버"]),
    ("중간평가 대비 회의", ["발표 수치는 측정 스크립트가 재계산한 값만 사용", "복지관 현장 시연 결과 반영", "아직 안 되는 것(연속 수어·지문자·표정)을 먼저 밝히기로"]),
]
for i, (name, items) in enumerate(MEETINGS):
    if i:
        page_break()
    para(f"■ {name}", bold=True, size=BIG - 1)
    para("o 일 시 : 2026년 [[00]]월 [[00]]일, [[00:00]] ~ [[00:00]]", indent=0.4, after=0)
    para("o 장 소 : [[장소]]", indent=0.4, after=0)
    para("o 참석자 : 김주형, 류다영", indent=0.4)
    para("1. 회의록", bold=True, indent=0.4)
    for it in items:
        bullet(it, 1)
    para("2. 회의 사진", bold=True, indent=0.4)
    para("[[회의 사진 첨부]]", align="c")

page_numbers()
OUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(OUT)
print("saved", OUT)
