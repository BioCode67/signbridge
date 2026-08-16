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


@app.get("/health")
def health():
    t2g_ready = os.path.isdir(T2G_MODEL)
    return {"ok": True, "model": MODEL_NAME, "t2g_model": T2G_MODEL, "t2g_ready": t2g_ready}


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
