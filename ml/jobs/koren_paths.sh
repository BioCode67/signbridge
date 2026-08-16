#!/usr/bin/env bash
# 이 워크스페이스(KOREN AI Cloud)에서 실제로 쓰는 경로.
#
# 왜 이렇게 나눴는가 — 여기엔 데이터 볼륨(sbdata)이 아직 없다. 대신 두 저장소가 있다.
#
#   /tmp        1.8T(여유 1.2T)  컨테이너 디스크. 넓지만 재시작하면 사라진다.
#   /home/jovyan  50G            볼륨. 재시작해도 남는다(워크스페이스를 지우면 사라짐).
#
# 원본(AI Hub 내려받은 zip·JSON)은 크지만 **다시 받으면 되는 것**이라 /tmp에 둔다.
# 팩·사전·체크포인트는 **다시 만들려면 오래 걸리는 것**이라 홈 볼륨에 둔다.
# 팩은 프레임당 약 0.5KB라 450시간 분량도 ~25GB — 50G 안에 들어간다.
#
# 볼륨(sbdata)을 나중에 붙이면 아래 세 줄만 그 경로로 바꾸면 된다.

export RAW_ROOT="${RAW_ROOT:-/tmp/sb-raw}"
export DATA_ROOT="${DATA_ROOT:-$HOME/sbdata}"
export RUNS_ROOT="${RUNS_ROOT:-$HOME/sbruns}"
