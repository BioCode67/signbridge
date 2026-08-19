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
# ── 인코딩을 받는 쪽(윈도우) 기준으로 바꿔서 넣는다.  2026-08-19에 실제로 깨졌다.
#
# cmd.exe 는 .bat 을 **ANSI 코드페이지**(한국어 윈도우면 CP949)로 읽는다. UTF-8로
# 저장한 .bat 은 한글 줄이 깨진 채 *명령으로 해석되어* 오류가 쏟아진다.
# 파일 안에 `chcp 65001`을 넣는 것으로는 안 된다 — 코드페이지를 중간에 바꾸면
# cmd 가 파일을 읽던 바이트 위치를 어긋나게 잡아 그 뒤 줄이 통째로 망가진다.
# 그래서 **CP949 + CRLF** 로 변환해서 넣고, .bat 안에는 chcp 를 두지 않는다.
#
# Windows PowerShell 5.1 은 .ps1 에 BOM 이 없으면 역시 ANSI 로 읽는다 → **BOM 을 붙인다.**
# 맥 .command 는 UTF-8 그대로 둔다(맥은 UTF-8 이 기본이다).
cp deploy/laptop/시작하기_맥.command deploy/laptop/읽어주세요.txt dist/
sed 's/$/\r/' deploy/laptop/시작하기_윈도우.bat | iconv -f UTF-8 -t CP949 > dist/시작하기_윈도우.bat
printf '\xEF\xBB\xBF' > dist/서버.ps1
sed 's/$/\r/' deploy/laptop/서버.ps1 >> dist/서버.ps1

# 넣기 전에 되돌려 읽어 본다 — 변환이 조용히 실패하면 발표 당일에 발견하게 된다
iconv -f CP949 -t UTF-8 dist/시작하기_윈도우.bat | grep -q 'SignBridge 를 시작합니다' \
  || { echo "[laptop] .bat CP949 변환 실패"; exit 1; }
# rem 설명문에도 'chcp'라는 낱말이 나온다 — **명령으로 쓰인 줄**만 본다
iconv -f CP949 -t UTF-8 dist/시작하기_윈도우.bat | grep -qiE '^[[:space:]]*chcp[[:space:]]' \
  && { echo "[laptop] .bat 에 chcp 명령이 남아 있다"; exit 1; }
# 대본도 함께 넣는다 — 촬영하면서 읽을 것이라 같은 폴더에 있어야 편하다
cp ~/deploy/script.html dist/ 2>/dev/null || true
chmod +x dist/시작하기_맥.command

OUT=${OUT:-$HOME/deploy/signbridge-노트북용.zip}
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
( cd dist && zip -q -r -1 "$OUT" . )

echo "[laptop] $OUT  ($(du -h "$OUT" | cut -f1))"
echo "[laptop] 파일 브라우저로 내려받아 압축을 풀고, 시작하기 파일을 더블클릭하면 됩니다."
