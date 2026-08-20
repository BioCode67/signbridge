#!/usr/bin/env bash
# GitHub Pages 배포 — dist/ 를 gh-pages 브랜치에 얹는다.
#
#   npm run build && bash deploy/deploy_pages.sh
#   → https://biocode67.github.io/signbridge/  (반영까지 1~2분)
#
# 서버가 없는 앱이라 정적 파일이 곧 배포 전부다. gh-pages 이력은 남긴다
# (orphan으로 갈아엎지 않는다) — 언제 무엇이 나갔는지 커밋으로 남는 것이 값지다.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f dist/index.html ] || { echo "dist가 없습니다 — 먼저 npm run build"; exit 1; }

git fetch origin gh-pages
WT=$(mktemp -d)
git worktree add -B gh-pages "$WT" origin/gh-pages
git -C "$WT" rm -rfq .
cp -a dist/. "$WT"/
touch "$WT/.nojekyll"           # 언더스코어 경로를 Jekyll이 삼키지 않도록
git -C "$WT" add -A
git -C "$WT" commit -m "deploy: $(git rev-parse --short HEAD) 기준 빌드"
git -C "$WT" push origin gh-pages
git worktree remove --force "$WT"
echo "[pages] 배포 완료 — https://biocode67.github.io/signbridge/"
