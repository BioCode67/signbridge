#!/usr/bin/env bash
# 지문자(FS) 키포인트 내려받기 — AI Hub「수어 영상」(datasetkey 103) CROWD 조각.
#
# **왜 이것을 받나.** 지금까지 "지문자는 공개 데이터가 없다"고 적어 두었지만
# 사실이 아니었다. CROWD 형태소 조각(8MB)을 열어 보니 **지문자 클립 17,000개**의
# 라벨이 들어 있었다(지명·거리 이름 1,015종). 파일명 갈래가 가이드의 `FINSP`가
# 아니라 `FS`라서 갈래 필터에 걸려 **한 개도 안 잡히면서 오류도 안 났다.**
#
# 라벨만으로 확인한 것(ml/tools/fs_report.py로 다시 잴 수 있다)
#   · 자모 개수 ↔ 표시 구간 길이 상관 r = 0.845 (자모당 약 0.5초)
#     → 낱말을 통째로 흉내 내는 게 아니라 **자모를 하나씩 쓰는 진짜 지문자**다
#   · 자모 37종이 133,986회 등장 (가장 흔한 ㅇ 16,881 · 가장 드문 ㄻ 17)
#
# 여기서 받는 것은 **키포인트뿐**이다. 영상(29~31GB × 6)은 받지 않는다 —
# 학습에 쓰지 않고 볼륨만 먹는다.
#
#   export AIHUB_APIKEY=<AI Hub 마이페이지 → API 키>   ← 이것만 사용자가 해야 한다
#   bash ml/jobs/run_fingerspell.sh
#
# 받는 도중 용량이 한때 3배까지 부푼다(aihubshell이 download.tar → 분할 → 병합).
# 합계 12GB이므로 여유 40GB면 넉넉하다.
set -euo pipefail

RAW_DIR="${RAW_DIR:-$HOME/sbdata/raw/sl-crowd-kp}"
OUT_DIR="${OUT_DIR:-$HOME/sbdata/ksl-fs}"

# ── 파일 목록 (2026-08-18 확인, aihubshell -mode l -datasetkey 103)
#   학습   01_crowd_keypoint.zip  6GB  39580
#          02_crowd_keypoint.zip  5GB  39582
#   검증   01_crowd_keypoint.zip  1GB  39474
FILEKEY="${FILEKEY:-39580,39582,39474}"

: "${AIHUB_APIKEY:?AIHUB_APIKEY가 필요합니다 (AI Hub 마이페이지 → API 키)}"
command -v aihubshell >/dev/null || {
  echo "aihubshell이 없습니다. 설치:"
  echo "  mkdir -p ~/.local/bin && curl -sS -o ~/.local/bin/aihubshell https://api.aihub.or.kr/api/aihubshell.do && chmod +x ~/.local/bin/aihubshell"
  exit 1
}

mkdir -p "${RAW_DIR}"
echo "[fs] 키포인트 내려받기 → ${RAW_DIR} (filekey ${FILEKEY})"
( cd "${RAW_DIR}" && aihubshell -mode d -datasetkey 103 -filekey "${FILEKEY}" )

# ── 확장자만 zip이고 실제로는 7z인 배포본이 섞여 있다. 매직 바이트로 판별한다.
echo "[fs] 압축 풀기"
find "${RAW_DIR}" -name "*.zip" -print0 | while IFS= read -r -d '' z; do
  dest="${z%.zip}"
  mkdir -p "${dest}"
  if 7z x -y -o"${dest}" "${z}" > /dev/null; then
    echo "  ✓ $(basename "${z}")"
  else
    echo "  ✗ $(basename "${z}") — 풀지 못했습니다"
  fi
done

MORPH="${MORPH:-$HOME/sbdata/sl-crowd}"
echo "[fs] 자모열 팩 만들기 → ${OUT_DIR}"
cd "$(dirname "$0")/../.."
python -m ml.etl.aihub_sl \
  --morpheme "${MORPH}" --keypoints "${RAW_DIR}" \
  --kinds FINSP --jamo --angles F \
  --out "${OUT_DIR}" --workers 16

echo
echo "[fs] 다음: 수어자 분리로 나누고 CTC 학습"
echo "  python -m ml.etl.prepare --data ${OUT_DIR} --split-by signer"
echo "  python -m ml.train_ctc --data ${OUT_DIR} --out ~/sbruns/fs-v1 --epochs 60"
