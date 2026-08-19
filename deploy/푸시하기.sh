#!/usr/bin/env bash
# GitHub에 올린다. 토큰은 **한 번만** 쓰고 저장하지 않는다.
#
#   GH_TOKEN=ghp_xxxxx bash deploy/푸시하기.sh
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

BRANCH=$(git rev-parse --abbrev-ref HEAD)
REPO=$(git remote get-url origin | sed -E 's#https://([^@]*@)?github.com/##')

echo "[push] 브랜치 ${BRANCH} → ${REPO}"
echo "[push] 올릴 커밋 $(git rev-list --count origin/${BRANCH}..${BRANCH} 2>/dev/null || echo '?')개"

git -c credential.helper= \
    push "https://x-access-token:${GH_TOKEN}@github.com/${REPO}" "${BRANCH}" 2>&1 |
  sed "s/${GH_TOKEN}/***/g"

echo "[push] 끝. github.com/${REPO%.git}/tree/${BRANCH} 에서 확인하세요."
