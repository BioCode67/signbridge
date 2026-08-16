#!/usr/bin/env bash
# 이 워크스페이스(KOREN AI Cloud)에서 실제로 쓰는 경로.
#
# 홈 볼륨(`/home/jovyan`)을 900GiB로 키워 전부 여기에 둔다. 컨테이너 디스크(/tmp)는
# 재시작하면 사라지므로 원본이든 결과물이든 두지 않는다.
#
# 필요한 용량 — **압축을 풀지 않는다**는 전제로 계산한 값이다.
#   원본 zip   형태소 TL 90G + VL 11G + 수어스크립트 0.4G   ≈ 102G
#   팩·사전    프레임당 약 0.5KB, 450시간 분량              ≈ 25G
#   체크포인트 2.8M 파라미터 × 여러 런                       ≈ 5G
#                                                    합계  ≈ 132G
# 900GiB면 넉넉하다. 반대로 zip을 다 풀면 수백 GB가 더 필요해 위험하므로,
# `ml.etl.aihub_disaster`가 zip을 연 채로 멤버만 읽도록 만들어 두었다.

export RAW_ROOT="${RAW_ROOT:-$HOME/sbdata/raw}"     # AI Hub 원본 zip (푼 적 없음)
export DATA_ROOT="${DATA_ROOT:-$HOME/sbdata/ksl}"   # 팩·인덱스·사전
export RUNS_ROOT="${RUNS_ROOT:-$HOME/sbruns}"       # 체크포인트·로그

# 홈이 아직 50G면 여기서 멈춘다. 90GB를 받다가 도중에 디스크가 차면
# 이어받기가 꼬이고 시간만 버린다.
_sb_free_gb() { df -BG --output=avail "$HOME" | tail -1 | tr -dc '0-9'; }
sb_require_space() {
  local need="${1:-150}" free
  free="$(_sb_free_gb)"
  if [ "${free:-0}" -lt "${need}" ]; then
    echo "❌ 홈 여유 공간 ${free}G — ${need}G 이상이 필요합니다." >&2
    echo "   KOREN 콘솔에서 홈 볼륨을 900GiB로 키운 뒤 다시 실행하세요." >&2
    return 1
  fi
  echo "✅ 홈 여유 ${free}G (필요 ${need}G)"
}
