"""최종보고서_닿다.docx — 사무국 양식(2-1)의 목차·서식을 그대로 따른다.

한글에서 열어 '다른 이름으로 저장 → .hwp'로 바꿔 제출한다.
노란 형광 [ ] 자리는 사람이 채워야 하는 곳이다(저장소에 근거가 없는 정보).
수치는 전부 저장소의 측정 결과(CLAUDE.md · DECISIONS.md · 중간발표)에서 옮겼다.
"""
import sys
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT, WD_SECTION
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


def table(caption, header, rows, widths=None, size=11, merge_first=False):
    cap = para(caption, bold=True, size=11, align="c", before=6, after=2)
    cap.paragraph_format.keep_with_next = True
    t = doc.add_table(rows=1 + len(rows), cols=len(header))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for j, h in enumerate(header):
        cell_text(t.rows[0].cells[j], h, bold=True, size=size, align="c")
        shade(t.rows[0].cells[j], "D9E2F3")
    for i, r in enumerate(rows, 1):
        for j, v in enumerate(r):
            cell_text(t.rows[i].cells[j], str(v), size=size, align="c" if j == 0 else "l")
    # 머리글 줄은 쪽이 넘어가도 반복, 각 줄은 쪽 경계에서 쪼개지지 않게
    for k, row in enumerate(t.rows):
        trPr = row._tr.get_or_add_trPr()
        trPr.append(OxmlElement("w:cantSplit"))
        if k == 0:
            trPr.append(OxmlElement("w:tblHeader"))
    if merge_first:
        start = 1
        for i in range(1, len(rows) + 1):
            last = i == len(rows) or rows[i][0] != ""
            if last:
                top = t.cell(start, 0)
                shade(top, "F2F5FA")
                if i > start:
                    top = top.merge(t.cell(i, 0))
                cell_text(top, rows[start - 1][0], bold=True, size=size, align="c")
                start = i + 1
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
    p.paragraph_format.keep_with_next = True
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


def wide_figure(path, caption):
    """가로 쪽 한 장에 그림 하나 — 구성도 글자가 읽히게 한다."""
    ls = doc.add_section(WD_SECTION.NEW_PAGE)
    ls.orientation = WD_ORIENT.LANDSCAPE
    ls.page_width, ls.page_height = Cm(29.7), Cm(21)
    ls.left_margin = ls.right_margin = Cm(1.6)
    ls.top_margin, ls.bottom_margin = Cm(1.3), Cm(1.3)
    figure(path, caption, width=26.0)
    ps = doc.add_section(WD_SECTION.NEW_PAGE)
    ps.orientation = WD_ORIENT.PORTRAIT
    ps.page_width, ps.page_height = Cm(21), Cm(29.7)
    ps.left_margin = ps.right_margin = Cm(2.5)
    ps.top_margin, ps.bottom_margin = Cm(2.0), Cm(2.0)


def figure_grid(items, caption, per_row=2, width=7.6):
    """사진을 한 줄에 per_row장씩 크게 — 남는 칸은 비운다."""
    rows = [items[i:i + per_row] for i in range(0, len(items), per_row)]
    t = doc.add_table(rows=len(rows), cols=per_row)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for r, row in enumerate(rows):
        trPr = t.rows[r]._tr.get_or_add_trPr()
        cs = OxmlElement("w:cantSplit")
        trPr.append(cs)
        for j, (pth, sub) in enumerate(row):
            c = t.rows[r].cells[j]
            p = c.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.add_run().add_picture(str(pth), width=Cm(width))
            q = c.add_paragraph()
            q.alignment = WD_ALIGN_PARAGRAPH.CENTER
            q.paragraph_format.space_after = Pt(6)
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
    p = para(text, bold=True, size=BIG - 1, before=10, after=4)
    p.paragraph_format.keep_with_next = True


def h3(text):
    p = para(text, bold=True, size=BODY, indent=0.3, before=6, after=2)
    p.paragraph_format.keep_with_next = True


def page_break():
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def page_numbers():
    for s in doc.sections[:1]:
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
para("참여 구성원 :  김주형 (영남대학교 컴퓨터공학과 학사과정)  ─ 팀장", indent=1.5)
para("류다영 (영남대학교 컴퓨터공학과 학사과정)", indent=4.4)
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
bullet("KOREN 3계층 설계: Core(AI Cloud 학습 · HPC 전처리 · KOREN VM 원천 서버) → Edge(지역 노드 수어 패키지 캐시·지역 송출) → 단말(기기 안 추론·오프라인 폴백)")

