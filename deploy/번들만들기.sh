#!/usr/bin/env bash
# 저장소 전체를 파일 하나로 묶는다 — 인터넷 없이 옮기고 어디서든 복원한다.
#
#     bash deploy/번들만들기.sh
#
# **왜 스크립트로 두나.** 번들을 손으로 만들면 문서에 적힌 커밋 수가 금방 낡는다.
# "커밋 302개"라고 적어 두고 실제로는 323개인 상태가 됐었다. 숫자가 틀리면
# 사용자가 **복원이 제대로 됐는지 확인할 방법을 잃는다** — 그게 이 숫자의 유일한 쓸모다.
# 그래서 만들면서 문서의 숫자도 같이 고친다.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=~/deploy/signbridge-full.bundle
mkdir -p ~/deploy

N=$(git rev-list --count HEAD)
BR=$(git rev-parse --abbrev-ref HEAD)
echo "[번들] 브랜치 $BR · 커밋 ${N}개"

git bundle create "$OUT" --all
git bundle verify "$OUT" >/dev/null && echo "[번들] ✓ 검증 통과"

SZ=$(du -h "$OUT" | cut -f1)
echo "[번들] $OUT ($SZ)"

# 문서의 커밋 수를 실제 값으로 맞춘다
for f in deploy/내가_할_일.md deploy/B안_직접_올리기.md; do
  [ -f "$f" ] || continue
  sed -i -E "s/커밋 [0-9,]+개/커밋 ${N}개/g" "$f"
done
sed -i -E "s#(signbridge-full\.bundle\` \| )[0-9]+MB#\1${SZ%%[A-Za-z]*}MB#" deploy/내가_할_일.md 2>/dev/null || true
echo "[번들] 문서의 커밋 수를 ${N}개로 맞췄습니다"
