# -*- coding: utf-8 -*-
"""대본 HTML/TXT 생성 — 녹화하면서 읽는 것이 목적이다."""
import html, pathlib, sys
sys.path.insert(0, ".")
from script_data import SCENES, CHECK, NUMBERS, DONT, QA

e = html.escape
STAR = {0:"", 1:"★", 2:"★★", 3:"★★★"}

def rows_html(rows):
    out = []
    for kind, txt in rows:
        t = e(txt).replace("\n", "<br>")
        if kind == "say":
            out.append(f'<p class="say">{t}</p>')
        elif kind == "end":
            out.append(f'<p class="say end">{t}</p>')
        elif kind == "wait":
            out.append(f'<p class="wait">⏸ {t}</p>')
        else:
            out.append(f'<p class="do">▶ {t}</p>')
    return "\n".join(out)

nav = "".join(
    f'<a href="#s{s["no"]}"><b>{s["no"]}</b> {e(s["title"])}<span>{s["t"]}</span></a>'
    for s in SCENES)

scenes = "\n".join(f'''
<section id="s{s["no"]}">
  <h2><span class="n">{s["no"]}</span> {e(s["title"])}
      <em>{s["t"]}</em>{f'<i class="st">{STAR[s["star"]]}</i>' if s["star"] else ''}</h2>
  <p class="where">{e(s["where"])}</p>
  {rows_html(s["rows"])}
</section>''' for s in SCENES)

check = "".join(f'<label><input type="checkbox"> {e(c)}</label>' for c in CHECK)
nums = "".join(f'<tr><td>{e(a)}</td><th>{e(b)}</th><td class="sub">{e(c)}</td></tr>'
               for a,b,c in NUMBERS)
dont = "".join(f'<tr><td class="x">{e(a)}</td><td class="sub">{e(b)}</td></tr>' for a,b in DONT)
qa = "".join(f'<div class="qa"><p class="q">Q. {e(q)}</p><p class="say">{e(a)}</p></div>'
             for q,a in QA)