h2("4. 개 발 결 과")
para("본 과제는 아래 결과를 모두 저장소의 측정 스크립트로 재계산 가능한 수치로 확인하였다.", indent=0.5)
bullet("정량 평가 5개 축 24개 지표: 오역 회귀 통과율 100%(156/156), 번역 글로스 재생 성공률 100%(2,388/2,388), 수어 의도 판정 100%(27/27), 송출 데이터 99.95% 절감")
bullet("수어 낱말 인식 13,576종: 무작위 대비 약 1만 배, 처음 보는 수어자 어휘 커버리지 98.9%, 검증과 처음 보는 수어자의 격차 0.05%p")
bullet("한국어→글로스 학습 모델 t2gs-v2: 통계 사전 대비 BLEU +45%, 글로스 F1 약 3배, int8 30MB로 줄여 브라우저에서 문장당 144ms(1스레드)")
bullet("번역 낱말 표현률: 행동요령·길찾기 100%, 일상회화 96.9%, 재난문자 95.8%, 창구 대화(홀드아웃) 94.8%")
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
    "그림 1. 양방향 처리 흐름(4개 에이전트)",
    "그림 2. KOREN 활용 네트워크 구성도(Core · Edge · 단말 3계층)",
    "그림 3. 재난 발령 → 수어 표출 송출 시퀀스(KOREN 설계)",
    "그림 4. 추진 일정과 실적",
    "그림 5. 당사자 화면 4종(받기·묻기·대화·사전)",
    "그림 6. 데이터·모델 파이프라인(KOREN Core)",
    "그림 7. 핵심 성능 지표(정량 평가)",
    "그림 8. 기기별 실조작 검증 화면(폰 · 데스크톱)",
    "그림 9. 현장 시연 장소",
    "그림 10. 복지관 현장 시연 ① 김주형 — 직접 시연과 설명",
    "그림 11. 복지관 현장 시연 ② 류다영 — 아바타 수어 확인과 조작 안내",
    "그림 12. 현장에서 수어 이용자와 기대효과를 함께 이야기(김주형)",
]
TABS = [
    "표 1. 기존 방식·유사 서비스 대비 차별성",
    "표 2. KOREN 망·자원 배치 설계",
    "표 3. 세부 추진 내용 및 범위",
    "표 4. 참여구성원의 역할",
    "표 5. 단계별 세부 구현 계획과 진행 결과",
    "표 6. 학습 모델과 성능",
    "표 7. KOREN 자원별 활용 결과",
    "표 8. KOREN 설계 대비 구현 현황",
    "표 9. 멘토 의견에 따른 개선사항",
    "표 10. 정량 평가 지표 종합(5개 축 24개 지표)",
    "표 11. 도메인별 번역 낱말 표현률",
    "표 12. 자동 시험·검증 항목과 결과",
    "표 13. 정성 평가 항목과 결과",
    "표 14. 현장에서 확인한 것과 대응",
]
para("그 림  목 차", bold=True, size=16, align="c", after=6)
for f_ in FIGS:
    q = para(f_, size=11.5, indent=0.8, after=0)
    q.paragraph_format.line_spacing = 1.25
para("", after=8)
para("표  목 차", bold=True, size=16, align="c", after=6)
for t_ in TABS:
    q = para(t_, size=11.5, indent=0.8, after=0)
    q.paragraph_format.line_spacing = 1.25
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
wide_figure(IMG / "bidir.png", FIGS[0])

h3("■ KOREN 망·자원 활용 설계")
para("KOREN은 서울·수원·판교·대전·전주·광주·대구·부산·제주·춘천의 10개 노드를 잇는 국가 연구망으로, 서울 주센터와 대전 부센터를 잇는 백본 구간은 7Tbps급으로 고도화되었고 "
     "주요 지역에는 400Gbps 이더넷 전용 회선이 제공된다[13][14]. 국제적으로는 홍콩·싱가포르 PoP를 통해 TEIN에 연결된다[13]. 본 과제는 이 망의 연구 자원(AI Cloud·HPC·VM)과 "
     "전국 노드 구조를 함께 활용하도록 설계했다.")
para("본 과제의 KOREN 설계는 '무거운 것은 연구망 안에, 가벼운 것만 밖으로'라는 한 가지 원칙에서 출발한다. "
     "재난 수어 서비스에서 가장 무거운 것은 학습용 원본 영상(133GB)과 학습 연산이고, 가장 자주 오가는 것은 재난 한 건의 수어 패키지(약 2.4KB/문장)다. "
     "둘은 크기가 일곱 자릿수 이상 차이 나므로 같은 곳에 두면 안 된다. 그래서 KOREN을 Core · Edge · 단말의 3계층으로 나누어 썼다.")
wide_figure(IMG / "koren_network.png", FIGS[1])
bullet("설계 원칙 ① 무거운 것은 Core에 — 원본 수신·ETL·학습·평가는 수도권 KOREN Core(AI Cloud · HPC 이노베이션 허브) 안에서만 한다. 원본은 연구망 밖으로 나가지 않는다.")
bullet("설계 원칙 ② 가벼운 것만 망으로 — Core에서 밖으로 나가는 것은 모델(인식 20MB · 번역 30MB)과 수어 패키지(글로스열 + 키포인트, 약 2.4KB/문장)뿐이다. 영상 송출 대비 약 1/2,000이다.")
bullet("설계 원칙 ③ 재난 지역 가까이에서 — KOREN 백본의 지역 노드(수원·판교·춘천·전주·광주·대구·부산·제주)를 Edge로 두고 수어 패키지와 동작 사전을 미러링한다. 재난이 난 지역의 노드로만 푸시하고, 전국 동시 발령은 노드별로 병렬 송출해 단일 서버 병목을 없앤다.")
bullet("설계 원칙 ④ 끊겨도 동작 — 단말은 첫 접속 때 모델·사전·전국 장소 목록을 받아 저장한다. 망이 끊기면 단말이 혼자 인식·번역·길 안내를 한다. 재난 때가 곧 오프라인이기 때문이다.")
table(TABS[2], ["계층", "KOREN 자원", "맡는 일", "오가는 데이터", "상태"], [
    ["Core", "AI Cloud\n(H200 MIG)", "원본 수신 · 스트리밍 ETL · 학습 · 평가 · ONNX 내보내기", "원본 133GB 입력\n모델 약 50MB 출력", "구현"],
    ["Core", "HPC 이노베이션 허브\n(Xeon VM · PBS)", "영상 → 관절 좌표 분산 변환(클립 단위 샤딩)", "영상 입력\n랜드마크 팩 출력", "잡 스크립트 구현"],
    ["Core", "KOREN VM\n(상시 서버)", "웹앱·모델·동작 사전 원천 배포, 재난문자 수신 → 판단 → 수어 변환", "앱·모델(최초 1회)\n수어 패키지", "상시 운영"],
    ["Edge", "지역 노드 8곳\n(수원·판교·춘천·전주·\n광주·대구·부산·제주)", "수어 패키지 캐시 · 동작 사전 미러 · 지역 재난 송출", "약 2.4KB/문장", "확장 설계"],
    ["단말", "폰·태블릿·키오스크", "기기 안 인식·번역·길 안내 · 오프라인 폴백", "망 단절 시에도\n단독 동작", "구현·검증"],
], widths=[1.4, 3.2, 6.0, 3.4, 2.0], size=10)
para("재난 한 건이 발령되면 그림 3의 순서로 움직인다. Core의 KOREN VM이 재난문자를 받아 재난 종류·지역을 판단하고 수어 패키지로 만든 뒤, "
     "KOREN 백본으로 해당 지역 노드에만 보낸다. 노드는 가까운 단말에 전달하고, 단말은 저장된 동작 사전으로 아바타 수어를 재생한다. "
     "농인이 수어로 되묻는 경우 의도 판정과 위치 기반 답은 단말에서 끝나며, 최신 대피소·재난 정보가 필요할 때만 Edge를 거쳐 Core에 조회한다. "
     "영상이 아니라 KB 단위 패키지가 오가므로 전국 동시 발령에서도 회선이 막히지 않는다.")
