#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""발표자료에 들어가는 그래프를 만든다.

    python3 ppt/build_charts.py

한 곳에서 색·글꼴·여백을 정해 슬라이드와 같은 인상을 준다.
제목·부제·꼬리말은 **그림 좌표**에 고정으로 찍는다 — 축 좌표에 걸면
가로 막대처럼 y라벨이 긴 그림에서 제목이 안으로 밀려 들어가 겹친다.
각 그림의 가로세로는 슬라이드 자리 크기와 같게 잡아 두었다.
"""
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = Path("ppt/assets")
OUT.mkdir(parents=True, exist_ok=True)

INK   = "#16181D"
MUT   = "#6B7280"
CY    = "#0EA5B7"
CY_L  = "#9BDCE4"
CY_D  = "#0A7C8A"
GRN   = "#2FA37A"
GREY  = "#C8D2DA"
GRID  = "#E7ECF1"
DPI   = 220

plt.rcParams.update({
    "font.family": "NanumSquare",
    "axes.unicode_minus": False,
    "figure.facecolor": "white",
    "axes.facecolor": "white",
    "text.color": INK,
    "axes.labelcolor": MUT,
    "xtick.color": MUT,
    "ytick.color": MUT,
    "axes.edgecolor": GRID,
})


def frame(ax, keep=()):
    """축 테두리를 최소로 — 눈금선이 막대를 이기지 않게 한다."""
    for side in ("top", "right", "left", "bottom"):
        ax.spines[side].set_visible(side in keep)
        if side in keep:
            ax.spines[side].set_color(GRID)
    ax.tick_params(length=0, labelsize=10.5)


def canvas(w, h, title, sub=None, note=None):
    """제목·부제·꼬리말 자리를 미리 떼어 놓고 축을 만든다."""
    fig = plt.figure(figsize=(w, h))
    top, bot = 1.0, 0.0
    fig.text(0.018, 0.955, title, fontsize=13.5, fontweight="bold", color=INK, va="top")
    top = 0.865
    if sub:
        fig.text(0.018, 0.845, sub, fontsize=9.8, color=MUT, va="top")
        top = 0.775
    if note:
        fig.text(0.018, 0.035, note, fontsize=9, color=MUT, va="bottom")
        bot = 0.115
    ax = fig.add_subplot(111)                # 자리는 tight_layout이 잡는다
    return fig, ax, (0, bot, 1, top)


def save(fig, ax, rect, name):
    fig.tight_layout(rect=rect)
    p = OUT / name
    fig.savefig(p, dpi=DPI, facecolor="white")
    plt.close(fig)
    print(f"  {p}")


def hbar(ax, names, vals, cols, fmt, xmax_pad=1.24, log=False):
    y = list(range(len(vals)))[::-1]
    ax.barh(y, vals, color=cols, height=0.55, zorder=3)
    for yy, v in zip(y, vals):
        gap = v * 0.10 if log else max(vals) * 0.016
        ax.text(v + gap, yy, fmt(v), va="center", fontsize=12.5, fontweight="bold", color=INK)
    ax.set_yticks(y)
    ax.set_yticklabels(names, fontsize=11, color=INK, linespacing=1.35)
    ax.grid(axis="x", color=GRID, lw=0.9, zorder=0)
    if not log:
        ax.set_xlim(0, max(vals) * xmax_pad)
    return y


# ───────────────────────────────────────── 1. 수어 낱말 인식 정확도
fig, ax, rect = canvas(
    6.4, 3.45, "수어 낱말 인식 정확도",
    "13,576종에서 하나를 고른다 · 수어자 단위로 분리해 학습·평가",
    "학습에 없던 수어자 13명 · 49,721표본 — 검증치와 같은 값이 나왔다")
labels = ["검증 세트\ntop-1", "처음 보는 수어자\ntop-1", "처음 보는 수어자\ntop-5"]
vals   = [78.2, 78.6, 91.9]
bars = ax.bar(labels, vals, color=[CY_L, CY, CY_D], width=0.5, zorder=3)
for b, v in zip(bars, vals):
    ax.text(b.get_x() + b.get_width() / 2, v + 2.4, f"{v}%",
            ha="center", fontsize=15, fontweight="bold", color=INK)
ax.set_ylim(0, 110)
ax.set_yticks([0, 25, 50, 75, 100])
ax.set_yticklabels(["0", "25", "50", "75", "100"])
ax.grid(axis="y", color=GRID, lw=0.9, zorder=0)
ax.set_axisbelow(True)
ax.tick_params(axis="x", labelsize=10.5, colors=INK)
frame(ax, keep=("bottom",))
save(fig, ax, rect, "chart_정확도.png")


# ───────────────────────────────────────── 2. 데이터 규모
fig, ax, rect = canvas(
    6.1, 3.30, "학습·서비스 데이터 규모",
    "AI Hub 수어 말뭉치를 직접 열어 확인하며 가공했다")
hbar(ax,
     ["동작 사전", "인식 클래스", "학습 문장쌍", "번역 낱말"],
     [12833, 13576, 200874, 230299],
     [CY, CY, CY_D, CY_D],
     lambda v: f"{v:,}")
ax.set_xticks([])
frame(ax)
save(fig, ax, rect, "chart_규모.png")


# ───────────────────────────────────────── 3. 번역 품질 (v1 → v2)
fig = plt.figure(figsize=(4.18, 2.35))
ax = fig.add_subplot(111)
groups = ["BLEU-4", "글로스 F1"]
v1, v2 = [21.9, 55.5], [27.1, 61.3]
x, w = [0, 1], 0.30
b1 = ax.bar([i - w / 2 for i in x], v1, width=w, color=GREY, zorder=3, label="이전 v1")
b2 = ax.bar([i + w / 2 for i in x], v2, width=w, color=CY, zorder=3, label="현재 v2")
for bars, vv in ((b1, v1), (b2, v2)):
    for b, v in zip(bars, vv):
        ax.text(b.get_x() + b.get_width() / 2, v + 1.8, f"{v}",
                ha="center", fontsize=11, fontweight="bold", color=INK)
ax.set_xticks(x)
ax.set_xticklabels(groups, fontsize=11, color=INK)
ax.set_ylim(0, 78)
ax.set_yticks([0, 20, 40, 60])
ax.grid(axis="y", color=GRID, lw=0.9, zorder=0)
ax.set_axisbelow(True)
frame(ax, keep=("bottom",))
ax.legend(frameon=False, fontsize=9.5, loc="upper left", bbox_to_anchor=(-0.02, 1.20),
          ncol=2, handlelength=1.0, columnspacing=1.4, labelcolor=MUT)
fig.tight_layout(rect=(0, 0, 1, 0.90))
fig.savefig(OUT / "chart_번역.png", dpi=DPI, facecolor="white")
plt.close(fig)
print(f"  {OUT / 'chart_번역.png'}")


# ───────────────────────────────────────── 4. 도메인별 낱말 표현률
fig, ax, rect = canvas(
    6.25, 3.35, "도메인별 낱말 표현률",
    "한국어 낱말이 수어로 나갔는가 — 맞게 나갔는지는 따로 쟀다",
    "창구 대화 홀드아웃(튜닝에 쓰지 않은 문장) 94.8%")
hbar(ax,
     ["행동요령", "길찾기", "일상회화", "재난문자", "창구 대화"],
     [100.0, 100.0, 96.9, 96.1, 93.5],
     [GRN, GRN, CY, CY, CY],
     lambda v: f"{v:.1f}%", xmax_pad=1.16)
ax.set_xlim(0, 118)
ax.set_xticks([0, 50, 100])
ax.set_xticklabels(["0", "50", "100%"], fontsize=9.5)
frame(ax, keep=("bottom",))
save(fig, ax, rect, "chart_표현률.png")


# ───────────────────────────────────────── 5. 자동 검증 건수
fig, ax, rect = canvas(
    6.25, 3.20, "자동 검사 — 전 항목 통과",
    "매 변경마다 실행한다",
    "가로축은 로그 눈금 — 건수 차이가 커서 한 화면에 담기 위한 것이다")
ax.set_xscale("log")
hbar(ax,
     ["CTC 디코딩 일치", "오역 회귀 사례", "앱 실조작", "수어 의도 판정"],
     [3000, 137, 129, 27],
     [CY_D, CY, CY, CY_L],
     lambda v: f"{v:,}", log=True)
ax.set_xlim(10, 7000)
ax.set_xticks([10, 100, 1000])
ax.set_xticklabels(["10", "100", "1,000"], fontsize=9.5)
frame(ax, keep=("bottom",))
save(fig, ax, rect, "chart_검증.png")


print("그래프 5장을 다시 만들었습니다.")