doc = f'''<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>시연 대본 · SignBridge</title>
<style>
:root{{--bg:#fff;--fg:#16181d;--mut:#6b7280;--line:#e5e7eb;--say:#fffdf3;--sayb:#f0a92e;
       --do:#eefaf4;--dob:#0a9c6c;--card:#f8f9fb}}
html[data-dark]{{--bg:#12141a;--fg:#e8eaf0;--mut:#9aa2b1;--line:#2a2e3a;--say:#241f10;
       --sayb:#e8a33d;--do:#0f2a22;--dob:#22c58f;--card:#191c24}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--fg);
  font:17px/1.7 -apple-system,BlinkMacSystemFont,'Malgun Gothic','맑은 고딕',sans-serif}}
.wrap{{max-width:900px;margin:0 auto;padding:0 22px 90px}}
header{{position:sticky;top:0;z-index:9;background:var(--bg);border-bottom:1px solid var(--line);
  padding:14px 0 10px;margin-bottom:8px}}
h1{{font-size:22px;margin:0 0 4px}}
.meta{{color:var(--mut);font-size:14px;margin:0 0 10px}}
nav{{display:flex;gap:6px;flex-wrap:wrap}}
nav a{{flex:1 1 150px;text-decoration:none;color:inherit;background:var(--card);
  border:1px solid var(--line);border-radius:9px;padding:7px 10px;font-size:13px;line-height:1.35}}
nav a b{{display:inline-block;min-width:17px}}
nav a span{{display:block;color:var(--mut);font-size:11px}}
.tools{{position:fixed;right:16px;bottom:16px;display:flex;gap:8px;z-index:20}}
.tools button{{font:600 14px/1 inherit;padding:11px 14px;border-radius:10px;
  border:1px solid var(--line);background:var(--card);color:inherit;cursor:pointer}}
h2{{font-size:20px;margin:36px 0 4px;padding-top:14px;border-top:2px solid var(--fg);
  display:flex;align-items:center;gap:9px}}
h2 .n{{background:var(--fg);color:var(--bg);border-radius:50%;width:27px;height:27px;
  display:grid;place-items:center;font-size:15px;flex:none}}
h2 em{{font-style:normal;color:var(--mut);font-size:14px;font-weight:500;margin-left:auto}}
h2 .st{{font-style:normal;color:#e0641a;font-size:14px}}
.where{{color:var(--mut);font-size:14px;margin:0 0 14px 36px}}
.say{{font-size:21px;font-weight:600;line-height:1.75;background:var(--say);
  border-left:6px solid var(--sayb);border-radius:0 10px 10px 0;padding:15px 18px;margin:12px 0}}
.say.end{{font-size:25px;border-left-width:10px}}
.do{{background:var(--do);border-left:6px solid var(--dob);border-radius:0 10px 10px 0;
  padding:11px 16px;margin:12px 0;font-size:16px;font-weight:600}}
.wait{{color:var(--mut);font-size:15px;margin:10px 0 10px 6px}}
label{{display:block;background:var(--card);border:1px solid var(--line);border-radius:9px;
  padding:11px 14px;margin:7px 0;font-size:16px;cursor:pointer}}
label input{{margin-right:9px;transform:scale(1.25)}}
table{{width:100%;border-collapse:collapse;margin:10px 0;font-size:15px}}
td,th{{border-bottom:1px solid var(--line);padding:9px 8px;text-align:left;vertical-align:top}}
th{{white-space:nowrap;font-size:17px}}
.sub{{color:var(--mut);font-size:13px}}
.x{{color:#c0392b;font-weight:700}}
.qa{{margin:20px 0}}
.q{{font-weight:800;font-size:17px;margin:0 0 6px}}
h3{{font-size:18px;margin:44px 0 8px;padding-bottom:5px;border-bottom:2px solid var(--line)}}
.warn{{background:#fff4f4;border:1px solid #f3c4c4;border-radius:10px;padding:13px 16px;
  font-size:15px;color:#8c2b2b}}
html[data-dark] .warn{{background:#2a1717;border-color:#5a2c2c;color:#f0b4b4}}
html[data-big] body{{font-size:20px}}
html[data-big] .say{{font-size:27px}}
html[data-big] .say.end{{font-size:31px}}
html[data-big] .do{{font-size:19px}}
@media print{{
  header{{position:static}} nav,.tools{{display:none}}
  body{{font-size:12pt;background:#fff;color:#000}}
  .say{{font-size:14pt;background:#f7f2e2}} h2{{page-break-after:avoid}}
  section{{page-break-inside:avoid}}
}}
</style>
<div class="wrap">
<header>
  <h1>시연 대본 · SignBridge</h1>
  <p class="meta">전체 4분 30초 · 말할 분량 약 3분 · <b>5분을 넘기면 시연 미진행으로 간주됩니다</b></p>
  <nav>{nav}</nav>
</header>

<h3>읽는 법</h3>
<p class="say" style="font-size:17px">노란 칸은 <b>소리 내어 말할 것</b>입니다. 그대로 읽으셔도 됩니다.</p>
<p class="do">초록 칸은 <b>누르거나 할 것</b>입니다.</p>
<div class="warn"><b>규정</b> — 자막·화면전환효과·배경음악·인트로를 넣으면 감점입니다.
화면 녹화 그대로 두고 <b>말로만</b> 설명하세요. 한 번에 쭉 찍는 편이 안전합니다.</div>

<h3>녹화 전 확인</h3>
{check}

{scenes}

<h3>말해도 되는 숫자 — 전부 실제로 잰 값입니다</h3>
<table>{nums}</table>

<h3>말하면 안 되는 것 — 재지 않은 것</h3>
<table>{dont}</table>

<h3>질문이 나오면</h3>
{qa}
</div>

<div class="tools">
  <button onclick="var h=document.documentElement;h.hasAttribute('data-big')?h.removeAttribute('data-big'):h.setAttribute('data-big','')">글씨 크게</button>
  <button onclick="var h=document.documentElement;h.hasAttribute('data-dark')?h.removeAttribute('data-dark'):h.setAttribute('data-dark','')">어둡게</button>
  <button onclick="print()">인쇄</button>
</div>
</html>'''

out = pathlib.Path.home()/"deploy"
(out/"script.html").write_text(doc, encoding="utf-8")

# 텍스트판 — 메모장에서도 읽히게
lines = ["시연 대본 · SignBridge", "전체 4분 30초 · 말할 분량 약 3분",
         "※ 5분을 넘기면 시연 미진행으로 간주됩니다", "",
         "[규정] 자막·화면전환효과·배경음악·인트로 금지. 말로만 설명하세요.", "",
         "=" * 60, "녹화 전 확인", "=" * 60]
lines += [f"  [ ] {c}" for c in CHECK]
for s in SCENES:
    lines += ["", "=" * 60, f"장면 {s['no']} · {s['title']}   ({s['t']}) {STAR[s['star']]}",
              f"  위치: {s['where']}", "=" * 60]
    for kind, txt in s["rows"]:
        if kind in ("say", "end"):
            lines += ["", "  『" + txt + "』"]
        elif kind == "wait":
            lines += [f"  (대기) {txt}"]
        else:
            lines += [f"  ▶ {txt}"]
lines += ["", "=" * 60, "말해도 되는 숫자", "=" * 60]
lines += [f"  {a:14s} {b:16s} {c}" for a, b, c in NUMBERS]
lines += ["", "=" * 60, "말하면 안 되는 것", "=" * 60]
lines += [f"  X {a}  →  {b}" for a, b in DONT]
lines += ["", "=" * 60, "질문이 나오면", "=" * 60]
for q, a in QA:
    lines += ["", f"  Q. {q}", f"  A. {a}"]
(out/"script.txt").write_text("﻿" + "\r\n".join(lines), encoding="utf-8")
print("html", (out/'script.html').stat().st_size, "· txt", (out/'script.txt').stat().st_size)