wide_figure(IMG / "sequence.png", FIGS[2])

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
para("2인 팀이라 두 사람이 모든 단계에 함께 참여했으나, 책임 영역은 '모델·인프라'와 '당사자·서비스'로 나누었다. "
     "기술 판단은 근거와 함께 판단 기록(DECISIONS.md)에 남기고, 주 1회 이상 진행 상황과 측정 결과를 공유했다.")
table(TABS[3], ["성명 · 소속", "담당 분야", "세부 역할", "주요 산출물"], [
    ["김주형(팀장)\n영남대학교\n컴퓨터공학과\n학사과정", "과제 총괄\nAI 모델\nKOREN 인프라\n앱 핵심 기능",
     "· 과제 기획·일정 총괄, 사무국·멘토 대응\n· KOREN AI Cloud 워크스페이스 구축·볼륨 운영, HPC 잡 구성, KOREN VM 상시 서버 운영\n"
     "· AI Hub 133GB 수신·스트리밍 ETL, 수어자 분리 데이터셋 구성\n· 인식(iso-v2·ctc-v1)·번역(t2gs-v2·g2ts-v1) 모델 설계·학습·평가·ONNX 경량화\n"
     "· 브라우저 추론(155차원 특징 일치), 아바타 리타게팅·손 깊이 복원\n· 복지관 현장 시연 진행(시연·구조 설명)",
     "모델 4종, 동작 사전 12,833종, 번역 사전 23만 낱말, 학습·검증 파이프라인, 자동 검사 체계"],
    ["류다영\n영남대학교\n컴퓨터공학과\n학사과정", "서비스 기획\n당사자 화면(UX)\n품질 검수\n대외 협력",
     "· 당사자 화면 4종(받기·묻기·대화·사전)·키오스크 흐름 기획, 한국어 의존을 줄인 화면 구성\n"
     "· 복지관 섭외·일정 조율, 현장 시연 참여(아바타 수어 확인·조작 안내), 당사자 평가 문항 설계와 진행 보조·결과 정리\n· 창구·일상 대화 문장 수집, 오역 사례 검수(회귀 사례 156건 구축 지원)\n"
     "· 재난 갈래·행동요령 문구 검토, 길찾기 답변 문장 검수\n· 보고서·발표자료·시연 영상 제작, 연구개발비 집행 관리",
     "화면 설계, 평가 문항·결과, 측정용 문장 집합, 보고서·발표자료"],
], widths=[2.8, 2.6, 7.6, 3.0], size=9.5)

h2("2. 단계별 세부 구현 계획")
table(TABS[4], ["단계", "기간", "계획", "결과"], [
    ["1단계", "7월", "데모 웹앱 · 아바타 리타게팅 · 규칙 기반 변환 MVP", "완료"],
    ["2단계", "8월 상순", "KOREN AI Cloud 구축 · AI Hub 실데이터 수신 · ETL", "완료(133GB · 40만 클립)"],
    ["3단계", "8월 중순", "번역·인식 모델 학습 · 브라우저 배포 · 양방향 왕복", "완료 + 계획 외 추가(오프라인·창구 대화·묻기)"],
    ["4단계", "8월 하순~9월", "연속 인식 · 일상어휘 편입 · 당사자 평가", "CTC 학습 완료(적용 보류), 당사자 평가 실시"],
    ["5단계", "10월", "KOREN 상시 서버 운영 · 현장 시연 준비", "KOREN VM 상시 서버 운영, 최종평가 시연 준비"],
], widths=[1.8, 2.6, 6.4, 5.2])
figure(IMG / "gantt.png", FIGS[3])
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
bullet("현장 시연 장비: 노트북(내장 웹캠·스피커)에 배포본을 저장해 실행 — 복지관 2곳에서 사용")
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
            (ASSET / "app_대화.png", "대화"), (ASSET / "app_사전.png", "사전")], FIGS[4])

table(TABS[5], ["모델", "구조·크기", "성능(측정값)", "앱 적용"], [
    ["iso-v2\n단어 인식", "랜드마크 트랜스포머 2.8M\nONNX int8 20MB · 13,576종", "무작위 대비 약 1만 배\n어휘 커버리지 98.9% · 수어자 격차 0.05%p", "적용"],
    ["t2gs-v2\n한국어→글로스", "음절 seq2seq 23.3M\nint8 30MB", "통계 사전 대비 BLEU +45% · 글로스 F1 약 3배\nint8 경량화 후 품질 저하 없음", "재난문자에 적용"],
    ["ctc-v1\n연속 인식", "CTC · 8,147종", "학습 완료(학습 135,446 · 검증 6,617클립)\n디코딩 파이썬↔브라우저 100% 일치", "보류(클래스 집합 불일치)"],
    ["g2ts-v1\n글로스→한국어", "seq2seq", "재난 문장에서 사람 번역과 글자까지 일치하는 출력 확인", "보류(일상어 도메인 불일치)"],
], widths=[2.8, 4.2, 6.0, 3.0], size=10)

