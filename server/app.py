"""SignBridge — KoGPT2 Q&A 언어 백본 서버.

재난 상황 + 농인 사용자 질문을 받아 KoGPT2(skt/kogpt2-base-v2)로 한국어 응답을
생성한다. 4-에이전트의 (c) Q&A 에이전트가 이 엔드포인트를 호출한다(브라우저의
KoGPT2Backbone → HTTP). KoGPT2-base는 지시(instruction) 튜닝이 안 된 순수 LM이라
출력이 거칠 수 있으므로, 프런트엔드는 실패/저품질 시 템플릿 백본으로 자동 폴백한다.

실행:
    pip install -r server/requirements.txt   # torch는 사전 설치 가정
    uvicorn server.app:app --port 8000
"""
from __future__ import annotations

import json
import re
from functools import lru_cache

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

MODEL_NAME = "skt/kogpt2-base-v2"

app = FastAPI(title="SignBridge KoGPT2 Q&A")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 데모용. 실서비스는 프런트 오리진으로 제한.
    allow_methods=["*"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def load_model():
    """최초 호출 시 1회 로드(첫 요청에서 모델 다운로드/적재)."""
    import torch  # noqa: F401
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(
        MODEL_NAME,
        bos_token="</s>",
        eos_token="</s>",
        unk_token="<unk>",
        pad_token="<pad>",
        mask_token="<mask>",
    )
    model = AutoModelForCausalLM.from_pretrained(MODEL_NAME)
    model.eval()
    return tok, model


class QARequest(BaseModel):
    question: str
    disaster_type: str = "재난"
    severity: str = "경보"
    region: str = ""


class QAResponse(BaseModel):
    answer: str
    backend: str = "kogpt2"
    raw: str = ""


def build_prompt(req: QARequest) -> str:
    loc = f"위치: {req.region}\n" if req.region else ""
    return (
        f"다음은 재난 상황에서 청각장애인에게 제공하는 안전 안내이다.\n"
        f"재난: {req.disaster_type} {req.severity}\n"
        f"{loc}질문: {req.question}\n"
        f"안내:"
    )


def postprocess(text: str, prompt: str) -> str:
    """프롬프트 이후 생성분만 취하고 첫 1~2문장으로 정리."""
    gen = text[len(prompt):] if text.startswith(prompt) else text
    gen = gen.split("질문:")[0].split("재난:")[0]
    gen = gen.replace("\n", " ").strip()
    # 첫 두 문장까지만.
    sentences = re.split(r"(?<=[.!?。])\s+", gen)
    out = " ".join(s for s in sentences[:2] if s).strip()
    return out


# ── 텍스트 → 글로스 (KoBART 파인튜닝, ml/train_gloss2text.py 산출물) ──────────
#
# 규칙 기반 signAgent.ts를 대체하는 경로다. AI Hub「재난안전 수어영상」의
# (한국어, 글로스열) 16만 쌍으로 파인튜닝한 모델을 로드한다.
# 모델 경로는 T2G_MODEL 환경변수로 바꿀 수 있다(기본: 학습 러너의 best).
import os

T2G_MODEL = os.environ.get("T2G_MODEL", os.path.expanduser("~/sbruns/t2g-v3/best"))


@lru_cache(maxsize=1)
def load_t2g():
    import torch  # noqa: F401
    from transformers import AutoTokenizer, BartForConditionalGeneration

    tok = AutoTokenizer.from_pretrained(T2G_MODEL)
    model = BartForConditionalGeneration.from_pretrained(T2G_MODEL)
    model.eval()
    return tok, model


class T2GRequest(BaseModel):
    text: str


class T2GResponse(BaseModel):
    text: str
    gloss: list[str]
    backend: str = "kobart-t2g"


@app.post("/t2g", response_model=T2GResponse)
def text2gloss(req: T2GRequest):
    import torch

    if not os.path.isdir(T2G_MODEL):
        # 배포본에서 모델을 아직 안 올린 경우 — 500 대신 규칙 기반으로라도 답한다.
        # (프런트의 KoBartSignAgent는 어차피 폴백하지만, 원인을 알 수 있게 표시한다.)
        return T2GResponse(text=req.text, gloss=[], backend="unavailable")

    tok, model = load_t2g()
    inputs = tok(req.text, max_length=128, truncation=True, return_tensors="pt")
    inputs.pop("token_type_ids", None)  # KoBART 토크나이저 산출물, BART는 안 받는다
    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_length=96,
            num_beams=4,
            # 글로스열에 실제 2-gram 반복이 있어(예: 갑자기1 춥다1 × 2) 3으로 둔다.
            no_repeat_ngram_size=3,
        )
    decoded = tok.decode(out[0], skip_special_tokens=True)
    gloss = [g for g in decoded.split() if g]
    return T2GResponse(text=req.text, gloss=gloss)


