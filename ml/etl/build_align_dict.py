"""한국어 낱말 ↔ 글로스 대응 사전 만들기 (통계적 정렬).

    python -m ml.etl.build_align_dict --data <수어스크립트 out> --out public/data/align.json

**왜 필요한가.** KoBART(text2gloss)는 품질이 좋지만 500MB짜리 서버가 있어야 한다.
서버 없이 도는 정적 사이트에서도 임의 문장을 번역하려면 브라우저가 들고 다닐 수 있는
작은 사전이 필요하다. 현재 앱의 규칙 기반 `signAgent.ts`는 조사만 떼는 수준이라
"재난문자→수어"라고 부르기 어렵다. 이 사전은 **실제 16만 문장쌍에서 뽑은 대응**이다.

**어떻게 만드나.** 문장쌍 (한국어 원문, 글로스열)에서 공기(co-occurrence)를 세고
Dice 계수로 연관도를 잰다:

    dice(w, g) = 2·같이 나온 횟수 / (w 나온 횟수 + g 나온 횟수)

번역 모델처럼 어순까지 배우진 못하지만, "한파→춥다1", "대피→도망1" 같은 어휘 대응은
이 방식으로 충분히 잡힌다. 한국어는 교착어라 어미가 붙으므로 **어간 근사**로 맞춘다
(조사·어미를 떼고 2글자 이상 앞부분을 키로 삼는다).

출력은 `{"한파": ["춥다1", ...], ...}` 형태이며 낱말당 상위 후보 몇 개만 남긴다.
브라우저는 이 표를 훑어 문장을 글로스열로 바꾸고, 동작 사전에서 조각을 찾아 잇는다.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.signbridge.vocab import normalize_gloss  # noqa: E402

# 조사·어미. 한국어 형태소 분석기 없이 근사한다 — 사전 품질에 결정적이진 않다.
PARTICLE_RE = re.compile(
    r"(으로부터|로부터|에서는|에게서|께서는|하시기|하십시오|입니다|습니다|ㅂ니다"
    r"|하겠습니다|겠습니다|았습니다|었습니다|였습니다|습니까|ㅂ니까|을까요|ㄹ까요"
    r"|으십시오|십시오|으세요|세요|주세요|네요|지요|까요|어요|아요|여요|드리오니|되오니|하오니|오니"
    # 구어체 종결 — "어디예요·얼마예요·뭐예요"가 통째로 빠지고 있었다.
    # 사람이 앱에 처음 넣는 문장이 대개 이 말투다.
    r"|이에요|예요|에요|이야|인가요|인가|인데|이죠|죠|거예요|을게요|군요|잖아요|거든요|더라고요|던데요"
    r"|으로|에서|에게|에는|까지|부터|이나|라도|처럼|만큼|보다|이며|이고|하고"
    r"|하는|하여|해서|되어|되는|된다|하라|하세요|해요|이다|이란|라는"
    r"|은|는|이|가|을|를|와|과|의|도|만|로|에|께|랑|나)$"
)
TOKEN_RE = re.compile(r"[가-힣]+")
MIN_STEM = 2

# 번역 제외어 — 한국어 문법·공손 표현으로, 수어에서는 표현하지 않는 말들.
# 실측 감사에서 이런 낱말의 Dice 매핑이 전부 잡음이었다(바랍니다→조심1,
# 주시기→자동차2, 있습니다→기차1, 시까지→노래1 …). 키를 만들지 않으면
# 잡음이 사전에 들어올 길 자체가 없다. **TS(dictSignAgent.ts)와 같은 목록 유지.**
STOP_WORDS = {
    "바랍니다", "바라며", "바람니다", "주시기", "주십시오", "있습니다", "있는",
    "있으니", "있으면", "없습니다", "않도록", "않기", "됩니다", "되도록",
    "합니다", "하시기", "하도록", "인해", "인한", "위해", "위한", "통해",
    "통하여", "따라", "따른", "대한", "대해", "관련", "관한", "해당",
    "등의", "등을", "등이", "및", "또는", "그리고", "기타", "위하여", "인하여",
    "시까지", "분부터", "시부터", "분까지", "실시",
    # 재난문자 상투구 — suspect_align.py 상위에서 잡힌 것들.
    # "입니다 → mm", "것으로 → 오래", "등은 → 캠프", "내에서 → 금호동" 이었다.
    "입니다", "것으로", "것으로는", "등은", "등에", "등에서", "내에서", "기하여",
    "하기로", "되기로", "함에", "됨에", "이라고", "라고",
    "등으로", "등과", "이내", "도가량", "가량",
    # 창구 대화 실측에서 새로 드러난 잡음 — 공손·의뢰 표현(주세요→매일1 같은 오역원)
    "주세요", "주시", "드릴까요", "드릴게요", "드립니다", "드려요", "하겠습니다",
    "하시겠어요", "하시겠습니까", "부탁드립니다", "말씀해", "말씀", "여쭤",
}

# 수동 시드 — 통계가 놓치는 고빈도 대응을 사람이 확정한 것. 자신 있는 것만 넣는다.
# (실측 감사에서 발견된 잡음 1위 후보를 교정: 곳으로→편하다1 등)
SEED_OVERRIDES = {
    "곳으로": "장소1",
    "곳에서": "장소1",
    "안전": "안전1",
    "안전한": "안전1",
    "주민들": "주민0",
    "많은": "많다1",
    "여진": "지진1",
    # 금지("가지 마세요")는 수어에서 전용 표현이 있다. 통계는 '마세요'를 '마다'로 잡았다.
    "마세요": "하지마1",
    "마십시오": "하지마1",
    "말고": "하지마1",
    "금지": "하지마1",
    # 짧은 일상 회화에서 통째로 빠지던 것들(실측)
    "아니요": "아니다0",
    "아니오": "아니다0",
    "안녕히": "안녕0",
    "이거": "이것",
    "그거": "그것0",
    # 방향 — "대피소 어디?"의 답이 되는 낱말이다. 통계는 세 글자 방위어를
    # 통째로 엉뚱한 곳에 붙여 놨다(**북동쪽 → km**, 실측). 대피 방향을 틀리게
    # 말하는 것은 말하지 않는 것보다 나쁘므로 사람이 확정한다.
    "북동쪽": "북동",
    "북서쪽": "북서",
    "남동쪽": "남동",
    "남서쪽": "남서",
    "북쪽": "북쪽0",
    "남쪽": "남쪽0",
    "동쪽": "동쪽0",
    "서쪽": "서쪽1",
    "미터": "m",
    "킬로미터": "킬로미터",
    # ml/tools/suspect_align.py 로 뽑은 고빈도 오역을 사람이 검토해 교정한 것.
    # 괄호 안이 실제로 나오던 값이다.
    "매우": "심하다1",        # (WHO) — 미세먼지 문장에서 WHO와 함께 나온 잡음
    "확산": "퍼지다0",        # (목적1)
    "착용": "입다0",          # (마스크1) — 착용은 '쓰다/입다'이지 마스크가 아니다
    "없도록": "없다",         # (피해1)
    "한때": "가끔1",          # (먼지1)
    "관리": "돌보다0",        # (시설1)
    "주시고": "주다",         # (자동차2)
    "출근길": "가다1",        # 맞다 — 확정해 둔다
    # 2차 검토(suspect_align 상위 130)에서 나온 것들
    "권고": "부탁",           # (WHO)
    "당부드립니다": "부탁",    # (계량기2)
    "시간당": "시간1",        # (각각1)
    "있도록": "있다0",        # (노력1)
    "있으신": "있다0",        # (바쁘다1)
    "되었으니": "되다1",       # (세병)
    "내집": "집1",            # (빗자루1)
    "단독주택": "집1",        # (혼자1)
    "야외": "밖1",            # (행동1)
    "현장": "장소1",          # (해결1)
    "신속한": "빨리1",        # (노력1)
    "조속히": "빨리1",        # (노력1)
    "영향권": "영향1",        # (바비 — 태풍 이름이 낱말 자리에 들어와 있었다)
    "동참": "협조1",          # (들어오다1)
    # 창구 대화 실측에서 빠져 있던 것들 — 수어 클립이 없는 낱말을
    # **뜻이 가장 가까운 있는 낱말**로 잇는다(없는 것보다는 낫다).
    "복용": "먹다",           # 약을 먹는 것
    "피검사": "검사",
    "식후": "식사",
    "식전": "식사",
    "여기서": "여기",
    "저기서": "저기0",
    "천천히": "느리다",
    "매운": "맛0",           # 맵다는 클립이 없다 — '맛'으로 화제만 살린다
    "맛있게": "맛0",
    "맛있어요": "맛0",
    "졸음": "졸리다",
    # 숨(호흡)은 클립이 없고, 통계는 이것을 **숨다(몸을 숨기다)**로 잡았다.
    # "숨을 크게 들이쉬어 보세요"가 '숨다'로 나가면 뜻이 정반대가 된다.
    "숨을": "숨쉬다0",
    "숨이": "숨쉬다0",
    "숨은": "숨쉬다0",
    "호흡": "숨쉬다0",
    "들이쉬어": "숨쉬다0",
    "들이쉬세요": "숨쉬다0",
    "내쉬세요": "숨쉬다0",
    # 존대 '드시다'는 먹다다 — 통계는 '들다(들어올리다)'로 잡았다.
    # 병원·약국·식당에서 이 말이 나오면 거의 언제나 먹는 쪽이다.
    "드세요": "먹다",
    "드시면": "먹다",
    "드셨": "먹다",
    "드셨어요": "먹다",
    "드십니다": "먹다",
    "드시고": "먹다",
    "드시는": "먹다",
    "드실": "먹다",
    "드십시오": "먹다",
    # 일상 회화 홀드아웃(고칠 때 보지 않는 집합)에서 드러난 것들
    "계세요": "계시다1",
    "계셨어요": "계시다1",
    "글로": "글",
    "오랜": "오래1",
    "고파요": "배고프다",
    "고픈": "배고프다",
    "고프다": "배고프다",
}

# 조사·어미만으로 이루어진 표면형은 낱말이 아니다. 사전에 남으면 조사가 덜 떨어진
# 토큰이 여기에 걸려 엉뚱한 수어가 나간다(실측: **에서 → IC**).
PARTICLE_ONLY = {
    "에서", "에게", "에는", "으로", "로서", "로써", "까지", "부터", "이나", "라도",
    "처럼", "만큼", "보다는", "이며", "이고", "하고는", "에서는", "에게서", "으로부터",
}


# ── 용언 활용형 만들기 ────────────────────────────────────────────────
# **왜 빌드 시점에 하나.** 창구 대화 실측에서 빠진 낱말의 대부분이 활용형이었다
# (기다려·찍어·보여·뽑고·드세요·났나요…). 런타임 어간 추출기를 더 똑똑하게 만들 수도
# 있지만, 그러면 `dictSignAgent.ts`와 규칙을 **양쪽에서 똑같이** 유지해야 한다 —
# 이 프로젝트에서 가장 찾기 어려운 실패가 바로 그 비대칭이다. 활용형을 미리 펼쳐
# 사전 키로 넣으면 런타임은 그대로 두고도 찾을 수 있다.
#
# 어간 + 아/어 가 한 글자로 합쳐지는 것을 되돌리는 규칙(한글 조합 계산):
#   하 + 여 → 해 · 기다리 + 어 → 기다려 · 보 + 아 → 봐 · 주 + 어 → 줘
_CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
# 어간 끝 모음 → 아/어가 붙어 합쳐진 모음
_FUSE = {"ㅣ": "ㅕ", "ㅗ": "ㅘ", "ㅜ": "ㅝ", "ㅚ": "ㅙ", "ㅏ": "ㅏ", "ㅓ": "ㅓ", "ㅐ": "ㅐ", "ㅔ": "ㅔ"}
# 양성모음이면 '아', 아니면 '어'가 붙는다(모음조화).
_BRIGHT = {"ㅏ", "ㅗ", "ㅑ", "ㅛ"}
# 어간 + 아/어 + 지다 꼴 — 넘다/넘어지다처럼 별개의 낱말이 되는 자리다.
_PASSIVE_RE = re.compile(r"(집니다|졌)$")

# **뜻이 전적으로 어간에 있는 어미들.**
#
# "많겠습니다"의 뜻은 '많다'이지 다른 무엇도 아니다. 그런데 날씨 문장에서 이 말이
# '구름'과 자주 함께 나오는 바람에 공기 통계가 **많겠습니다 → 구름2**를 1순위로
# 올려 두었다(실측). 같은 식으로 있겠습니다 → 소나기, 받겠습니다 → 고기압,
# 오겠습니다 → 구름, 들겠습니다 → 고기압이었다 — 재난문자에서 가장 흔한 말투다.
#
# 이런 순수 문법 어미로 끝나는 표면형은 **빈도와 무관하게** 어간의 글로스를 쓴다.
# 명사가 이 꼴로 끝나는 일은 없어서 다른 낱말과 부딪힐 위험도 없다.
_GRAMMAR_END = (
    "겠습니다", "겠으니", "겠고", "겠다", "겠지만", "겠네요", "겠어요", "겠는데", "겠으며",
    "습니다", "습니까", "ㅂ니다",
    "세요", "십시오", "십니다", "십니까", "시나요", "나요",
    "셨어요", "셨습니다", "셨나요", "셨는데", "신가요", "실까요", "시겠",
    "으세요", "으십시오", "을까요", "을게요", "으시면", "으신가요",
    "았습니다", "었습니다", "였습니다",
)


def _decompose(ch: str) -> tuple[int, int, int] | None:
    code = ord(ch) - 0xAC00
    if not (0 <= code < 11172):
        return None
    return code // 588, (code % 588) // 28, code % 28


def _compose(cho: int, jung: int, jong: int) -> str:
    return chr(0xAC00 + cho * 588 + jung * 28 + jong)


def conjugations(stem_word: str) -> list[str]:
    """어간 하나에서 자주 쓰는 활용형을 만든다. 확실한 것만 — 과생성은 오역이 된다."""
    if len(stem_word) < 1:
        return []
    # 종결·연결 어미. 런타임 어간 추출기가 떼지 못하거나(나요·시나요),
    # 떼고 나면 한 글자만 남아 버려지는 것들(오세요 → '오')을 키로 직접 넣는다.
    forms = [
        stem_word + s
        for s in ("고", "지", "게", "며", "면", "니", "세요", "십시오", "시고",
                  # 관형형 -는 — 받는·먹는·오는. 빠져 있어서 '받는 → 영동'이었다.
                  "는", "던",
                  # 명사형 -기 — 숨쉬기·걷기·기다리기. 창구 문장에 흔하다
                  # ('숨쉬기 힘드신가요'가 통째로 빠져 있었다).
                  "기", "기가", "기를", "기도",
                  # -ㄹ래요/-을래요 — 마실래요·갈래요·먹을래요. 제안·의향의 기본 꼴이다.
                  "래요", "을래요", "ㄹ래요",
                  "나요", "시나요", "셨", "시면", "는데", "지만", "려고",
                  "신지", "시는지", "실", "십니까", "시겠",
                  # 존대·추측·의향 — 창구에서 실제로 쓰이는 말투다(홀드아웃 실측에서
                  # "오셨나요·아프신가요·잡을까요"가 통째로 빠졌다).
                  "셨나요", "셨어요", "셨습니다", "셨는데", "신가요", "실까요", "십니다",
                  "겠어요", "겠는데", "시죠", "시네요",
                  # 날씨·재난문자의 기본 말투다. 없어서 "많겠습니다·있겠으니·
                  # 오겠습니다"가 통째로 빠지고 그 자리를 공기 통계 잡음이 채웠다
                  # (있겠습니다 → 소나기1, 받겠습니다 → 고기압1).
                  "겠습니다", "겠으니", "겠고", "겠다", "겠지만", "겠네요", "겠으며",
                  # 1음절 어간(좋다·많다·크다)은 어미를 떼면 한 글자만 남아 버려진다.
                  # 종결형을 통째로 키에 넣어야 "좋네요·많군요"가 잡힌다.
                  "네요", "군요", "잖아요", "거든요", "던데요", "더라고요")
    ]
    parts = _decompose(stem_word[-1])
    if parts is None:
        return forms
    cho, jung, jong = parts
    vowel = _JUNG[jung]
    harmonic: list[str] = []  # 아/어가 결합한 꼴 — 과거형의 뿌리가 된다
    if jong:
        # 받침이 있으면 합쳐지지 않고 그대로 붙는다: 찍 + 어 → 찍어
        harmony = "아" if vowel in _BRIGHT else "어"
        harmonic.append(stem_word + harmony)
        forms += [stem_word + harmony, stem_word + harmony + "요",
                  stem_word + harmony + "서", stem_word + harmony + "야",
                  stem_word + harmony + "집니다", stem_word + harmony + "졌"]
        forms += [stem_word + "은", stem_word + "습니다", stem_word + "습니까",
                  stem_word + "으면", stem_word + "으세요", stem_word + "으니",
                  stem_word + "을", stem_word + "을까요", stem_word + "을게요", stem_word + "으시면",
                  stem_word + "으셨", stem_word + "으신가요"]
    else:
        # 받침이 없으면 'ㅂ니다'가 받침으로 붙는다: 오 + ㅂ니다 → 옵니다
        head = stem_word[:-1]
        forms.append(head + _compose(cho, jung, 17) + "니다")  # 17 = 종성 ㅂ
        forms.append(head + _compose(cho, jung, 4) + "다")  # 4 = 종성 ㄴ (온다·간다)
        forms.append(head + _compose(cho, jung, 4))  # 관형형: 나온·온·간
        # 받침 없는 어간에는 'ㄹ'이 받침으로 붙는다: 되 + ㄹ까요 → 될까요
        forms.append(head + _compose(cho, jung, 8) + "까요")
        forms.append(head + _compose(cho, jung, 8) + "게요")
        forms.append(head + _compose(cho, jung, 8))  # 관형형: 갈·볼·나갈
        if vowel in ("ㅏ", "ㅓ", "ㅐ", "ㅔ"):
            # 같은 모음이 겹치면 하나로 줄어든다: 가 + 아 → 가 · 서 + 어 → 서
            harmonic.append(stem_word)
            forms += [stem_word, stem_word + "요", stem_word + "서"]
        elif vowel == "ㅡ" and len(stem_word) >= 2:
            # ㅡ 탈락 — 아프다 → 아파, 쓰다 → 써, 바쁘다 → 바빠.
            # 붙는 모음은 **앞 음절**의 모음이 정한다(아프 → 앞이 ㅏ라 '아' → 아파).
            prev = _decompose(stem_word[-2])
            bright = prev is not None and _JUNG[prev[1]] in _BRIGHT
            dropped = stem_word[:-1] + _compose(cho, _JUNG.index("ㅏ" if bright else "ㅓ"), 0)
            harmonic.append(dropped)
            forms += [dropped, dropped + "요", dropped + "서", dropped + "야"]
        elif vowel in _FUSE:
            fused = stem_word[:-1] + _compose(cho, _JUNG.index(_FUSE[vowel]), 0)
            harmonic.append(fused)
            forms += [fused, fused + "요", fused + "서", fused + "야"]
    # '하다' 용언은 '해'로 — 가장 흔한 불규칙이라 따로 둔다(공부하다 → 공부해).
    # **-요·-서·-야까지 함께 만들어야 한다.** '해'만 넣어 두는 바람에 한국어에서
    # 가장 흔한 종결형 중 하나인 **"해요"가 통째로 빠져 있었다**(실측: 일상 회화
    # 홀드아웃에서 '해요'가 네 번 빠짐 — 병원에 가야 해요·집에 가야 해요…).
    if stem_word.endswith("하"):
        h = stem_word[:-1] + "해"
        forms += [h, h + "요", h + "서", h + "야", h + "주세요"]
        harmonic.append(h)
    # ㄹ 불규칙 — 받침 ㄹ은 ㄴ·ㅂ·ㅅ 앞에서 떨어진다: 들다 → 드세요·듭니다, 살다 → 사세요
    if parts is not None and jong == 8:  # 8 = 종성 ㄹ
        bare = stem_word[:-1] + _compose(cho, jung, 0)
        forms += [bare + "세요", bare + "십시오", bare + "니", bare + "시고",
                  bare[:-1] + _compose(cho, jung, 17) + "니다",
                  # 존대·의문 꼴도 함께 — '힘드신가요·드셨어요·모실까요'가 빠져 있었다
                  bare + "신가요", bare + "신지", bare + "실까요", bare + "실",
                  bare + "셨", bare + "셨어요", bare + "셨습니다", bare + "셨나요",
                  bare + "시면", bare + "시는지"]
    # ㅂ 불규칙 — 맵다 → 매운·매워, 춥다 → 추운·추워. 감각 형용사가 대부분 여기 속한다.
    if parts is not None and jong == 17:  # 17 = 종성 ㅂ
        # **모음조화를 지켜야 한다.** 돕다는 '도워'가 아니라 **도와**다(밝은 모음 ㅗ).
        # 이걸 틀리는 바람에 "도와주세요"가 사전에 없어, 통계 잡음인 '도'(도수)로
        # 번역되고 있었다 — 사람이 가장 먼저 쓰는 말 중 하나다.
        bare = stem_word[:-1] + _compose(cho, jung, 0)
        vow = "와" if vowel in _BRIGHT else "워"
        forms += [bare + "운", bare + vow, bare + vow + "요", bare + vow + "서",
                  bare + "우면", bare + vow.replace("와", "왔").replace("워", "웠"),
                  # -우니·-우며·-울까요·-웠어요 — 실측에서 '미끄러우니'가 통째로
                  # 빠져 통계 잡음('익숙하다')이 그 자리를 차지하고 있었다.
                  bare + "우니", bare + "우며", bare + "우세요", bare + "울까요",
                  bare + "웠어요", bare + "웠습니다", bare + "우신가요"]
        harmonic.append(bare + vow)
    # 르 불규칙 — 누르다 → 눌러, 빠르다 → 빨라, 다르다 → 달라.
    if len(stem_word) >= 2 and stem_word.endswith("르"):
        prev = _decompose(stem_word[-2])
        if prev is not None and prev[2] == 0:
            head = stem_word[:-2] + _compose(prev[0], prev[1], 8)  # 앞 글자에 ㄹ 받침
            tail = "라" if _JUNG[prev[1]] in _BRIGHT else "러"
            forms += [head + tail, head + tail + "요", head + tail + "서"]
            harmonic.append(head + tail)

    # 과거형 — "왔어요·먹었습니다·기다렸어요". 창구 대화에 흔한데 통째로 빠져 있었다.
    # **아/어 결합형에서만** 만든다. 모든 활용형에 붙이면 "먹습니닸어요" 같은 것이 나온다.
    past: list[str] = []
    for f in harmonic:
        last = _decompose(f[-1])
        if last is None:
            continue
        if last[2] == 0:
            stem_past = f[:-1] + _compose(last[0], last[1], 20)  # 20 = 종성 ㅆ
        else:
            continue
        past += [stem_past + "어요", stem_past + "습니다", stem_past + "다", stem_past + "는데",
                 stem_past + "나요", stem_past + "습니까", stem_past + "어서", stem_past + "지만"]
    forms += past
    return forms


# 한 글자 명사에 붙는 조사 — 코와·입을·손과·문을·벽을·눈이 …
# **왜 따로 다루나.** 런타임 어간 추출기는 조사를 뗀 결과가 두 글자 미만이면 원형을
# 되돌린다(MIN_STEM). 그래서 **한 글자 명사는 조사가 붙는 순간 통째로 못 찾는다.**
# 하필 몸 부위와 생활 명사가 대부분 한 글자다 — 코·입·손·눈·목·배·발·귀·문·벽·물·약·
# 열·피·밥·길·돈. 행동요령 실측에서 "젖은 수건으로 코와 입을 가리세요"가 '수건' 하나만
# 표현된 것이 이 때문이었다. 조사가 붙은 꼴을 미리 키로 만들어 둔다.
# 받침 유무로 갈리는 조사는 짝지어 둔다(받침 있음, 받침 없음).
# **격조사**(주격·목적격·주제) — 이게 붙으면 앞은 거의 확실히 명사다.
CASE_PAIRS = (("은", "는"), ("이", "가"), ("을", "를"))
# 접속·부사격 — 동사 활용형과 부딪히기 쉬워 명사 우선권을 주지 않는다.
# 실측: '도'(도수) + '와' = "도와"가 돕다의 활용형을 덮어 "도와주세요"가 '도'가 됐다.
CONJ_PAIRS = (("과", "와"), ("으로", "로"), ("이나", "나"), ("이랑", "랑"))
# 받침과 무관한 조사
PARTICLE_BOTH = ("의", "도", "만", "에", "에서", "에게", "부터", "까지", "보다", "처럼",
                 # 구어체 종결 — "뭐예요·물이에요"
                 "예요", "이에요", "인가요", "인데", "죠", "요")

# 명사에서 파생되는 용언 꼴 — 침수된·대피하세요·통제한 …
NOUN_VERB_SUFFIXES = ("하다", "한", "할", "하는", "하고", "해", "하세요", "합니다",
                      "되다", "된", "될", "되는", "되고", "돼", "됐",
                      # 어간만 남는 꼴 — "확인되었습니다"는 어미를 떼면 '확인되'가 된다
                      # (런타임 어간 추출기가 '되었습니다'까지는 못 뗀다). 나머지 활용은
                      # 어간 추출기가 떼므로 여기서는 **어간 둘만** 넣는다 — 접미사를
                      # 늘릴수록 사전이 커지는데(8개 넣으니 4.7 → 6.4MB) 얻는 건 적었다.
                      "하", "되")


# 한 글자 낱말 중 **단독으로 나와도 그 뜻인 것**만 골라 둔다.
#
# 왜 목록으로 두나: 동작 사전에는 지문자 자모('가' 같은 음절 표기)도 1글자 표제어로
# 들어 있어, 전부 키로 넣으면 "천천히 가 주세요"의 '가'가 지문자로 번역된다(실측).
# 그렇다고 다 버리면 "밥 먹었어요"의 밥, "물 주세요"의 물이 통째로 사라진다 —
# 생활에서 가장 자주 쓰는 낱말이 하필 한 글자다. 그래서 사람이 확인한 목록만 쓴다.
ONE_CHAR_NOUNS = {
    "밥", "물", "눈", "코", "입", "손", "발", "목", "배", "귀", "돈", "약", "열", "집",
    "길", "차", "피", "불", "산", "강", "비", "옷", "책", "문", "벽", "밤", "낮", "봄",
    "힘", "병", "술", "국", "땅", "별", "빵", "새", "쌀", "몸", "잠", "글", "섬", "숲",
    "뼈", "꽃", "형", "층", "번", "명", "시", "분", "년", "월", "일", "원", "개",
    # 대명사·의문사 — "뭐예요·왜요·너는" 같은 짧은 말이 대화의 절반이다
    "뭐", "왜", "더", "너", "나", "저",
}


def noun_forms(lemma: str) -> tuple[list[str], list[str]]:
    """명사 표제어에서 (격조사가 붙은 꼴, 그 밖의 파생형)을 만든다.

    둘을 나누는 이유: **격조사가 붙은 꼴은 명사가 거의 확실하다.** "입을"은 입(신체)에
    목적격 조사가 붙은 것으로 읽는 편이 맞다 — 입다(착용)의 관형형이기도 하지만,
    격조사 쪽이 훨씬 흔하다. 반면 "-하다/-되다" 같은 파생형은 동사 활용형과 부딪히면
    동사가 맞을 때가 많다(도와 = 돕다). 그래서 격조사만 동사형을 덮게 한다.
    """
    case: list[str] = []
    other: list[str] = []
    # 한 글자 명사만 조사를 펼친다 — 두 글자 이상은 런타임 어간 추출기가 처리한다.
    if len(lemma) == 1:
        parts = _decompose(lemma)
        has_jong = parts is not None and parts[2] != 0
        case += [lemma + (a if has_jong else b) for a, b in CASE_PAIRS]
        other += [lemma + (a if has_jong else b) for a, b in CONJ_PAIRS]
        other += [lemma + p for p in PARTICLE_BOTH]
    other += [lemma + s for s in NOUN_VERB_SUFFIXES]
    return case, other


def stem(word: str) -> str:
    """조사·어미를 떼어 어간을 근사한다. 너무 짧아지면 원형을 남긴다."""
    prev = None
    out = word
    # 어미가 겹쳐 붙는 경우가 있어 더 줄어들지 않을 때까지 반복한다.
    while out != prev:
        prev = out
        stripped = PARTICLE_RE.sub("", out)
        if len(stripped) >= MIN_STEM:
            out = stripped
    return out if len(out) >= MIN_STEM else word


def tokenize(text: str) -> list[str]:
    return [
        stem(t) for t in TOKEN_RE.findall(text)
        if len(t) >= MIN_STEM and t not in STOP_WORDS and stem(t) not in STOP_WORDS
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="한국어↔글로스 통계 사전")
    parser.add_argument("--data", type=Path, required=True, help="index.jsonl이 있는 디렉터리")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--top", type=int, default=3, help="낱말당 남길 글로스 후보 수")
    parser.add_argument("--min-pair", type=int, default=5, help="이보다 드문 공기는 버린다")
    parser.add_argument("--min-dice", type=float, default=0.06)
    parser.add_argument(
        "--conj-trust", type=int, default=1500,
        help="표면형이 말뭉치에 이 횟수 미만으로 나오면 통계보다 활용형(어간)을 앞세운다. "
             "0이면 예전 동작(통계 우선). 기본값은 0·20·50·200·400·800·1500을 실제로 "
             "돌려 **바뀌는 매핑을 한 줄씩 눈으로 보고** 정했다. 이 수치가 커질수록 "
             "형태론이 통계를 더 많이 덮는다")
    parser.add_argument("--vocab", type=Path, default=None,
                        help="동작 사전 bank.json — 있으면 표현 가능한 글로스만 남긴다")
    args = parser.parse_args()

    playable: set[str] | None = None
    if args.vocab and args.vocab.exists():
        playable = set(json.loads(args.vocab.read_text(encoding="utf-8")).keys())
        # **주석 글로스는 번역 후보에서 뺀다.** 원본 말뭉치에는 "날짜:9월16일",
        # "시:15", "시간:2시간" 같은 클립이 있는데, 이건 낱말이 아니라 그 문장에만
        # 해당하는 숫자 주석이다. 공기 통계는 이걸 자주 1순위로 올려 놓았다 —
        # 실측에서 "주택→날짜:9월16일", "많음→날짜:12월13일", "민방위훈련→시간:15분"
        # 처럼 **낱말 2만 개**가 뜻과 무관한 날짜 동작을 가리키고 있었다.
        # 숫자·시각은 앱이 직접 읽어 표현하므로(numberGlosses) 여기서 뺀다.
        annotated = {g for g in playable if ":" in g}
        playable -= annotated
        print(f"[align] 동작 사전 {len(playable):,}종으로 후보를 제한합니다"
              f" (날짜·시각 주석 {len(annotated):,}종 제외)")

    word_count: Counter = Counter()
    gloss_count: Counter = Counter()
    pair_count: dict[str, Counter] = defaultdict(Counter)
    sentences = 0

    for line in open(args.data / "index.jsonl", encoding="utf-8"):
        record = json.loads(line)
        korean = record.get("korean_text") or ""
        glosses = {normalize_gloss(g.get("gloss", "")) for g in record.get("glosses", [])}
        glosses = {g for g in glosses if g and (playable is None or g in playable)}
        words = set(tokenize(korean))
        if not words or not glosses:
            continue
        sentences += 1
        for w in words:
            word_count[w] += 1
            for g in glosses:
                pair_count[w][g] += 1
        for g in glosses:
            gloss_count[g] += 1
        if sentences % 20000 == 0:
            print(f"  [align] 문장 {sentences:,}개 처리", flush=True)

    print(f"[align] 문장 {sentences:,} · 낱말 {len(word_count):,} · 글로스 {len(gloss_count):,}")

    # 글로스 ID는 "조심1"처럼 한국어 표제어+번호다. 표제어가 낱말과 정확히 같으면
    # 그 자체가 가장 믿을 만한 번역이다 — Dice가 잡음으로 엉뚱한 후보를 1위에 올려도
    # (실례: 조심→비닐하우스0) 표제어 일치가 있으면 그걸 앞세운다.
    lemma_re = re.compile(r"[0-9#:]+$")
    lemma_best: dict[str, str] = {}
    for g in (playable if playable is not None else gloss_count):
        lemma = lemma_re.sub("", g)
        # **한 글자 표제어도 담는다.** 예전 조건(>= MIN_STEM)이 약·열·코·입·손·목·문·벽을
        # 통째로 걸러, 조사가 붙은 꼴(약이·열이·코와)을 만들 기회조차 없었다.
        if len(lemma) >= 1:
            # 번호가 작은 변이형(기본형)을 남긴다: 조심1 > 조심2
            if lemma not in lemma_best or g < lemma_best[lemma]:
                lemma_best[lemma] = g

    table: dict[str, list[str]] = {}
    for word, counts in pair_count.items():
        if word_count[word] < args.min_pair:
            continue
        scored = []
        for gloss, both in counts.items():
            if both < args.min_pair:
                continue
            dice = 2 * both / (word_count[word] + gloss_count[gloss])
            if dice < args.min_dice:
                continue
            scored.append((dice, gloss))
        if not scored:
            continue
        scored.sort(reverse=True)
        cands = [g for _, g in scored[: args.top]]
        # 용언 표제어는 "-다"형(기다리다1)이라 어간("기다리")과 어긋난다 — 둘 다 본다.
        exact = lemma_best.get(word) or lemma_best.get(word + "다")
        if not exact and word.endswith("기"):
            exact = lemma_best.get(word[:-1] + "다")  # 마시기 → 마시다
        if exact:
            cands = [exact] + [g for g in cands if g != exact]
        table[word] = cands[: args.top]

    # 공기 통계에 안 잡혔더라도 표제어가 곧 낱말인 글로스는 사전에 넣는다 —
    # 지명·희귀어 커버리지가 공짜로 늘어난다.
    added = 0
    # 표제어에서 직접 만든 키 — 나중에 통계·활용형이 덮지 못하게 표시해 둔다.
    lemma_keys: set[str] = set()
    for lemma, g in lemma_best.items():
        # 한 글자 표제어는 **확인된 목록만** 직결 키로 넣는다(지문자 자모 혼입 방지).
        if len(lemma) < MIN_STEM and lemma not in ONE_CHAR_NOUNS:
            continue
        if lemma not in table:
            table[lemma] = [g]
            lemma_keys.add(lemma)
            added += 1
        # 용언은 어간형 키도 함께 — "기다리다1"을 "기다리"(어간)로도 찾게 한다.
        if lemma.endswith("다") and len(lemma) >= 3 and lemma[:-1] not in table:
            table[lemma[:-1]] = [g]
            lemma_keys.add(lemma[:-1])
            added += 1
    print(f"[align] 표제어 직결 추가 {added:,}개 (Dice 미포착분)")

    # 용언 활용형 — 창구 대화에서 빠진 낱말의 대부분이 이것이었다(기다려·찍어·뽑고…).
    # 이미 있는 키는 건드리지 않는다(Dice가 실제로 관측한 대응이 우선).
    conj = 0
    noun = 0
    # 형태론으로 만들어 낸 키는 뒤의 복합어 프루닝에서 빼야 한다. 안 그러면 "아프신지"가
    # "아프 + 신지(신다)"로 분해된다고 보고 지워져, 실제 번역이 '아프다 신다'가 된다.
    derived: set[str] = set()
    # **빈도가 높은 표제어가 먼저 가져간다.** 같은 표면형을 두 낱말이 만들 수 있기 때문이다
    # (아프시+ㄴ지 = 아프신지, 신+지 = 신지). 흔한 쪽이 맞을 확률이 높다.
    ordered = sorted(lemma_best.items(), key=lambda kv: -gloss_count.get(kv[1], 0))

    # **용언을 먼저 세운다.** 명사 + 조사가 동사 활용형과 같은 꼴이 되는 경우가 있다:
    # '도'(도수) + '와' = "도와" = 돕다의 활용형. 명사 쪽이 나중에 덮어쓰는 바람에
    # "도와주세요"가 '도'로 번역되고 있었다 — 사람이 가장 먼저 쓰는 말 중 하나다.
    # **드물게 관측된 활용형은 형태론이 이긴다.**
    #
    # 원래는 "이미 있는 키는 건드리지 않는다"였다. Dice가 실제로 본 대응이 우선이라는
    # 뜻이었는데, 말뭉치에 몇 번 안 나온 표면형은 그 관측 자체가 잡음이다. 실측에서
    # "숨을 크게 들이쉬어 보세요"의 **크게 → 차이1**(크다0이 있는데도)처럼, 뜻이
    # 전혀 다른 글로스가 1순위를 차지하고 있었다. 활용형은 어차피 어간의 뜻을 따르므로
    # 관측이 얇을 때는 어간에서 만든 것이 맞을 확률이 훨씬 높다.
    #
    # 예외가 셋 있다. 없으면 오히려 나빠지는 것들이라 실제 차이 목록을 보고 넣었다.
    #
    #  ① **표면형이 그 자체로 표제어이면** 건드리지 않는다. 사고·신고·참고·안면은
    #     활용형처럼 생겼지만(사+고, 신+고, 참+고, 안+면) 그 자체가 낱말이다.
    #     이 예외가 없으면 "사고"가 '사다'가 되어 재난문자가 통째로 뒤집힌다.
    #  ② **표제어에서 직접 만든 키**(아니다 → '아니')도 건드리지 않는다.
    #  ③ **이미 다른 용언이 가져간 자리**도 건드리지 않는다. 이 반복문은 흔한 낱말부터
    #     도는데, 덮어쓰기를 허용하면 **드문 쪽이 나중에 훔쳐 간다**:
    #     떨어집니다(떨어지다)를 '떨다'가, 마시고(마시다)를 '말다'가 가져갔다.
    #  ④ **-어지다 꼴**(넘어집니다·떨어졌)로는 덮지 않는다. 어간 + 어 + 지다는
    #     그 자체가 별개의 낱말인 경우가 많아(넘다 ≠ 넘어지다, 떨다 ≠ 떨어지다)
    #     덮으면 뜻이 바뀐다. 새로 채우는 것은 그대로 한다.
    #
    # 통계 관측을 다 버리지는 않는다 — 자주 나온 표면형은 그대로 둔다.
    for lemma, g in ordered:
        if not (lemma.endswith("다") and len(lemma) >= 2):
            continue
        for form in conjugations(lemma[:-1]):
            if len(form) < MIN_STEM or form in STOP_WORDS:
                continue
            if form not in table:
                table[form] = [g]
                derived.add(form)
                conj += 1
            elif (table[form][0] != g
                  and form not in lemma_best          # 그 자체가 표제어면 건드리지 않는다
                  and form not in lemma_keys          # 표제어에서 직접 만든 키도
                  and form not in derived             # 더 흔한 용언이 이미 가져간 자리도
                  and not _PASSIVE_RE.search(form)    # -어지다 꼴은 뜻이 달라진다
                  and (form.endswith(_GRAMMAR_END)    # 순수 문법 어미는 빈도 무관
                       or word_count.get(form, 0) < args.conj_trust)):
                # 관측이 얇다 — 어간에서 만든 글로스를 앞세우고 통계는 후보로 남긴다
                table[form] = [g] + [x for x in table[form] if x != g][: args.top - 1]
                derived.add(form)
                conj += 1

    # **-어지다 낱말은 자기 활용형을 되찾는다.**
    # 넘다·떨다 같은 짧고 흔한 용언이 "넘어집니다·떨어졌"를 만들어 내는 바람에,
    # 정작 그 꼴의 주인인 넘어지다·떨어지다가 자리를 잃는다. 더 긴 쪽이 더 구체적인
    # 낱말이므로 마지막에 한 번 되돌려 준다(실측: 넘어집니다 → '넘다'로 뒤집혀 있었다).
    reclaimed = 0
    for lemma, g in ordered:
        if not (lemma.endswith("지다") and len(lemma) >= 4):
            continue
        for form in conjugations(lemma[:-1]):
            if len(form) < MIN_STEM or form in STOP_WORDS or form in lemma_best:
                continue
            if table.get(form, [None])[0] != g:
                table[form] = [g] + [x for x in table.get(form, []) if x != g][: args.top - 1]
                derived.add(form)
                reclaimed += 1
    print(f"[align] -어지다 활용형 회수 {reclaimed:,}개")

    for lemma, g in ordered:
        if lemma.endswith("다") and len(lemma) >= 2:
            continue
        case_forms, other_forms = noun_forms(lemma)
        for form in case_forms + other_forms:
            if len(form) < MIN_STEM or form in STOP_WORDS:
                continue
            if form in table:
                # 표제어 + 조사는 통계보다 앞세운다("안전한→편하다1", "물을→끓다1"은
                # 공기 통계의 잡음이었다). 다만 **용언 활용형을 덮는 것은 격조사만**
                # 허용한다 — '도와'(돕다)는 동사가, '입을'(입+을)은 명사가 맞다.
                if table[form][0] == g:
                    continue
                if form in derived and form not in case_forms:
                    continue
                table[form] = [g] + [x for x in table[form] if x != g][: args.top - 1]
            else:
                table[form] = [g]
            derived.add(form)
            noun += 1

    print(f"[align] 용언 활용형 추가 {conj:,}개 · 명사 조사/파생형 추가 {noun:,}개")

    # 복합어 통짜 키 제거 — "대피바랍니다"·"안전사고"처럼 두 낱말 이상으로 분해되는
    # 키는 지운다. 통짜 키의 Dice 매핑은 잡음이기 쉽고(실측: 대피바랍니다→낚시1,
    # 민방위훈련→시간:15분), 키가 없으면 브라우저가 최장일치 분해로 각 조각을
    # 정확히 번역한다. 표제어 직결 키(그 자체가 사전 표제어)는 지우지 않는다.
    def decomposes(word: str) -> bool:
        """낱말 전체가 사전 조각으로 덮이는가 — 브라우저의 분해와 **같은 판정**이어야 한다.

        런타임(dictSignAgent.ts)은 낱말 전체를 덮는 분해를 찾는다. 여기서 탐욕적으로
        판정하면 "런타임은 분해할 수 있는데 빌더는 못 한다"가 되어, 지워도 될 잡음 키가
        남거나 남겨야 할 키가 지워진다. 그래서 여기도 전체 덮기로 본다.
        """
        n = len(word)
        reachable = [False] * (n + 1)
        reachable[n] = True
        for i in range(n - 1, -1, -1):
            for length in range(min(n - i, 6), MIN_STEM - 1, -1):
                if not reachable[i + length]:
                    continue
                piece = word[i : i + length]
                if piece != word and (piece in table or piece in STOP_WORDS):
                    reachable[i] = True
                    break
        if not reachable[0]:
            return False
        # 조각이 둘 이상이어야 분해로 친다(한 조각 = 자기 자신은 분해가 아니다).
        return any(
            reachable[length] and word[:length] != word
            for length in range(MIN_STEM, min(n, 6) + 1)
        )

    pruned = 0
    for word in list(table):
        if len(word) >= 4 and word not in lemma_best and word not in derived and decomposes(word):
            del table[word]
            pruned += 1
    print(f"[align] 분해 가능한 복합 키 {pruned:,}개 제거 (조각 번역 우선)")

    # 수동 시드는 마지막에 강제 — 통계·프루닝 결과와 무관하게 1순위를 보장한다.
    # **행정단위·시점을 뗀 어간이 사전에 있으면 그것을 쓴다.**
    # "부산시 → 회의", "서울시 → 대곡", "증상시 → 발열", "접촉시 → 짧다"처럼
    # 통짜 키의 통계는 잡음이기 쉽다. 어간이 그대로 표제어면 그것이 답이다
    # (부산시는 부산이고, 발열시는 발열이다).
    # '면'과 '도'는 뺀다 — 용언 어미(-면)·조사(-도)와 부딪힌다(가시면 → '가시'가 됐다).
    ADMIN_SUFFIX = ("특별자치시", "특별자치도", "특별시", "광역시", "시", "군", "구", "읍", "동")
    trimmed = 0
    for word in list(table):
        if word in lemma_best:      # 그 자체가 표제어면 둔다(장흥군은 '장흥군'이 있다)
            continue
        for suf in ADMIN_SUFFIX:
            if word.endswith(suf) and len(word) - len(suf) >= 2:
                stem = word[: -len(suf)]
                g = lemma_best.get(stem)
                # 이미 그 낱말을 가리키고 있으면 두다 — 가평군 → 가평1 은 맞는 답이고,
                # 이형태 번호만 바꾸는 것은 아무 의미가 없다.
                if g and lemma_re.sub("", table[word][0]) != stem:
                    table[word] = [g] + [x for x in table[word] if x != g][: args.top - 1]
                    trimmed += 1
                break
    print(f"[align] 행정단위·시점 어간 교정 {trimmed}개")

    dropped = 0
    for word in PARTICLE_ONLY:
        if table.pop(word, None) is not None:
            dropped += 1
    print(f"[align] 조사 전용 키 {dropped}개 제거")

    seeded = 0
    for word, g in SEED_OVERRIDES.items():
        if playable is not None and g not in playable:
            print(f"[align] ⚠️ 시드 {word}→{g} 는 동작 사전에 없어 건너뜀")
            continue
        prev = [x for x in table.get(word, []) if x != g]
        table[word] = [g] + prev[: args.top - 1]
        seeded += 1
    print(f"[align] 수동 시드 {seeded}개 적용")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(table, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    size = args.out.stat().st_size / 1024
    print(f"[align] 낱말 {len(table):,}개 → {args.out} ({size:.0f}KB)")

    demo = ["한파", "대피", "지진", "호우", "산불", "주의", "태풍", "마스크", "대설", "화재"]
    print("[align] 표본:")
    for w in demo:
        if w in table:
            print(f"   {w:<6} → {' / '.join(table[w])}")


if __name__ == "__main__":
    main()