h2("2. KOREN 연동 및 활용 결과")
para("KOREN 자원 셋은 성격이 완전히 달라, 하나로 모든 일을 하려 하면 어느 쪽도 제대로 되지 않는다. "
     "그래서 멘토링(7/23 KOREN 자원 활용 미팅)에 따라 역할을 나누었다. 핵심은 '옮기는 것이 작다'는 점이다. "
     "원본 영상은 수백 GB라 옮기지 않고, 랜드마크 팩(프레임당 약 0.5KB)과 모델 파일(수십 MB)만 넘긴다.")
wide_figure(IMG / "pipeline.png", FIGS[5])
table(TABS[6], ["자원", "사양", "활용 내용 및 결과"], [
    ["AI Cloud\n(CHEETAH)", "H200 MIG 1g.35GB\nvCPU 16 · RAM 128Gi", "AI Hub 실데이터 133GB를 KOREN으로 수신하고 무해제 스트리밍 ETL로 40만 클립 가공. "
     "인식·번역 모델 4종(iso-v2·t2gs-v2·ctc-v1·g2ts-v1) 학습·평가·ONNX 내보내기. 에폭당 21~25분에 215만 세그먼트 처리."],
    ["HPC 이노베이션 허브", "Xeon Gold VM\nPBS Torque", "8/5 활용 교육 이수. 영상 → 랜드마크 변환을 클립 단위로 나누는 샤딩 옵션과 PBS 잡 스크립트(ml/jobs/pbs_extract)를 구현해 저장소에 포함. "
     "이번 학습은 AI Hub가 함께 제공하는 OpenPose 키포인트로 진행해 영상 변환이 필요하지 않았다. HPC 잡은 원본 영상을 MediaPipe로 재추출해 학습·추론 검출기를 완전히 일치시키는 다음 단계(다각도 영상)에 쓰도록 준비했다."],
    ["KOREN VM", "NOC 발급 SSH", "2026년 9월부터 상시 데모 서버로 운영. 빌드된 웹앱(PWA)과 모델·동작 사전·장소 목록을 원천 배포해 심사·시연에서 언제든 열리게 했다. 공개 미러는 GitHub Pages(biocode67.github.io/signbridge)."],
], widths=[3.0, 3.6, 9.4], size=10)
para("KOREN 활용의 설계상 의미는 다음과 같다.")
bullet("MIG는 메모리는 넉넉하고 연산이 부족하다(FP32 17.14 TFLOPS, H200 전체의 약 29%). 이에 맞춰 영상 CNN 대신 랜드마크 트랜스포머를 골라 13,576종 분류를 학습 가능한 범위로 만들었다.")
bullet("AI Hub 배포본의 함정(확장자는 .zip이나 실제 7z 통짜 압축, 메타데이터 중첩, 파일명 표기 불일치, 좌표 단위 혼재, 깊이 추정 실패값 등)을 원본을 직접 열어 확인하고, 한 번만 훑는 스트리밍 처리로 대용량을 연구망 안에서 가공했다.")
bullet("영상 대신 관절 좌표를 전송·처리하므로 문장당 약 2.4KB로, 영상 대비 약 1/2,000이다. 저지연·다지점 송출 시 네트워크 부담이 작다.")
para("설계(Ⅱ-1)와 비교한 구현 현황은 다음과 같다. 학습·전처리·배포를 맡는 Core와 단말은 구현·운영했고, 지역 노드 Edge 송출은 설계를 마치고 실회선 실측을 남겼다.")
table(TABS[7], ["설계 요소", "구현·운영한 것", "남은 것"], [
    ["Core · AI Cloud", "133GB 수신, 40만 클립 ETL, 모델 4종 학습, 에폭당 215만 세그먼트(21~25분)", "—"],
    ["Core · HPC", "샤딩 옵션 · PBS 잡 스크립트 구현, 활용 교육 이수", "다각도 영상 MediaPipe 재추출 분산 실행"],
    ["Core · KOREN VM", "상시 데모 서버 운영(웹앱·모델·동작 사전 원천 배포)", "재난문자 자동 수신 연동(공공데이터 키 필요)"],
    ["Edge · 지역 노드", "수어 패키지 형식(글로스+키포인트, 약 2.4KB/문장) 확정 — 영상의 약 1/2,000", "지역 노드 미러 배치 · 다지점 송출 종단 지연 실측"],
    ["단말", "기기 안 추론 · 오프라인 폴백 · 폰/태블릿/키오스크 실조작 검증", "—"],
], widths=[3.2, 7.6, 5.2], size=10)
para("현장 시연(경산·대구 복지관)은 배포본을 노트북에 내려받아 로컬로 실행했다. 복지관 현장은 별도 네트워크를 준비할 수 없는 환경이었고, "
     "이는 설계 원칙 ④(끊겨도 동작)의 단말 단독 경로를 실제 현장에서 검증한 셈이다. 두 복지관은 모두 KOREN 대구 노드 권역으로, "
     "Edge 설계가 적용되면 이 지역 단말은 대구 노드에서 수어 패키지를 받게 된다.")