# ── 텍스트 → 아바타 동작 합성 (글로스 뱅크) ─────────────────────────────────
#
# "AI 아바타가 임의 문장을 수어로 표현"하는 엔드포인트다.
#   텍스트 → (KoBART) 글로스열 → 뱅크에서 글로스별 실연 동작 조각 → 정규화·보간·연결
# 반환 형식은 프런트의 SignData와 동일해서, 기존 아바타 재생기가 그대로 재생한다.
#
# 조각마다 촬영 위치·체격이 달라 그대로 이으면 아바타가 순간이동한다. 그래서 각 조각을
# **어깨중심 원점·어깨폭 스케일**의 공통 좌표계로 옮긴 뒤 표준 화면 좌표로 되돌리고,
# 조각 사이에 6프레임 선형 보간을 넣는다.
GLOSS_BANK = os.environ.get("GLOSS_BANK", os.path.expanduser("~/sbdata/glossbank"))
BANK_FPS = 30.0
BLEND_FRAMES = 6
# 표준 화면 좌표(기존 sign_N.json과 같은 픽셀계): 어깨중심·어깨폭 기준값.
CANVAS_CENTER = (960.0, 540.0)
CANVAS_SHOULDER = 260.0
# OpenPose BODY_25 어깨 인덱스.
_R_SHOULDER, _L_SHOULDER = 2, 5


