#!/usr/bin/env bash
# GitHub에 올린다. 토큰은 **한 번만** 쓰고 저장하지 않는다.
#
#   GH_TOKEN=ghp_xxxxx bash deploy/푸시하기.sh          # 지금 가지만
#   GH_TOKEN=ghp_xxxxx bash deploy/푸시하기.sh --all     # 작업 가지까지 전부
#
# 토큰 만드는 곳 (2분):
#   github.com → 오른쪽 위 프로필 → Settings → 맨 아래 Developer settings
#   → Personal access tokens → Tokens (classic) → Generate new token (classic)
#   → Note: signbridge / Expiration: 7 days / 체크: **repo** 하나만
#   → Generate token → ghp_ 로 시작하는 문자열 복사
#
# 이 스크립트는 토큰을 파일에 쓰지 않는다. 원격 주소에도 남기지 않는다.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${GH_TOKEN:?GH_TOKEN이 필요합니다 — 위 주석의 절차를 보세요}"

REPO=$(git remote get-url origin | sed -E 's#https://([^@]*@)?github.com/##')
URL="https://x-access-token:${GH_TOKEN}@github.com/${REPO}"

# 올릴 가지 고르기. --all 이면 작업 공간 가지(work/*)까지 함께 올린다 —
# 터미널을 나눠 쓰면 가지가 여럿이라, 하나만 올리면 나머지가 워크스페이스에만 남는다.
BRANCHES=("$(git rev-parse --abbrev-ref HEAD)")
if [ "${1:-}" = "--all" ]; then
  while read -r b; do BRANCHES+=("$b"); done < <(git for-each-ref --format='%(refname:short)' refs/heads/work)
fi

for BRANCH in "${BRANCHES[@]}"; do
  AHEAD=$(git rev-list --count "origin/${BRANCH}..${BRANCH}" 2>/dev/null || echo '?')
  echo "[push] ${BRANCH} → ${REPO}  (올릴 커밋 ${AHEAD}개)"
  git -c credential.helper= push "$URL" "${BRANCH}" 2>&1 | sed "s/${GH_TOKEN}/***/g"
done

echo "[push] 끝. github.com/${REPO%.git}/branches 에서 확인하세요."