h2("3. 멘토 의견에 따른 개선사항")
table(TABS[8], ["일자 · 멘토", "받은 의견", "반영 내용"], [
    ["7/23\nKOREN 자원 활용 미팅", "AI Cloud·HPC·VM 신청·활용 방법, 과제 기간 중 반드시 활용할 것", "자원별 역할 분담: AI Cloud는 학습, HPC는 CPU 전처리, KOREN VM은 상시 데모. 하나로 다 하려던 계획을 접음"],
    ["8/5\nHPC 이노베이션 허브 교육", "VM 구성, PBS Torque 스케줄러, 분산 작업 제출 방법", "영상→랜드마크 변환을 HPC로 분리하는 분산 설계 확정, 샤딩 옵션·PBS 잡 스크립트 구현"],
    ["8/7\nKOREN AI Cloud 교육", "GPU 워크스페이스·볼륨 운영, MIG 연산 특성", "볼륨 운영 원칙 수립(홈은 패키지 전용, 데이터·체크포인트는 사용자 볼륨). MIG 제약에 맞춰 랜드마크 트랜스포머 채택"],
    ["지도교수 멘토링\n(컴퓨터공학)", "평가 수치의 신뢰성 확보, 실데이터 기반 검증, 실시간성·경량화", "수어자 분리 평가를 표준으로 고정, 학습에 없던 수어자 13명으로 이중 평가(검증과 격차 0.05%p). 브라우저 단독 추론으로 경량화"],
    ["지도교수 멘토링\n(사회복지학)", "농인의 한국어 문해력 편차 고려, 텍스트 중심 화면 지양, 실제 당사자 검증 필요", "한국어를 최소화한 당사자 화면 제작. 복지관 2곳 현장 시연(8월), 농인 당사자 평가(9~10월) 실시"],
    ["중간평가 이후\n자체 점검", "심사 항목 중 KOREN 활용도(20점)가 학습 자원 활용에 치우쳐 있음 — 서비스 송출 단계의 연구망 활용을 보여 줄 것", "Core·Edge·단말 3계층 설계 수립(Ⅱ-1), KOREN VM 상시 운영, 지역 노드 송출을 위한 수어 패키지 형식(약 2.4KB/문장) 확정"],
], widths=[3.4, 5.6, 7.0], size=10)

h2("4. 결과물의 통합 및 시험/검증 결과")
para("이 앱의 실패는 대부분 '화면은 정상인데 알맹이가 없는' 모양이다. 아바타가 조용히 서 있어도 한국어 자막은 떠 있고, "
     "방향이 뒤집혀도 화살표와 숫자는 그려진다. 그래서 성능을 눈이 아니라 수치로 재는 정량 평가와, 농인이 보고 뜻이 통하는지를 확인하는 정성 평가로 나누어 검증했다. "
     "정량 지표는 모두 저장소의 측정 스크립트가 다시 계산한 값이며, 인식은 수어자 분리, 번역은 튜닝에 쓰지 않은 홀드아웃을 기준으로 한다.")
h3("가. 정량 평가")
para("번역 · 인식 · 의도 판정 · 송출 · 일관성의 5개 축에서 24개 지표를 쟀다. 핵심 지표는 그림 7과 같다.")
wide_figure(IMG / "kpi.png", FIGS[6])
table(TABS[9], ["축", "지표", "측정값", "기준 · 의미"], merge_first=True, rows=[
    ["번역\n(한국어→수어)", "오역 회귀 통과율", "100% (156/156)", "한 번이라도 틀렸던 문장의 must/never 조건"],
    ["", "번역 글로스 재생 성공률", "100% (2,388/2,388)", "번역이 낸 글로스가 동작 사전에 실존·재생(371문장)"],
    ["", "낱말 표현률 — 행동요령 · 길찾기", "100% · 100%", "목숨이 걸린 안내·방향 안내 전 문장"],
    ["", "낱말 표현률 — 일상 · 재난문자", "96.9% · 95.8%", "한국어 낱말이 수어로 전달된 비율"],
    ["", "낱말 표현률 — 창구 대화 홀드아웃", "94.8%", "튜닝에 쓰지 않은 문장(일반화)"],
    ["", "정상 출력률 — 재난문자 · 길찾기", "98% · 100%", "디코딩 반복 차단 적용, 사람 정답에서 정한 기준"],
    ["", "학습 모델 BLEU 향상", "+45%", "통계 사전 대비, 사람 번역가 정답 기준"],
    ["", "학습 모델 글로스 F1 향상", "약 3배", "통계 사전 대비, 재난문자"],
    ["", "int8 경량화 후 품질", "저하 없음", "93MB(fp32) → 30MB(68% 축소), F1·BLEU 재측정"],
    ["인식\n(수어→한국어)", "무작위 대비 인식률", "약 10,600배", "13,576종 중 하나를 고르는 문제"],
    ["", "처음 보는 수어자 어휘 커버리지", "98.9%", "학습에 없던 수어자 평가 클립 기준"],
    ["", "검증 ↔ 처음 보는 수어자 격차", "0.05%p", "수어자를 외우지 않고 일반화"],
    ["", "연속 인식 디코딩 일치율", "100% (3,000/3,000)", "파이썬 ↔ 브라우저 CTC 디코딩"],
    ["의도 · 길찾기", "수어 의도 판정 정확도", "100% (27/27)", "낱말 묶음 → 의도, 오검출 0"],
    ["", "의도 낱말 실존율", "100% (47/47)", "의도 판정 낱말이 인식 클래스에 실존"],
    ["", "재난 갈래 한국어 이름 실존율", "100% (41/41)", "재난 갈래별 안내 이름"],
    ["", "도심 대피소 근접성", "350m · 450m · 350m", "서울·부산·광주 시청에서 가장 가까운 대피소"],
    ["송출 · KOREN", "송출 데이터 절감률", "99.95%", "문장당 약 2.4KB, 영상 대비 1/2,000"],
    ["", "문장 번역 지연", "144ms", "브라우저 1스레드, int8 30MB"],
    ["", "영상 외부 전송량", "0", "관절 좌표만 기기 안에서 처리"],
    ["일관성 · 아바타", "학습↔추론 특징 일치", "100% (오차 0)", "155차원 특징, 파이썬 ↔ 브라우저"],
    ["", "손 깊이(z) 수록률", "96%", "동작 사전 조각 기준"],
    ["", "손가락 뼈 길이 안정도 개선", "22%", "변동계수 0.182 → 0.142"],
    ["", "실조작 자동 검증 통과율", "100%", "폰·태블릿·키오스크·오프라인"],
], widths=[2.4, 5.0, 3.8, 4.8], size=9.5)
h3("(1) 수어 낱말 인식 — 수어자 분리 평가")
para("같은 사람이 학습과 평가에 함께 있으면 모델이 그 사람의 버릇을 외워 정확도가 부풀려진다. 본 보고서의 인식 수치는 모두 수어자 단위로 분리해 잰 값이다. "
     "모델은 13,576종 가운데 하나를 고르며, 무작위로 고를 때보다 약 1만 배 높은 정확도를 낸다. 학습에 없던 수어자 13명(49,721표본)으로 다시 재어도 "
     "검증치와의 차이가 0.05%p에 불과해, 특정 사람의 버릇을 외운 것이 아니라 처음 보는 사람에게도 그대로 일반화됨을 확인했다. 그 평가 클립의 어휘 98.9%를 모델이 다룰 수 있다. "
     "iso-v2는 클래스를 1.7배(8,147 → 13,576) 늘렸는데도 같은 수준의 성능을 유지했다. 또한 앱은 인식 후보 5개를 함께 보여 주어, 농인이 손가락 한 번으로 바로잡은 뒤에만 음성으로 내보낸다. "
     "재난 현장에서 잘못된 말이 그대로 전달되지 않게 하는 이중 안전장치다.")
