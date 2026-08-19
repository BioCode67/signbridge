#!/usr/bin/env bash
# 노트북에서 바로 여는 판을 만든다 — 인터넷도 계정도 필요 없다.
#
#   npm run build && bash deploy/make_laptop_zip.sh
#   → ~/deploy/signbridge-노트북용.zip  (약 188MB)
#
# **왜 이것이 필요한가.** 시연은 남의 건물에서 한다. 와이파이가 느리거나 막혀
# 있을 수 있고, 이 워크스페이스와의 연결도 끊긴다. 정적 파일 한 벌만 있으면
# 노트북에서 그대로 돌아간다 — 인식·번역·아바타가 전부 브라우저 안에서 돈다.
#
# 더블클릭 실행 파일을 함께 넣는다. 발표 직전에 터미널을 치게 하면 안 된다.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f dist/index.html ] || { echo "dist가 없습니다. 먼저 npm run build"; exit 1; }

# 서버.ps1 — 파이썬이 없는 윈도우에서 쓰는 대비책. 윈도우 기본 PowerShell만 쓴다.
cp deploy/laptop/시작하기_윈도우.bat deploy/laptop/시작하기_맥.command \
   deploy/laptop/읽어주세요.txt deploy/laptop/서버.ps1 dist/
# 대본도 함께 넣는다 — 촬영하면서 읽을 것이라 같은 폴더에 있어야 편하다
cp ~/deploy/script.html dist/ 2>/dev/null || true
chmod +x dist/시작하기_맥.command

OUT=${OUT:-$HOME/deploy/signbridge-노트북용.zip}
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
( cd dist && zip -q -r -1 "$OUT" . )

echo "[laptop] $OUT  ($(du -h "$OUT" | cut -f1))"
echo "[laptop] 파일 브라우저로 내려받아 압축을 풀고, 시작하기 파일을 더블클릭하면 됩니다."
