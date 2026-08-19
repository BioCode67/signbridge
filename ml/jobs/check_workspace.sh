#!/usr/bin/env bash
# KOREN 워크스페이스 환경 점검 — 데이터를 받기 전에 이걸 먼저 돌린다.
#
# 확인하는 것
#   1. GPU가 실제로 잡히는가
#   2. 볼륨이 붙어 있고 쓸 수 있는가 (여유 용량 포함)
#   3. **AI Hub에서 직접 다운로드가 되는가**  ← 가장 중요
#   4. 파이썬·torch·의존성이 준비됐는가
#
# 3번이 되면 데이터가 내 PC를 거치지 않고 워크스페이스로 바로 들어온다.
# 안 되면 PC로 받아서 올려야 하므로 계획이 완전히 달라진다. 그래서 먼저 확인한다.
#
#     bash ml/jobs/check_workspace.sh

set -uo pipefail  # -e는 쓰지 않는다. 하나 실패해도 나머지 점검을 계속해야 한다.

ok()   { printf '  \033[32m✅ %s\033[0m\n' "$*"; }
warn() { printf '  \033[33m⚠️  %s\033[0m\n' "$*"; }
bad()  { printf '  \033[31m❌ %s\033[0m\n' "$*"; }
head2() { printf '\n\033[1m── %s ─────────────────────────────\033[0m\n' "$*"; }

echo "============================================================"
echo " KOREN 워크스페이스 점검  ($(date '+%F %T'))"
echo "============================================================"

# ── 1. GPU ──────────────────────────────────────────────────────
head2 "1. GPU"
if command -v nvidia-smi >/dev/null 2>&1; then
  gpu_name=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1)
  if [[ -n "${gpu_name}" ]]; then
    ok "GPU 인식: ${gpu_name}"
  else
    warn "nvidia-smi는 있는데 GPU 목록이 비었습니다 (MIG 설정 확인)"
  fi
else
  warn "nvidia-smi 없음 — CPU 워크스페이스이거나 드라이버 미탑재"
fi