h3("(2) 번역 품질 — 표현률과 오역을 따로 잰다")
para("표현률은 '낱말이 수어로 나갔는가'만 잰다. 실제로 복합어 처리 버그로 \"어디가 아프신지\"가 '어디 아프다 신다(신발)'로 번역되던 동안에도 표현률은 그대로였다. "
     "그래서 맞게 나갔는지는 오역 회귀 사례(must/never) 156건으로 따로 검사해 100% 통과를 유지한다. 행동요령과 길찾기처럼 틀리면 위험한 영역은 표현률 100%다.")
table(TABS[10], ["영역", "표현률", "비고"], [
    ["행동요령", "100%", "사전 경로(명령 말투)"],
    ["길찾기", "100%", "방위어 오역 수정 후"],
    ["일상회화", "96.9%", "통계 사전 경로"],
    ["재난문자", "95.8%", "학습 모델 t2gs-v2 경로"],
    ["창구 대화(홀드아웃)", "94.8%", "튜닝에 쓰지 않은 문장 — 일반화"],
], widths=[4, 3, 9])
h3("(3) 화면으로는 안 보이는 실패를 잡은 사례")
bullet("부정 손실: '안'·'못'이 한 글자라 '너무 짧다'는 규칙에 걸려 버려져, \"약을 안 먹었어요\"가 '약 먹다'로 뜻이 뒤집혔다. 안→아니다, 못→못하다로 고정하고 회귀 사례에 넣었다.")
bullet("방향 오역: '북동쪽'이 'km 지진 크기'로 번역되고 있었다. 방위어를 고정하고 길찾기 검사에 넣었다.")
bullet("도메인 오적용: 학습 모델이 행동요령 \"엘리베이터를 타지 말고 계단으로 대피하세요\"를 엉뚱한 글로스로 냈다. 목숨이 걸린 안내라 행동요령은 사전으로 분기했다.")
bullet("모델 미적용 판단: ctc-v1은 클래스 집합(8,147종)이 배포 모델(13,576종)과 달라 교체 시 '화장실' 의도가 오류 없이 사라진다. g2ts-v1은 재난 문장에서는 사람 번역과 글자까지 같은 출력을 내지만 일상 글로스 \"머리 아프다\"를 \"오늘 아침 기온이 크게 오르고 있습니다\"로 바꿔, 직원이 농인의 말을 잘못 듣게 된다. 둘 다 측정 후 적용하지 않았다.")
h3("(4) 자동 시험 체계")
table(TABS[11], ["검사", "내용", "결과"], [
    ["특징 일치", "파이썬 학습 ↔ 브라우저 추론 155차원 특징 대조", "오차 0"],
    ["CTC 디코딩 일치", "파이썬 ↔ 브라우저", "3,000판 전부 일치"],
    ["오역 회귀", "한 번이라도 틀렸던 문장 must/never", "156건 통과"],
    ["재생 확인", "번역이 낸 글로스가 동작 사전에 실존·재생되는가", "371문장 2,388개 전부"],
    ["의도 판정", "수어 낱말 묶음 → 의도(오검출 포함)", "27/27"],
    ["의도 낱말 실존", "의도 판정 낱말이 인식 클래스에 있는가", "47/47"],
    ["재난 갈래 이름", "재난 갈래별 한국어 이름", "41/41"],
    ["길찾기", "거리·방위·어림수·15km 차단", "통과"],
    ["실조작 e2e", "폰·태블릿(가로/세로)·키오스크·오프라인, 버튼 36px 이상·가로 스크롤 없음", "통과"],
], widths=[3.2, 8.8, 4.0], size=10)
figure_row([(ROOT / "e2e_폰.png", "폰 · 대화 시작(390×844)"), (ASSET / "app_묻기시작.png", "폰 · 묻기 시작"),
            (ASSET / "web_app_묻기.png", "데스크톱 · 묻기")], FIGS[7], width=4.6)
h3("나. 정성 평가")
para("정성 평가는 '농인이 보고 뜻이 통하는가, 실제로 쓸 수 있는가'를 본다. 숫자로는 재지 못하는 이해도·자연스러움·사용성·현장 적합성을 "
     "현장 시연(8월, 2곳)과 당사자 평가(9월, 경산)에서 직접 확인했다.")
