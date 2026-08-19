#!/usr/bin/env bash
# API 서버를 공개 URL로 노출한다 — 결제·카드 없이.
#
#   bash deploy/tunnel.sh          # 시작 (백그라운드 유지)
#   cat ~/sbruns/tunnel_url.txt    # 현재 공개 주소
#
# ── 왜 이 방식인가
# 이 워크스페이스는 **아웃바운드 443만 열려 있다.** 실측 결과:
#   cloudflared  → 포트 7844(TCP/UDP) 필요 → 차단됨
#   ngrok        → connect.ngrok-agent.com:443 차단됨
#   pinggy       → a.pinggy.io:443 **열림** ✅
# 그래서 pinggy를 쓴다. 계정도 설치도 필요 없다(ssh만 쓴다).
#
# ── 한계와 대응
# 무료 터널은 **60분마다 끊기고 주소가 바뀐다.** 그래서 이 스크립트가 감시하다가
# 끊기면 다시 붙이고 새 주소를 파일에 적는다. 프런트가 그 주소를 읽어 쓰도록
# `tunnel_url.txt`를 단일 출처로 삼는다.
#
# 발표처럼 주소가 고정돼야 하는 상황이면 KOREN VM(NOC 발급)으로 옮기는 것이 맞다.
# 이건 "지금 당장 남들이 접속해 시험해 볼 수 있게" 하는 임시 수단이다.

set -uo pipefail
URL_FILE="${URL_FILE:-$HOME/sbruns/tunnel_url.txt}"
LOG="${LOG:-$HOME/sbruns/tunnel.log}"
PORT="${PORT:-8000}"

mkdir -p "$(dirname "$URL_FILE")"

while true; do
  echo "[tunnel] $(date '+%F %T') 연결 시도" >> "$LOG"
  RAW="$(mktemp)"
  # -R0: 원격 포트를 서버가 할당. 60분 뒤 세션이 끝나면 ssh가 종료되고 루프가 재연결한다.
  ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
      -p 443 -R0:localhost:"${PORT}" a.pinggy.io > "$RAW" 2>&1 &
  SSH_PID=$!

  # 주소가 찍힐 때까지 최대 60초 기다린다.
  for _ in $(seq 1 20); do
    # pinggy가 도메인을 바꿨다(2026-08-19). `*.free.pinggy.net` 만 보다가 새로 발급된
    # `*.run.pinggy-free.link` 를 놓쳐 "주소 획득 실패"로 빈손이 됐다. 둘 다 본다.
    URL="$(grep -oE 'https://[a-z0-9-]+\.(free\.pinggy\.net|run\.pinggy-free\.link)' "$RAW" | head -1)"
    [ -n "${URL:-}" ] && break
    sleep 3
  done

  if [ -n "${URL:-}" ]; then
    echo "$URL" > "$URL_FILE"
    echo "[tunnel] $(date '+%F %T') 공개 주소: $URL" >> "$LOG"
  else
    echo "[tunnel] $(date '+%F %T') 주소 획득 실패" >> "$LOG"
  fi

  wait "$SSH_PID"   # 끊길 때까지 대기(무료 티어는 약 60분)
  cat "$RAW" >> "$LOG"; rm -f "$RAW"
  echo "[tunnel] $(date '+%F %T') 끊김 — 5초 후 재연결" >> "$LOG"
  sleep 5
done
