#!/usr/bin/env bash
# Netlify Drop / Cloudflare Pages에 **끌어다 놓을** 폴더를 zip으로 묶는다.
#
#     bash deploy/사이트zip만들기.sh
#
# 만드는 것은 **하나뿐이다** — `signbridge-site.zip` (전체).
#
# ── 왜 "가벼운 판"을 안 만드나  (2026-08-19에 만들어 보고 지웠다)
# 서비스워커의 필수+고빈도 목록(1,301종)만 남기고 글로스 11,529개를 뺀 93MB 판을
# 만들어 실제로 돌려 봤다. 결과:
#
#     묻기 → "북서쪽 350미터 대피하세요"가 화면에 뜬다   ← 멀쩡해 보인다
#     아바타 프레임 1 · 글로스 0 · 없는 파일 요청 21건   ← 수어는 안 나온다
#
# 필수·고빈도 목록은 **미리 받아 둘 것**을 고른 목록이지, 그것만 있으면 되는
# 목록이 아니다. 나머지는 필요할 때 서버에서 가져오는데, 그 파일이 없으면
# **조용히 건너뛰고 아바타가 가만히 선다.** 오류도 안 나고 자막은 그대로 뜬다.
# 업로드 74MB를 아끼려다 시연 도중 수어가 안 나오는 쪽이 훨씬 비싸다.
#
# 주의: 이건 `signbridge-노트북용.zip`(인터넷 없이 여는 판)과 **다른 파일**이다.
# 이쪽은 웹에 올려 주소를 만드는 용도다.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d dist ] || { echo "dist가 없습니다 — 먼저 npm run build"; exit 1; }
mkdir -p ~/deploy

N=$(ls dist/data/glosses 2>/dev/null | wc -l)
echo "[site] 동작 사전 ${N}종을 전부 담습니다"
rm -f ~/deploy/signbridge-site.zip
(cd dist && zip -qr ~/deploy/signbridge-site.zip .)
echo "[site] ✓ ~/deploy/signbridge-site.zip ($(du -h ~/deploy/signbridge-site.zip | cut -f1))"
echo
echo "[site] 올리는 곳: https://app.netlify.com/drop"
echo "[site]   압축을 풀고 **폴더째** 끌어다 놓으면 주소가 나옵니다."