# ── 2. 저장 공간 ────────────────────────────────────────────────
head2 "2. 저장 공간 (볼륨)"
printf '  %-34s %8s %8s\n' "마운트" "전체" "여유"
while read -r source size used avail pct target; do
  case "${target}" in
    /|/home/jovyan|/data*|/cheetah*|/mnt/*|/workspace*)
      printf '  %-34s %8s %8s\n' "${target}" "${size}" "${avail}"
      ;;
  esac
done < <(df -h --output=source,size,used,avail,pcent,target 2>/dev/null | tail -n +2)

echo
if [[ -w /home/jovyan ]]; then
  home_avail=$(df -h /home/jovyan 2>/dev/null | awk 'NR==2{print $4}')
  ok "홈 쓰기 가능 (여유 ${home_avail})"
  case "${home_avail}" in
    *K|[0-9]M|[0-9][0-9]M|*[0-9].[0-9]G)
      warn "홈 여유가 적습니다. pip 설치만 1GB 넘습니다 → [볼륨조정] 권장" ;;
  esac
fi

# 데이터용 볼륨 후보 탐색
echo
echo "  데이터 볼륨 후보:"
found_volume=0
for candidate in /data /data/* /cheetah/input/volume/* /mnt/* /workspace; do
  [[ -d "${candidate}" && -w "${candidate}" ]] || continue
  [[ "${candidate}" == *"user-home"* ]] && continue
  avail=$(df -h "${candidate}" 2>/dev/null | awk 'NR==2{print $4}')
  printf '    %-44s 여유 %s\n' "${candidate}" "${avail}"
  found_volume=1
done
[[ ${found_volume} -eq 0 ]] && bad "쓸 수 있는 데이터 볼륨이 없습니다 — 볼륨을 붙이세요"

# ── 3. AI Hub 접속 (가장 중요) ─────────────────────────────────
head2 "3. AI Hub 접속 가능 여부  ← 이 결과로 계획이 갈립니다"
if command -v curl >/dev/null 2>&1; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://api.aihub.or.kr/api/aihubshell.do 2>/dev/null)
  if [[ "${code}" == "200" ]]; then
    ok "AI Hub 접속됨 (HTTP ${code})"
    echo "     → 데이터를 이 워크스페이스로 **직접** 받으세요. PC를 거칠 필요 없습니다."
  elif [[ -z "${code}" || "${code}" == "000" ]]; then
    bad "AI Hub에 접속하지 못했습니다 (연구망 차단 가능성)"
    echo "     → PC로 받아서 볼륨에 올리는 방식으로 가야 합니다."
  else
    warn "응답은 오는데 정상(200)이 아닙니다 (HTTP ${code})"
  fi
else
  warn "curl이 없어 확인 불가"
fi

# 일반 인터넷도 되는지 (pip 설치 가능 여부)
if command -v curl >/dev/null 2>&1; then
  pypi=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://pypi.org/simple/ 2>/dev/null)
  [[ "${pypi}" == "200" ]] && ok "PyPI 접속됨 (pip install 가능)" || warn "PyPI 접속 불가 (HTTP ${pypi:-없음}) — 의존성 설치가 막힐 수 있습니다"
fi

# ── 4. 파이썬 환경 ──────────────────────────────────────────────
head2 "4. 파이썬 / 라이브러리"
if command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then
  PY=$(command -v python || command -v python3)
  ok "$("${PY}" -V 2>&1)  (${PY})"
  "${PY}" - <<'PYCODE'
def check(name, extra=""):
    try:
        module = __import__(name)
        version = getattr(module, "__version__", "?")
        print(f"  ✅ {name} {version} {extra}")
        return module
    except ImportError:
        print(f"  ⚠️  {name} 없음 — pip install 필요")
        return None

torch = check("torch")
if torch is not None:
    available = torch.cuda.is_available()
    print(f"  {'✅' if available else '⚠️ '} torch.cuda.is_available() = {available}")
    if available:
        print(f"  ✅ GPU: {torch.cuda.get_device_name(0)}")
for name in ("numpy", "mediapipe", "cv2", "onnxruntime", "transformers"):
    check(name)
PYCODE
else
  bad "python이 없습니다"
fi

# ── 5. Claude Code를 여기서 돌릴 수 있는가 ─────────────────────
head2 "5. Claude Code 연결 가능 여부"
# 워크스페이스 안에서 Claude Code가 돌면 데이터를 눈으로 옮길 필요 없이
# 그 자리에서 ETL·학습·디버깅을 시킬 수 있다. 두 가지가 필요하다.
node_ok=0
if command -v node >/dev/null 2>&1; then
  node_version=$(node -v 2>/dev/null)
  major=${node_version#v}
  major=${major%%.*}
  if [[ "${major}" =~ ^[0-9]+$ ]] && (( major >= 18 )); then
    ok "Node.js ${node_version} (18 이상 필요 — 충족)"
    node_ok=1
  else
    warn "Node.js ${node_version} — 18 이상이 필요합니다"
  fi
else
  warn "Node.js 없음 (설치 필요)"
fi

api_ok=0
if command -v curl >/dev/null 2>&1; then
  # 인증 없이 부르면 401이 정상이다. 즉 401도 '연결은 된다'는 뜻이다.
  api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://api.anthropic.com/v1/messages 2>/dev/null)
  case "${api}" in
    000|"") bad "api.anthropic.com 접속 불가 — 여기서는 Claude Code를 쓸 수 없습니다" ;;
    *)      ok "api.anthropic.com 응답함 (HTTP ${api}) — 네트워크는 열려 있습니다"; api_ok=1 ;;
  esac
fi

if (( api_ok == 1 )); then
  if (( node_ok == 1 )); then
    echo "     → 바로 설치해 보세요:  npm install -g @anthropic-ai/claude-code"
  else
    echo "     → Node.js를 먼저 설치해야 합니다(아래 '다음 할 일' 참고)."
  fi
fi

# ── 요약 ────────────────────────────────────────────────────────
head2 "다음 할 일"
cat <<'GUIDE'
  3번이 ✅ 이면 → 이 워크스페이스에서 바로 다운로드 (PC 안 거침)
  3번이 ❌ 이면 → PC로 받은 뒤 볼륨에 업로드

  받을 것은 **라벨링데이터(형태소 JSON)** 뿐입니다.
  원천데이터(영상 .mp4)는 받지 마세요 — 용량이 TB급이고 지금은 필요 없습니다.
  재난안전 데이터는 키포인트가 형태소 JSON 안에 이미 들어 있습니다.

  5번이 ✅ 인데 Node.js가 없다면 (sudo 없이 홈에 설치하는 방법):
    curl -fsSL https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz -o /tmp/node.tar.xz
    mkdir -p ~/.local && tar -xJf /tmp/node.tar.xz -C ~/.local
    echo 'export PATH=$HOME/.local/node-v22.11.0-linux-x64/bin:$PATH' >> ~/.bashrc
    source ~/.bashrc && node -v
GUIDE
echo
