"""현장 사진의 복지관 이용자(팀원 외) 얼굴을 흐리게 — 책자 배포용.

좌표는 원본(1920×1080) 기준으로 사람이 눈으로 확인해 잡았다. 팀원(김주형·류다영) 얼굴은 건드리지 않는다.
타원 = (cx, cy, rx, ry), 사각 = (x0, y0, x1, y1).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "ppt/photos"
OUT = Path(__file__).parent / "photos"
OUT.mkdir(exist_ok=True)

ELL = {
    "01": [(897, 387, 100, 120), (630, 352, 75, 85), (728, 225, 50, 60), (645, 150, 35, 45)],
    "02": [(1560, 240, 120, 170)],
    "03": [],
    "04": [],
    "05": [(867, 203, 105, 125), (878, 15, 70, 45), (1822, 38, 80, 70)],
    "06": [(1050, 420, 115, 150), (458, 210, 55, 65), (1110, 143, 45, 55), (982, 98, 30, 35),
           (765, 30, 55, 50), (1425, 165, 60, 70), (1252, 45, 30, 40), (1380, 98, 30, 35)],
    "07": [(652, 360, 115, 145), (45, 420, 65, 95)],
}
RECT = {
    "01": [(0, 110, 560, 300)],
    "03": [(0, 0, 1170, 240), (1610, 0, 1920, 240)],
    "04": [(0, 0, 1920, 185)],
}

for name in ["01", "02", "03", "04", "05", "06", "07"]:
    im = Image.open(SRC / f"{name}.jpg").convert("RGB")
    blurred = im.filter(ImageFilter.GaussianBlur(28))
    mask = Image.new("L", im.size, 0)
    d = ImageDraw.Draw(mask)
    for cx, cy, rx, ry in ELL.get(name, []):
        d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    for box in RECT.get(name, []):
        d.rectangle(box, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(12))
    Image.composite(blurred, im, mask).save(OUT / f"{name}.jpg", quality=92)
for name in ["08", "09"]:
    Image.open(SRC / f"{name}.jpg").save(OUT / f"{name}.jpg", quality=95)
print("saved", OUT)
