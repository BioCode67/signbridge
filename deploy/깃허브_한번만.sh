#!/usr/bin/env bash
# 토큰을 **한 번만** 넣고, 그다음부터는 그냥 `git push`가 되게 한다.
#
#   GH_TOKEN=ghp_xxxxx bash deploy/깃허브_한번만.sh
#
# 무엇을 하나
#   1) 토큰이 실제로 쓸 수 있는 것인지 먼저 확인한다(권한·오타를 여기서 잡는다)
#   2) `~/.git-credentials`에 저장하고 credential.helper store 를 켠다
#   3) 지금 가지와 작업 가지(work/*)를 모두 올린다
#   4) 각 작업 공간(worktree)에서도 같은 자격이 쓰이도록 전역 설정으로 둔다
#
# ⚠️ 토큰이 **평문으로** ~/.git-credentials 에 남는다. 본인 전용 워크스페이스에서만
#    쓸 것. 공용 장비라면 `deploy/푸시하기.sh`(한 번 쓰고 안 남김)를 쓴다.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${GH_TOKEN:?GH_TOKEN이 필요합니다 — deploy/깃허브_연동.md 를 보세요}"

REPO=$(git remote get-url origin | sed -E 's#https://([^@]*@)?github.com/##; s#\.git$##')
OWNER=${REPO%%/*}

echo "[1/4] 토큰 확인 중…"
CODE=$(curl -s -o /tmp/ghcheck.json -w "%{http_code}" \
  -H "Authorization: Bearer ${GH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}")
if [ "$CODE" != "200" ]; then
  echo "  ✗ 토큰으로 저장소를 못 읽습니다 (HTTP $CODE)"
  echo "    · 401 → 토큰이 틀렸거나 만료됐습니다"
  echo "    · 404 → 저장소 이름이 다르거나, 토큰에 repo 권한이 없습니다"
  echo "    저장소: ${REPO}"
  exit 1
fi
PUSHOK=$(python3 -c "import json;print(json.load(open('/tmp/ghcheck.json')).get('permissions',{}).get('push'))")
rm -f /tmp/ghcheck.json
if [ "$PUSHOK" != "True" ]; then
  echo "  ✗ 읽기는 되는데 **쓰기 권한이 없습니다.**"
  echo "    토큰을 만들 때 **repo** 를 체크했는지 확인하세요."
  exit 1
fi
echo "  ✓ 쓰기 권한 확인"

echo "[2/4] 자격 저장 중…"
git config --global credential.helper store
printf 'https://x-access-token:%s@github.com\n' "$GH_TOKEN" >> ~/.git-credentials
/bin/chmod 600 ~/.git-credentials
# 원격 주소에는 토큰을 남기지 않는다 — 저장소를 남에게 보여도 새지 않게.
git remote set-url origin "https://github.com/${REPO}.git"
echo "  ✓ ~/.git-credentials 에 저장(600)"

echo "[3/4] 올리는 중…"
CUR=$(git rev-parse --abbrev-ref HEAD)
BRANCHES=("$CUR")
while read -r b; do [ -n "$b" ] && BRANCHES+=("$b"); done < <(git for-each-ref --format='%(refname:short)' refs/heads/work)
for B in "${BRANCHES[@]}"; do
  N=$(git rev-list --count "origin/${B}..${B}" 2>/dev/null || echo '새 가지')
  echo "  ${B} (${N}개)"
  git push -u origin "$B" 2>&1 | sed "s/${GH_TOKEN}/***/g" | /bin/sed 's/^/    /'
done

echo "[4/4] 끝. 이제부터는 그냥 이렇게 하면 됩니다:"
echo "    git push"
echo "  확인: https://github.com/${REPO}/branches"
