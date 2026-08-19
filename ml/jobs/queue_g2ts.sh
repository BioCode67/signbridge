#!/bin/bash
# CTC가 끝나면 **글로스→한국어** 소형 모델을 이어서 학습한다 (GPU 순차 사용).
#
# 왜: 지금 앱은 농인이 수어로 답하면 규칙으로 한국어를 지어 낸다
# (src/agents/glossToKorean.ts — 용언에 어미를 붙이는 정도). 직원이 듣는 말이
# 그 규칙의 한계까지밖에 자연스럽지 않다. 한국어→글로스에 쓴 같은 20만 쌍을
# 뒤집어 배우면 사람이 쓴 문장에 가까워진다. 구조·크기는 t2gs와 같아
# 브라우저에서 그대로 돈다(23M · int8 30MB).
#
# **pid 파일로 기다린다** — pgrep -f는 이 스크립트 자신의 명령줄에 매칭돼
# 영원히 대기한다(이 워크스페이스에서 네 번 겪었다).
set -u
PID_FILE=~/sbruns/ctc-v1.pid
while [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; do sleep 300; done

cd /home/jovyan/app
# 길이는 **재고 정한다.** 기본값(max-tgt 48)을 그대로 쓰면 한국어 문장의 69%가
# 잘린다 — 학습은 멀쩡히 돌고 손실도 내려가는데 긴 문장을 끝까지 못 만든다.
#   한국어 음절  중앙값 56 · 95% 85 · 99% 91 · 최대 221  → 96이면 0.5%만 잘린다
#   글로스 개수  중앙값 15 · 95% 28 · 99% 35 · 최대 100  → 64면 거의 안 잘린다
# (방향이 반대라 t2gs와 값이 뒤바뀐다. 그대로 두면 안 된다.)
nohup python -m ml.train_t2g_small \
  --data ~/sbdata/script --out ~/sbruns/g2ts-v1 \
  --direction gloss2text --epochs 60 \
  --max-src 64 --max-tgt 96 \
  > ~/sbruns/g2ts-v1.log 2>&1 &
echo $! > ~/sbruns/g2ts-v1.pid
echo "[queue] $(date '+%F %T') CTC 종료 — g2ts-v1(글로스→한국어) 시작 PID $(cat ~/sbruns/g2ts-v1.pid)" >> ~/sbruns/queue.log
