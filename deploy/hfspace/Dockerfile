# SignBridge API — Hugging Face Spaces (Docker SDK)
#
# HF Spaces 규칙 두 가지가 설계를 정한다:
#   1) 앱은 **7860 포트**로 서비스해야 한다.
#   2) 컨테이너는 **uid 1000(user)** 로 돌고, 쓰기 가능한 곳은 홈(/home/user)과 /tmp뿐이다.
#      그래서 모델 캐시·다운로드 자산을 전부 홈 아래로 보낸다(기본값은 권한 오류가 난다).
FROM python:3.12-slim

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    # transformers/huggingface 캐시를 쓰기 가능한 홈으로.
    HF_HOME=/home/user/.cache/huggingface \
    # fetch_assets.py가 여기에 풀고, app.py가 여기서 읽는다.
    T2G_MODEL=/home/user/assets/t2g-best \
    GLOSS_BANK=/home/user/assets/glossbank \
    PYTHONUNBUFFERED=1

WORKDIR /home/user/app

# 의존성 먼저 — 소스가 바뀌어도 이 레이어는 캐시된다(재빌드 수 분 절약).
COPY --chown=user requirements.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt

COPY --chown=user server/ ./server/

EXPOSE 7860

# 자산을 받은 뒤 기동. 자산 URL이 없거나 실패해도 서버는 뜬다(기능만 비활성).
CMD ["sh", "-c", "python server/fetch_assets.py && uvicorn server.app:app --host 0.0.0.0 --port 7860"]