@lru_cache(maxsize=1)
def load_bank_index() -> dict:
    path = os.path.join(GLOSS_BANK, "bank.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=512)
def load_bank_entry(fname: str) -> dict:
    with open(os.path.join(GLOSS_BANK, "glosses", fname), encoding="utf-8") as handle:
        return json.load(handle)


def _normalize_piece(entry: dict) -> dict[str, "np.ndarray"]:
    """조각을 공통 좌표계로. (x,y는 어깨 기준 정규화 후 표준 화면으로, conf는 유지)

    3D(`keypoints3d`)가 있으면 `p3_*` 키로 같이 정규화한다 — z도 어깨폭 스케일.
    아바타 리타게팅은 3D를 우선 쓰므로, 3D가 있는 조각은 팔 깊이가 정확해진다.
    """
    import numpy as np

    pose = np.asarray(entry["keypoints"]["pose"], dtype=np.float32)
    left = np.asarray(entry["keypoints"]["hand_left"], dtype=np.float32)
    right = np.asarray(entry["keypoints"]["hand_right"], dtype=np.float32)

    rs = pose[:, _R_SHOULDER * 3 : _R_SHOULDER * 3 + 2]
    ls = pose[:, _L_SHOULDER * 3 : _L_SHOULDER * 3 + 2]
    center = (rs + ls) / 2.0  # [T, 2]
    width = np.linalg.norm(ls - rs, axis=1, keepdims=True)  # [T, 1]
    width[width < 1e-3] = CANVAS_SHOULDER  # 어깨 미검출 프레임 보호

    def remap(flat: "np.ndarray") -> "np.ndarray":
        out = flat.copy()
        for axis in range(2):  # x, y
            coords = out[:, axis::3]
            missing = coords == 0.0  # OpenPose 미검출은 정확히 0
            scaled = (coords - center[:, axis : axis + 1]) / width * CANVAS_SHOULDER
            coords_new = scaled + CANVAS_CENTER[axis]
            coords_new[missing] = 0.0
            out[:, axis::3] = coords_new
        return out

    arrays = {"pose": remap(pose), "hand_left": remap(left), "hand_right": remap(right)}

    k3 = entry.get("keypoints3d")
    if k3:
        pose3 = np.asarray(k3["pose"], dtype=np.float32)
        rs3 = pose3[:, _R_SHOULDER * 3 : _R_SHOULDER * 3 + 3]
        ls3 = pose3[:, _L_SHOULDER * 3 : _L_SHOULDER * 3 + 3]
        center3 = (rs3 + ls3) / 2.0  # [T, 3]
        width3 = np.linalg.norm(ls3 - rs3, axis=1, keepdims=True)
        width3[width3 < 1e-3] = 1.0

        def remap3(flat: "np.ndarray") -> "np.ndarray":
            out = flat.copy()
            for axis in range(3):  # x, y, z 전부 좌표(conf 없음)
                coords = out[:, axis::3]
                missing = coords == 0.0
                scaled = (coords - center3[:, axis : axis + 1]) / width3 * CANVAS_SHOULDER
                offset = CANVAS_CENTER[axis] if axis < 2 else 0.0
                coords_new = scaled + offset
                # 깊이 추정 실패 프레임(원본에 -25,000,000 같은 값)이 정규화를 뚫고
                # 들어온다. 어깨폭의 ±3배를 넘는 좌표는 실패로 보고 0(미검출) 처리 —
                # 리타게팅이 미검출 점은 건너뛰므로 팔이 튀는 것보다 낫다.
                bad = np.abs(coords_new - offset) > CANVAS_SHOULDER * 3
                coords_new[missing | bad] = 0.0
                out[:, axis::3] = coords_new
            return out

        for src_key, dst_key in (("pose", "p3_pose"), ("hand_left", "p3_hand_left"),
                                 ("hand_right", "p3_hand_right")):
            arrays[dst_key] = remap3(np.asarray(k3[src_key], dtype=np.float32))

    # fps가 다른 조각은 30fps로 리샘플한다.
    fps = float(entry.get("fps") or BANK_FPS)
    if abs(fps - BANK_FPS) > 0.5:
        length = max(2, int(round(len(pose) * BANK_FPS / fps)))
        src = np.linspace(0, len(pose) - 1, length)
        base = np.arange(len(pose))
        arrays = {
            key: np.stack([np.interp(src, base, val[:, col]) for col in range(val.shape[1])], axis=1)
            for key, val in arrays.items()
        }
    return arrays


def _blend(prev: "np.ndarray", nxt: "np.ndarray", frames: int) -> "np.ndarray":
    """두 조각 사이 선형 보간. 미검출(0) 좌표는 보간하지 않고 0으로 둔다."""
    import numpy as np

    lin = np.linspace(0.0, 1.0, frames + 2)[1:-1, None]
    # ease-in-out(코사인) — 프런트 composeLocal.ts와 같은 곡선. 등속 보간은 로봇 같다.
    steps = (1 - np.cos(np.pi * lin)) / 2
    a, b = prev[None, -1], nxt[None, 0]
    out = a * (1 - steps) + b * steps
    dead = (a == 0.0) | (b == 0.0)
    return np.where(np.repeat(dead, frames, axis=0), 0.0, out)


class ComposeRequest(BaseModel):
    text: str


@app.post("/compose")
def compose(req: ComposeRequest):
    import numpy as np

    bank = load_bank_index()
    if not bank:
        return {"error": "글로스 뱅크가 없습니다", "bank": GLOSS_BANK}

    glosses = text2gloss(T2GRequest(text=req.text)).gloss
    pieces, timeline, missing = [], [], []
    cursor_frames = 0
    for gloss in glosses:
        info = bank.get(gloss)
        if info is None:
            missing.append(gloss)
            continue
        arrays = _normalize_piece(load_bank_entry(info["file"]))
        if pieces:
            # 이전·다음 조각이 공유하는 키만 보간한다(3D는 양쪽 다 있을 때만).
            shared = pieces[-1].keys() & arrays.keys()
            blend = {k: _blend(pieces[-1][k], arrays[k], BLEND_FRAMES) for k in shared}
            pieces.append(blend)
            cursor_frames += BLEND_FRAMES
        start = cursor_frames / BANK_FPS
        pieces.append(arrays)
        cursor_frames += len(arrays["pose"])
        timeline.append({"gloss": gloss, "start": round(start, 3),
                         "end": round(cursor_frames / BANK_FPS, 3)})

    if not pieces:
        return {"error": "뱅크에 있는 글로스가 없습니다", "gloss": glosses, "missing": missing}

    merged = {k: np.concatenate([p[k] for p in pieces]) for k in ("pose", "hand_left", "hand_right")}
    result = {
        "korean_text": req.text,
        "fps": BANK_FPS,
        "num_frames": int(len(merged["pose"])),
        "gloss_sequence": timeline,
        "keypoints": {k: np.round(v, 1).tolist() for k, v in merged.items()},
        "gloss_missing": missing,
        "backend": "kobart-t2g+bank",
    }
    # 모든 조각이 3D를 가질 때만 keypoints3d를 붙인다 — 2D·3D 조각이 섞이면
    # 리타게팅 기준이 프레임마다 바뀌어 팔이 튄다.
    if all("p3_pose" in p for p in pieces):
        result["keypoints3d"] = {
            k: np.round(np.concatenate([p[f"p3_{k}"] for p in pieces]), 1).tolist()
            for k in ("pose", "hand_left", "hand_right")
        }
    return result


# ── 글로스열 → 자연스러운 한국어 (수어→텍스트 방향의 언어 복원) ──────────────
#
# 웹캠 인식(CTC/단어)이 낸 "오늘1 춥다1 조심1" 같은 글로스열을 읽을 수 있는 문장으로
# 복원한다. 같은 KoBART 구조를 역방향 데이터로 파인튜닝한 별도 모델이다.
#
# ⚠️ 알려진 한계(실측): 재난문자 문체를 강하게 배워, 글로스 의미보다 템플릿에 끌리는
# 의미 드리프트가 있다("밖 도망"→"외출 자제"로 뒤집힌 사례). 응답에 글로스 원문을
# 함께 돌려주므로, 화면은 반드시 원문을 병기할 것 — 복원문만 보여 주면 위험하다.
G2T_MODEL = os.environ.get("G2T_MODEL", os.path.expanduser("~/sbruns/g2t-v1/best"))


@lru_cache(maxsize=1)
def load_g2t():
    import torch  # noqa: F401
    from transformers import AutoTokenizer, BartForConditionalGeneration

    tok = AutoTokenizer.from_pretrained(G2T_MODEL)
    model = BartForConditionalGeneration.from_pretrained(G2T_MODEL)
    model.eval()
    return tok, model


class G2TRequest(BaseModel):
    gloss: list[str]


class G2TResponse(BaseModel):
    gloss: list[str]
    text: str
    backend: str = "kobart-g2t"


@app.post("/g2t", response_model=G2TResponse)
def gloss_to_text(req: G2TRequest):
    import torch

    if not os.path.isdir(G2T_MODEL) or not req.gloss:
        return G2TResponse(gloss=req.gloss, text="", backend="unavailable")

    tok, model = load_g2t()
    source = " ".join(req.gloss)
    inputs = tok(source, max_length=128, truncation=True, return_tensors="pt")
    inputs.pop("token_type_ids", None)
    with torch.no_grad():
        out = model.generate(**inputs, max_length=96, num_beams=4, no_repeat_ngram_size=3)
    return G2TResponse(gloss=req.gloss, text=tok.decode(out[0], skip_special_tokens=True))


@app.get("/health")
def health():
    t2g_ready = os.path.isdir(T2G_MODEL)
    bank = load_bank_index()
    return {
        "ok": True,
        "model": MODEL_NAME,
        "t2g_model": T2G_MODEL,
        "t2g_ready": t2g_ready,
        "gloss_bank": GLOSS_BANK,
        "bank_glosses": len(bank),
    }


@app.post("/qa", response_model=QAResponse)
def qa(req: QARequest):
    import torch

    tok, model = load_model()
    prompt = build_prompt(req)
    inputs = tok.encode(prompt, return_tensors="pt")
    with torch.no_grad():
        out = model.generate(
            inputs,
            max_new_tokens=60,
            do_sample=True,
            top_p=0.92,
            top_k=50,
            temperature=0.8,
            repetition_penalty=1.3,
            no_repeat_ngram_size=3,
            pad_token_id=tok.pad_token_id,
            eos_token_id=tok.eos_token_id,
        )
    raw = tok.decode(out[0], skip_special_tokens=True)
    answer = postprocess(raw, prompt)
    if len(answer) < 4:  # 생성 실패 시 최소 안내(프런트가 폴백도 함)
        answer = f"{req.disaster_type} 상황입니다. 안내에 따라 안전한 곳으로 이동하세요."
    return QAResponse(answer=answer, raw=raw)