table(TABS[12], ["평가 항목", "방법", "결과"], [
    ["이해도", "재난문자 예문을 아바타 수어로 보고 뜻을 되말하기", "낱말 단위는 실제 수어자 동작이라 알아보기 쉬움 · 문장 어순은 보완 필요"],
    ["사용성", "안내 없이 받기 → 묻기 → 대화 순으로 직접 조작", "방향·거리·지도를 함께 주는 묻기 답이 이해를 도움 · 탭 4개 구성으로 길을 잃지 않음"],
    ["접근성", "수어 비사용 이용자 · 고령 이용자 관찰", "중도 실청 이용자를 위한 '눌러서 묻기'(질문 카드·필담) 경로가 실제로 필요함을 확인"],
    ["현장 적합성", "복지관 창구 · 노트북 화면 · 통신 없는 환경", "배포본을 로컬로 실행해 통신 없이 동작 · 화면 크기에 따라 손이 작아지는 문제 확인"],
    ["자연스러움", "고개 동작 · 표정 유무에 대한 의견", "표정이 없는 점이 아쉽다는 의견 → 고개 끄덕임·흔들기 반영, 눈썹은 근거 데이터 확보 후"],
], widths=[2.6, 5.6, 7.8], size=10)
para("숫자는 '낱말이 나갔는가/맞게 나갔는가'까지만 잰다. 농인이 보고 뜻이 통하는지는 다른 질문이라, "
     "8월에 경산시장애인종합복지관과 대구광역시청각언어장애인복지관에서 수어 이용자에게 직접 시연하고 피드백을 받았다. "
     "화면 크기·보는 거리에 따라 손이 작아져 읽히는 정도가 달라진다는 점, 세대·지역에 따른 수어 차이, 수어를 쓰지 않는 중도 실청 이용자를 위한 '눌러서 묻기' 경로의 필요를 확인했다.")
para("이어 2026년 9월, 경산시장애인종합복지관에서 수어 이용자를 대상으로 당사자 평가를 실시하였다. 8월 시연이 '보여 주고 의견 듣기'였다면, "
     "당사자 평가는 실제 사용 순서대로 직접 조작하게 하고 막히는 지점을 기록하는 방식으로 진행했다.")
bullet("평가 순서: ① 받기 — 재난문자 예문을 아바타 수어로 보고 뜻을 되말하기 ② 묻기 — 카메라 앞에서 '대피소 어디' 등을 수어로 묻고 답(방향·거리·지도) 이해하기 ③ 대화 — 창구 상황에서 질문 카드·필담으로 답하기 ④ 화면 크기·글씨·조작 난이도 의견")
bullet("평가 관점: 낱말이 읽히는가, 문장 어순이 자연스러운가, 손이 화면에서 잘리거나 작아 보이지 않는가, 고개 동작·표정이 없을 때 뜻이 달라지는가")
bullet("확인한 것: 낱말 단위 수어는 실제 수어자의 동작이라 알아보기 쉬웠으나, 문장 단위에서는 한국어 어순이 남은 부분과 표정이 없는 점이 아쉽다는 의견이 나왔다. "
       "묻기 화면처럼 수어 답에 방향 화살표·지도·거리를 함께 보여 주는 방식은 이해를 돕는 것으로 확인했다.")
bullet("반영: 행동요령 등 목숨이 걸린 문장은 학습 모델 대신 검증된 사전 경로로 고정하고, 고개 끄덕임·흔들기를 반영했다. 눈썹 방향(의문문 구분)은 근거 데이터가 없어 지어내지 않고 후속 과제로 남겼다.")
figure_grid([(PHOTO / "08.jpg", "경산시장애인종합복지관(8월 시연 · 9월 당사자 평가)"), (PHOTO / "09.jpg", "대구광역시청각언어장애인복지관(8월 시연)")], FIGS[8])
para("현장 시연에는 김주형·류다영 두 팀원이 함께 방문했다. 수어 이용자 옆에 앉아 앱을 직접 소개하고, 조작을 도우며 어디서 막히는지 관찰했다. 아바타 수어를 함께 보며 무엇이 읽히고 무엇이 안 읽히는지 확인했고, "
     "4개 에이전트의 동작 원리와 기대효과를 설명한 뒤 의견을 들었다.")
figure_grid([(PHOTO / "01.jpg", "김주형 — 수어 이용자에게 앱을 직접 시연"), (PHOTO / "02.jpg", "김주형 — 질의응답(묻기) 화면을 함께 확인"),
             (PHOTO / "03.jpg", "김주형 — 옆에서 조작을 도우며 관찰"), (PHOTO / "07.jpg", "김주형 — 4개 에이전트 구조 설명")], FIGS[9])
figure_grid([(PHOTO / "04.jpg", "류다영 — 아바타 수어를 함께 보며 확인"), (PHOTO / "05.jpg", "류다영 — 화면 조작 안내와 의견 청취")], FIGS[10])
table(TABS[13], ["현장에서 확인한 것", "대응"], [
    ["노트북 화면에서는 손이 작아진다. 화면 크기와 앉는 거리에 따라 읽히는 정도가 달라졌다", "키오스크 모드(큰 글씨·전체 화면), 아바타를 크게 보는 화면 구성 · 당사자 평가 항목에 '손이 잘려 보이는지' 추가"],
    ["같은 뜻이라도 세대·지역에 따라 쓰는 동작이 다르다", "실제 수어자 여러 명의 데이터로 학습하고 수어자 분리로 평가 · 당사자 평가에서 어휘 차이를 수집"],
    ["수어를 쓰지 않는 중도 실청 이용자도 있었다", "수어 없이 눌러서 묻는 경로(질문 카드·필담)를 대화·묻기 화면에 유지"],
    ["어순의 자연스러움, 표정이 없는 것을 어떻게 느끼는지는 그 자리에서 판단하기 어렵다", "9~10월 정식 당사자 평가 항목으로 넘겨 측정"],
], widths=[7.5, 8.5], size=10)
page_break()

