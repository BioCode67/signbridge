#!/usr/bin/env python3
"""앱이 쓰는 글로스가 동작 사전에 실제로 있는지 확인한다.

    python3 ml/tools/check_app_glosses.py

**왜 필요한가.** 장소 상용구(`src/user/places.ts`)는 사람이 손으로 매핑한 글로스를
직접 지정한다. 동작 사전(`public/data/bank.json`)을 다시 만들면 어휘 구성이 바뀌는데,
없는 글로스는 재생 때 **조용히 건너뛴다.** 그 결과가 특히 고약하다:

  - 글로스가 전부 없으면 합성이 실패해 아바타가 **가만히 서 있다**
  - 화면에는 한국어 원문이 그대로 떠 있어 **정상 동작처럼 보인다**
  - 창구에서 이걸 겪는 사람은 "앱이 고장났다"가 아니라 "내 말이 전달됐나?"를 의심한다

실측에서 실제로 났다 — 동작 사전을 9,505종으로 다시 만든 뒤 상용구 30개 중 **17개**의
글로스가 사라져 병원·약국·긴급 문구가 재생되지 않았다. 화면만 봐서는 알 수 없었다.
`feature_parity`가 학습·추론 특징을 지키는 것처럼, 이 검사는 앱 문구와 동작 사전의
정합을 지킨다. **동작 사전을 다시 만들면 반드시 실행할 것.**

종료 코드: 0 정상 · 1 없는 글로스 있음
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BANK = ROOT / "public" / "data" / "bank.json"
PLACES = ROOT / "src" / "user" / "places.ts"
ALIGN = ROOT / "public" / "data" / "align.json"
AGENT = ROOT / "src" / "agents" / "dictSignAgent.ts"

# label과 gloss 배열을 짝지어 뽑는다. 문구 하나가 한 줄이라 이 정도로 충분하다.
PHRASE_RE = re.compile(r"label: '([^']+)'.*?gloss: \[([^\]]*)\]", re.S)
LEMMA_RE = re.compile(r"[0-9#:]+$")


def load_bank() -> dict:
    if not BANK.exists():
        print(f"[glosses] ✗ 동작 사전이 없습니다: {BANK}")
        print("          bash ml/jobs/... 로 export_web_bank를 먼저 실행하세요")
        sys.exit(1)
    return json.loads(BANK.read_text(encoding="utf-8"))


def suggest(missing: str, bank: dict) -> list[str]:
    """없는 글로스에 대해 갈아 끼울 후보를 찾아 준다 — 같은 표제어의 다른 변이형 우선."""
    lemma = LEMMA_RE.sub("", missing)
    if not lemma:
        return []
    same = [k for k in bank if LEMMA_RE.sub("", k) == lemma]
    if same:
        return sorted(same)[:4]
    near = [k for k in bank if LEMMA_RE.sub("", k).startswith(lemma)]
    return sorted(near, key=len)[:4]


def main() -> None:
    bank = load_bank()
    text = PLACES.read_text(encoding="utf-8")

    total_phrases = 0
    total_glosses = 0
    broken: list[tuple[str, list[str], list[str]]] = []

    for m in PHRASE_RE.finditer(text):
        label = m.group(1)
        glosses = [g.strip().strip("'") for g in m.group(2).split(",") if g.strip()]
        if not glosses:
            continue
        total_phrases += 1
        total_glosses += len(glosses)
        missing = [g for g in glosses if g not in bank]
        if missing:
            broken.append((label, glosses, missing))

    print(f"[glosses] 동작 사전 {len(bank):,}종")
    print(f"[glosses] 상용구 {total_phrases}개 · 글로스 {total_glosses}개")

    # 번역 사전이 가리키는 글로스도 함께 본다 — 여기가 어긋나면 임의 문장 번역이 빈다.
    if ALIGN.exists():
        align = json.loads(ALIGN.read_text(encoding="utf-8"))
        targets = {g for cands in align.values() for g in cands}
        gone = sorted(targets - set(bank))
        rate = 100 * (1 - len(gone) / max(1, len(targets)))
        print(f"[glosses] 번역 사전 대상 {len(targets):,}종 중 재생 가능 {rate:.1f}%")
        if gone:
            print(f"          재생 불가 {len(gone)}종 예: {gone[:8]}")

    # 숫자·단위 글로스 — 번역기가 코드에 박아 쓰는 것들. 이게 빠지면 날짜·금액·규모가
    # **조용히 사라진다**(실측: '월' 31회, '점' 8회가 번역은 됐는데 동작이 없어 증발).
    agent = AGENT.read_text(encoding="utf-8")
    hard: set[str] = set()
    for block, pattern in (
        ("DIGIT_GLOSS", r"const DIGIT_GLOSS = \[([^\]]*)\]"),
        ("PLACE_GLOSS", r"const PLACE_GLOSS = \[([^\]]*)\]"),
    ):
        m = re.search(pattern, agent)
        if m:
            hard |= {x.strip().strip("'") for x in m.group(1).split(",") if x.strip().strip("' ")}
    m = re.search(r"const UNIT_GLOSS: Record<string, string> = \{(.*?)\}", agent, re.S)
    if m:
        hard |= set(re.findall(r":\s*'([^']+)'", m.group(1)))
    hard |= {"공", "점"}  # 자릿수 읽기·소수점에서 코드가 직접 만들어 쓴다

    # 시간대 표지(DAYPART) — 시각 앞에 붙는다. 빠지면 "오전 9시"와 "밤 9시"가
    # 똑같이 `시:9시` 하나로 나가 **어느 쪽인지 알 수 없게 된다**(수어 시각은 12시간제).
    m = re.search(r"const DAYPART: readonly string\[\] = \[(.*?)\]", agent, re.S)
    if m:
        hard |= set(re.findall(r"'([^']+)'", m.group(1)))

    # 길찾기 답변이 쓰는 갈래 글로스(nearby.ts의 KIND_KO) — "대피소 어디?"의 답에서
    # 이 낱말이 빠지면 아바타가 방향과 거리만 하고 **무엇이 있는지는 말하지 않는다.**
    nearby_src = (ROOT / "src/user/nearby.ts").read_text(encoding="utf-8")
    kind_glosses = set(re.findall(r"gloss:\s*'([^']+)'", nearby_src))
    # bank 키는 이형태 번호가 붙는다(대피0·대피1). 표제어로 하나라도 있으면 된다.
    lemma_bank = {re.sub(r"[0-9#:@]+$", "", g) for g in bank}
    gone_kind = sorted(g for g in kind_glosses if g not in lemma_bank)
    print(f"[glosses] 길찾기 갈래 글로스 {len(kind_glosses)}종 중 "
          f"재생 가능 {len(kind_glosses) - len(gone_kind)}종")
    if gone_kind:
        broken.append(("길찾기 갈래 글로스(nearby.ts)", sorted(kind_glosses), gone_kind))

    gone = sorted(g for g in hard if g not in bank)
    print(f"[glosses] 숫자·단위 글로스 {len(hard)}종 중 재생 가능 {len(hard) - len(gone)}종")
    if gone:
        broken.append(("숫자·단위 글로스(코드 상수)", sorted(hard), gone))

    # 사전 첫 화면의 시작 낱말(DICT_STARTERS)이 실존하는가.
    # 없으면 눌렀을 때 "없는 단어예요"가 뜬다 — 첫 화면에서 그러면 앱이 고장 난 것처럼 보인다.
    app_src = (ROOT / "src/user/UserApp.tsx").read_text(encoding="utf-8")
    m = re.search(r"const DICT_STARTERS[^=]*= \[(.*?)\n\]", app_src, re.S)
    if m:
        # `words: [...]` 안의 낱말만 — 갈래 이름(name)까지 세면 엉뚱한 것이 잡힌다.
        starters: set[str] = set()
        for words in re.findall(r"words: \[([^\]]*)\]", m.group(1)):
            starters |= set(re.findall(r"'([가-힣]+)'", words))
        gone_s = sorted(w for w in starters if w not in lemma_bank)
        print(f"[glosses] 사전 시작 낱말 {len(starters)}종 중 "
              f"재생 가능 {len(starters) - len(gone_s)}종")
        if gone_s:
            broken.append(("사전 시작 낱말(UserApp.tsx DICT_STARTERS)", sorted(starters)[:5], gone_s))

    # 고개 동작 표(nonmanual.json)가 가리키는 낱말이 동작 사전에 있는가.
    # 없으면 그 낱말이 재생되지 않으니 고개도 붙을 자리가 없다.
    nonmanual = ROOT / "public/data/nonmanual.json"
    if nonmanual.exists():
        nm = json.loads(nonmanual.read_text(encoding="utf-8"))
        want = set(nm.get("nod", {})) | set(nm.get("shake", {}))
        gone_nm = sorted(w for w in want if w not in lemma_bank)
        print(f"[glosses] 고개 동작 낱말 {len(want)}종 중 "
              f"재생 가능 {len(want) - len(gone_nm)}종 "
              f"(끄덕임 {len(nm.get('nod', {}))} · 흔들기 {len(nm.get('shake', {}))})")
        if gone_nm:
            broken.append(("고개 동작 낱말(nonmanual.json)", sorted(want)[:5], gone_nm))

    # 시각·날짜 표가 가리키는 조각이 실제로 실려 있는가.
    timegloss = ROOT / "public/data/timegloss.json"
    if timegloss.exists():
        tg = json.loads(timegloss.read_text(encoding="utf-8"))
        targets = {g for kind in tg.values() for g in kind.values()}
        gone_t = sorted(g for g in targets if g not in bank)
        print(f"[glosses] 시각·날짜 조각 {len(targets):,}종 중 "
              f"재생 가능 {len(targets) - len(gone_t):,}종 "
              f"(시각 {len(tg.get('time', {})):,} · 날짜 {len(tg.get('date', {})):,} · "
              f"소요시간 {len(tg.get('dur', {})):,} 조합)")
        if gone_t:
            broken.append(("시각·날짜 조각(timegloss.json)", sorted(targets)[:5], gone_t[:20]))
    else:
        print("[glosses] ⚠️ timegloss.json 이 없습니다 — 시각·날짜가 자릿수로 읽힙니다")

    if not broken:
        print("[glosses] ✓ 모든 상용구가 재생 가능합니다")
        return

    print(f"\n[glosses] ✗ 재생되지 않는 상용구 {len(broken)}개\n")
    for label, glosses, missing in broken:
        print(f"  {label}")
        print(f"    지정: {glosses}")
        for g in missing:
            cands = suggest(g, bank)
            print(f"    없음: {g}  →  후보: {cands if cands else '(대체어 없음 — 문구를 다시 쓰세요)'}")
    print("\n  src/user/places.ts 의 gloss를 위 후보로 바꾸고 다시 실행하세요.")
    sys.exit(1)


if __name__ == "__main__":
    main()
