"""회의록 '회의 사진' 칸에 넣을 회의 자료 화면 — 실제 저장소 문서·발표자료를 그대로 띄운 캡처."""
import re
from pathlib import Path

import markdown
from PIL import Image
from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
OUT = HERE / "img"
FONT_B = (ROOT / "ppt/제출/글꼴/Pretendard-Bold.ttf").as_uri()
FONT_R = (ROOT / "ppt/제출/글꼴/Pretendard-Regular.ttf").as_uri()
CSS = f"""
@font-face {{ font-family: P; src: url('{FONT_R}'); font-weight: 400; }}
@font-face {{ font-family: P; src: url('{FONT_B}'); font-weight: 700; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: #e9edf2; font-family: P, sans-serif; }}
.desk {{ display: flex; gap: 22px; padding: 26px; }}
.win {{ flex: 1; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,.14); }}
.bar {{ background: #1f2430; color: #c9d1d9; font-size: 15px; padding: 10px 14px; display: flex; gap: 8px; align-items: center; }}
.dot {{ width: 12px; height: 12px; border-radius: 50%; display: inline-block; }}
.doc {{ padding: 18px 26px; font-size: 15px; line-height: 1.55; color: #17202a; height: 820px; overflow: hidden; }}
.doc h1 {{ font-size: 24px; margin: 4px 0 10px; }} .doc h2 {{ font-size: 19px; margin: 14px 0 6px; color: #0b6e79; }}
.doc table {{ border-collapse: collapse; width: 100%; font-size: 13.5px; }} .doc td, .doc th {{ border: 1px solid #d6dce3; padding: 5px 7px; vertical-align: top; }}
.doc th {{ background: #eef2f7; }} .doc code {{ background: #f2f4f7; padding: 1px 4px; border-radius: 4px; font-size: 13px; }}
.doc pre {{ background: #f6f8fa; padding: 10px; border-radius: 8px; font-size: 12.5px; overflow: hidden; }}
.doc blockquote {{ color: #5b6673; border-left: 4px solid #d6dce3; margin: 6px 0; padding-left: 10px; }}
"""


def window(title, md_text):
    html = markdown.markdown(md_text, extensions=["tables", "fenced_code"])
    dots = "".join(f"<span class='dot' style='background:{c}'></span>" for c in ("#ff5f57", "#febc2e", "#28c840"))
    return f"<div class='win'><div class='bar'>{dots}<span style='margin-left:10px'>{title}</span></div><div class='doc'>{html}</div></div>"


def shoot(name, inner, w=1600, h=900):
    f = HERE / f"_{name}.html"
    f.write_text(f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body><div class='desk'>{inner}</div></body></html>", encoding="utf-8")
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1.5)
        pg.goto(f.as_uri())
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(OUT / f"{name}.png"))
        b.close()
    f.unlink()
    print("saved", name)


def section(text, start, end=None):
    a = text.index(start)
    b = text.index(end, a) if end else len(text)
    return text[a:b]


proposal = (ROOT / "PROPOSAL.md").read_text()
kickoff_l = section(proposal, "# 넷 챌린지", "## 4. KOREN")
kickoff_r = section(proposal, "## 6. 차별성", "## 9. 팀")
shoot("meet_kickoff", window("PROPOSAL.md — 기획안 초안", kickoff_l) + window("PROPOSAL.md — 차별성·일정", kickoff_r))

claude = (ROOT / "CLAUDE.md").read_text()
traps = section(claude, "## 실데이터에서 확인된 함정", "원본을 새로 받으면")
res = (ROOT / "ml/KOREN_RESOURCES.md").read_text()
res_part = section(res, "# KOREN 자원 3종", "## 3.")
shoot("meet_data", window("ml/KOREN_RESOURCES.md — 자원별 역할", res_part) + window("실데이터에서 확인된 함정", traps))


def pages(name, paths, w=1600, h=900):
    canvas = Image.new("RGB", (w, h), "#e9edf2")
    n = len(paths)
    gap = 24
    pw = (w - gap * (n + 1)) // n
    for i, pth in enumerate(paths):
        im = Image.open(pth).convert("RGB")
        im.thumbnail((pw, h - 2 * gap))
        x = gap + i * (pw + gap) + (pw - im.width) // 2
        canvas.paste(im, (x, (h - im.height) // 2))
    canvas.save(OUT / f"{name}.png")
    print("saved", name)


prev = ROOT / "ppt/preview"
pages("meet_midterm", [prev / "p-01.jpg", prev / "p-17.jpg"])