# ── Ⅳ 결론 ──────────────────────────────────────────
chapter("Ⅳ", "결 론")
h2("1. 개발 최종 결과물")
para("본 과제의 최종 결과물은 서버 없이 브라우저 안에서 양방향으로 동작하는 한국수어 통역 앱 SignBridge와, 이를 만든 학습·검증 파이프라인이다.")
bullet("웹앱(PWA): 받기·묻기·대화·사전 4개 탭, 키오스크 모드, 오프라인 동작. 공개 주소 https://biocode67.github.io/signbridge/ 및 KOREN VM 상시 서버")
bullet("학습 모델: 수어 낱말 인식 iso-v2(13,576종), 한국어→글로스 t2gs-v2(int8 30MB) 앱 탑재. 연속 인식 ctc-v1, 글로스→한국어 g2ts-v1 학습 완료(적용 보류)")
bullet("데이터 자산: 동작 사전 12,833종(손 깊이 포함), 번역 사전 230,240낱말, 전국 장소 28,125곳(대피소 14,134곳)")
bullet("검증 체계: 특징 일치·오역 회귀·재생 확인·의도 판정·길찾기·실조작 e2e 등 자동 검사, 판단 기록(DECISIONS.md)")
para("남은 한계와 향후 과제는 다음과 같다. 숨기지 않고, 무엇이 있으면 풀리는지까지 적는다.", before=6)
bullet("연속 수어: CTC 모델은 학습되었으나 클래스 집합이 달라 단독 교체 시 일부 의도가 사라진다. 이어서 한 수어 표본을 받아 iso-v2와 병행 적용 여부를 정한다.")
bullet("지문자(이름·지명): 클립 17,000개·지명 1,015종·자모 37종 데이터를 확인했으며, 키포인트를 받아 자모 CTC를 학습하면 처음 보는 이름도 읽을 수 있다.")
bullet("표정(비수지): 눈썹 방향은 원본 서술이 비어 있어 지어내지 않았다. 고개 동작·마우징부터 반영한다.")
bullet("공식 대피소 목록: 현재 OSM 기반 참고용이다. 공공데이터포털 인증키로 행정안전부 공식 목록으로 교체한다.")
bullet("KOREN Edge: 지역 노드에 수어 패키지 미러를 두고 다지점 송출 종단 지연을 실측한다(Ⅱ-1 설계).")

h2("2. 기술 구현에 따른 기대 효과")
figure(PHOTO / "06.jpg", FIGS[11], width=11)
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
    "KOREN, \"Introduction\" · \"International Activities\", https://koren.kr/en/about",
    "스마트투데이, \"KT, KOREN 1Tbps 백본망 구축\" 및 2025년 12월 KOREN 백본 7Tbps급 확장 보도.",
]
for i, r_ in enumerate(refs, 1):
    p = para(f"[{i}]  {r_}", size=12, indent=0.8)
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.first_line_indent = Cm(-0.8)
page_break()

# ── 별첨 회의록 ──────────────────────────────────────
chapter("별첨", "회의록")
MEETINGS = [
    ("킥오프 회의", "2026년 7월 3일, 14:00 ~ 16:00", "영남대학교", [
        "과제 범위 확정: 재난정보 한국수어 통역을 '받기'만이 아닌 '묻기'까지 양방향으로 한다",
        "데이터: AI Hub 재난안전 수어영상·수어영상 말뭉치 사용, KOREN AI Cloud·HPC·VM 자원 신청",
        "역할 분담(모델·인프라 / 당사자·서비스)과 5단계 일정 수립, 7월 안에 데모 웹앱 MVP 완성"]),
    ("데이터 전략 회의", "2026년 8월 8일, 15:00 ~ 17:00", "영남대학교", [
        "KOREN AI Cloud 교육(8/7) 내용 공유: MIG는 메모리는 넉넉하고 연산이 부족 → 영상 CNN 대신 랜드마크 트랜스포머",
        "AI Hub 원본 구조 확인 결과 공유(7z 통짜 압축, 메타 중첩, 파일명 표기 FS·WORD 불일치) → 스트리밍 ETL로 처리",
        "평가는 수어자 분리로 고정, 발표하는 숫자는 측정 스크립트가 다시 계산한 값만 쓴다",
        "자원별 역할 확정: AI Cloud 학습 · HPC 전처리 · KOREN VM 상시 서버"]),
    ("중간평가 대비 회의", "2026년 8월 17일, 13:00 ~ 16:00", "영남대학교", [
        "중간보고서 수치 점검(인식 iso-v2 13,576종, 번역 표현률, 오역 회귀 사례)",
        "복지관 2곳 현장 시연 결과 정리 — 화면 크기, 세대·지역 차이, 눌러서 묻기 경로",
        "아직 안 되는 것(연속 수어·지문자·표정)을 숨기지 않고 먼저 밝히기로 결정",
        "9월 당사자 평가 대상 기관으로 경산시장애인종합복지관 선정"]),
    ("최종평가 준비 회의", "2026년 10월 10일, 14:00 ~ 16:00", "영남대학교", [
        "경산시장애인종합복지관 당사자 평가 결과 공유와 반영 사항 정리",
        "KOREN 활용 보강: Core·Edge·단말 3계층 설계 정리, KOREN VM 상시 운영 점검",
        "최종보고서·과제개요(10/18), 발표자료·시연 영상(10/28) 분담과 일정 확정"]),
]
for i, (name, when, where, items) in enumerate(MEETINGS):
    if i:
        page_break()
    para(f"■ {name}", bold=True, size=BIG - 1)
    para(f"o 일 시 : {when}", indent=0.4, after=0)
    para(f"o 장 소 : {where}", indent=0.4, after=0)
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
