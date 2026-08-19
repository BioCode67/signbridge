"""글로스 ↔ 한국어 번역 (KoBART 파인튜닝).

수어 번역 파이프라인의 **언어 단계**다. 두 방향 모두 실제로 쓰인다.

  --direction gloss2text  글로스열 → 자연스러운 한국어.
      인식(CTC) 결과는 "오늘1 눈내리다1 춥다1 길1 얼음1" 같은 글로스열이라 그대로는
      읽기 어렵다. 이 모델이 "오늘 눈과 한파로 도로가 업니다"로 복원한다.

  --direction text2gloss  한국어 → 글로스열.  ★ 기존 앱을 바로 개선하는 쪽
      현재 `src/agents/signAgent.ts`는 규칙 기반으로 재난문자를 글로스로 바꾼다.
      AI Hub의 (한국어 원문, 글로스열) 쌍 수만 건으로 학습하면 규칙으로는 못 맞추는
      어순·조사 생략·수어 특유의 표현을 데이터에서 배운다.

학습 데이터는 **팩이 아니라 index.jsonl의 텍스트 필드만** 쓰므로 GPU 메모리·시간이
거의 들지 않는다(KoBART-base 124M, MIG 슬라이스에서 수십 분). 키포인트 ETL이 끝나기
전에도 라벨 JSON만 있으면 먼저 돌릴 수 있다.

    python -m ml.train_gloss2text --data /data/signbridge/ksl-mp \
        --direction text2gloss --out runs/text2gloss --epochs 10
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ml.signbridge.dataset import read_index
from ml.signbridge.vocab import normalize_gloss

DEFAULT_MODEL = "gogamza/kobart-base-v2"
GLOSS_SEPARATOR = " "


def build_pairs(
    data_dir: Path,
    split: str,
    direction: str,
    merge_variants: bool,
    subseq_aug: float = 0.0,
    seed: int = 0,
) -> list[dict[str, str]]:
    """(글로스열, 한국어) 학습쌍을 만든다.

    `subseq_aug > 0`이면 gloss2text 방향에서 **글로스 부분열 증강**을 켠다.
    실측 배경: 전체 글로스열(평균 15개 안팎)을 넣으면 모델이 정답 수준으로 복원하지만,
    5개짜리 짧은 열(웹캠 인식이 실제로 내는 형태)을 넣으면 재난문자 상투구로 미끄러져
    뜻을 뒤집기도 한다("도망"→"자제"). 분포 밖 입력이 원인이므로, 학습쌍의 일부를
    연속 부분열로 잘라 같은 한국어 문장에 대응시켜 분포를 넓힌다. 부분열이 문장 전체
    의미를 담지 못하는 잡음도 생기지만, 짧은 입력에서 핵심(재난·행동)을 지키는 쪽이
    수어 인식 후단에서는 더 중요하다.
    """
    import random

    rng = random.Random(seed)
    pairs: list[dict[str, str]] = []
    for record in read_index(data_dir / "index.jsonl", split):
        korean = (record.korean_text or "").strip()
        glosses = [
            normalize_gloss(entry.get("gloss", ""), merge_variants)
            for entry in record.glosses
        ]
        glosses = [g for g in glosses if g]
        if not korean or not glosses:
            continue
        gloss_text = GLOSS_SEPARATOR.join(glosses)
        if direction == "gloss2text":
            pairs.append({"source": gloss_text, "target": korean})
            if subseq_aug > 0 and len(glosses) >= 6 and rng.random() < subseq_aug:
                # 3~8개짜리 연속 부분열 하나를 추가한다.
                length = rng.randint(3, min(8, len(glosses) - 1))
                start = rng.randint(0, len(glosses) - length)
                sub = GLOSS_SEPARATOR.join(glosses[start : start + length])
                pairs.append({"source": sub, "target": korean})
        else:
            pairs.append({"source": korean, "target": gloss_text})
    return pairs


def main() -> None:
    parser = argparse.ArgumentParser(description="글로스 ↔ 한국어 번역 학습")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("runs/gloss2text"))
    parser.add_argument(
        "--direction", choices=["gloss2text", "text2gloss"], default="gloss2text"
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=3e-5)
    parser.add_argument("--max-source", type=int, default=128)
    parser.add_argument("--max-target", type=int, default=128)
    parser.add_argument("--merge-variants", action="store_true")
    parser.add_argument("--dump-pairs", action="store_true", help="학습 없이 쌍만 확인")
    parser.add_argument(
        "--subseq-aug", type=float, default=0.0,
        help="gloss2text 전용: 글로스 부분열 증강 비율(0~1). 짧은 인식 출력에 강해진다",
    )
    args = parser.parse_args()

    train_pairs = build_pairs(args.data, "train", args.direction, args.merge_variants, subseq_aug=args.subseq_aug)
    val_pairs = build_pairs(args.data, "val", args.direction, args.merge_variants)
    print(f"[nlp] {args.direction}: 학습 {len(train_pairs)}쌍 / 검증 {len(val_pairs)}쌍")
    if train_pairs:
        print(f"  예시 입력 : {train_pairs[0]['source'][:90]}")
        print(f"  예시 정답 : {train_pairs[0]['target'][:90]}")

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "pairs_sample.json").write_text(
        json.dumps(train_pairs[:20], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if args.dump_pairs:
        return
    if not train_pairs:
        raise SystemExit(
            "학습 쌍이 0개입니다. index.jsonl에 korean_text와 glosses가 모두 있는지 확인하세요."
        )

    import torch
    from torch.utils.data import DataLoader, Dataset
    from transformers import AutoTokenizer, BartForConditionalGeneration

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = BartForConditionalGeneration.from_pretrained(args.model)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)

    class PairDataset(Dataset):
        def __init__(self, pairs: list[dict[str, str]]):
            self.pairs = pairs

        def __len__(self) -> int:
            return len(self.pairs)

        def __getitem__(self, index: int) -> dict[str, str]:
            return self.pairs[index]

    def collate(batch: list[dict[str, str]]) -> dict:
        encoded = tokenizer(
            [item["source"] for item in batch],
            max_length=args.max_source,
            padding=True,
            truncation=True,
            return_tensors="pt",
        )
        # **KoBART 토크나이저는 EOS를 붙이지 않는다.** ("오늘1 밤1" → BOS도 EOS도 없음)
        # 라벨에 EOS가 한 번도 없으면 모델이 종결을 배우지 못해, 생성이 max_length까지
        # 변형 번역을 이어붙이며 폭주한다(t2g-v1에서 실제 그랬다). 토큰 레벨에서 직접
        # 잘라내고 EOS를 붙인다 — 문자열에 "</s>"를 붙이는 방식은 max_length 잘림 시
        # EOS부터 사라져서 안 된다.
        eos = tokenizer.eos_token_id
        target_ids = [
            tokenizer(item["target"], truncation=True, max_length=args.max_target - 1).input_ids
            + [eos]
            for item in batch
        ]
        width = max(len(ids) for ids in target_ids)
        labels = torch.full((len(target_ids), width), -100, dtype=torch.long)
        for row, ids in enumerate(target_ids):
            labels[row, : len(ids)] = torch.tensor(ids, dtype=torch.long)
        encoded["labels"] = labels
        # KoBART 토크나이저는 token_type_ids를 내놓지만 BART forward는 받지 않는다.
        encoded.pop("token_type_ids", None)
        return encoded

    train_loader = DataLoader(
        PairDataset(train_pairs), batch_size=args.batch_size, shuffle=True, collate_fn=collate
    )
    val_loader = DataLoader(
        PairDataset(val_pairs), batch_size=args.batch_size, shuffle=False, collate_fn=collate
    )

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    best_loss = float("inf")

    for epoch in range(1, args.epochs + 1):
        model.train()
        total, count = 0.0, 0
        for batch in train_loader:
            batch = {key: value.to(device) for key, value in batch.items()}
            loss = model(**batch).loss
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total += loss.item()
            count += 1
        train_loss = total / max(1, count)

        model.eval()
        total, count = 0.0, 0
        with torch.no_grad():
            for batch in val_loader:
                batch = {key: value.to(device) for key, value in batch.items()}
                total += model(**batch).loss.item()
                count += 1
        val_loss = total / max(1, count) if count else float("nan")
        print(f"[{epoch:3d}/{args.epochs}] train {train_loss:.4f} | val {val_loss:.4f}", flush=True)

        if count and val_loss < best_loss:
            best_loss = val_loss
            model.save_pretrained(args.out / "best")
            tokenizer.save_pretrained(args.out / "best")

    # 정성 확인 — 숫자만 보면 실제 출력이 말이 되는지 알 수 없다.
    if val_pairs:
        model.eval()
        print("\n[nlp] 검증 샘플 생성 결과")
        for pair in val_pairs[:5]:
            inputs = tokenizer(
                pair["source"], max_length=args.max_source, truncation=True, return_tensors="pt"
            ).to(device)
            inputs.pop("token_type_ids", None)  # collate와 같은 이유 — BART는 안 받는다
            # no_repeat_ngram_size=3: 학습 초기의 "부탁1 부탁1 …" 꼬리 반복을 막는다.
            # 글로스열엔 실제 2-gram 반복이 있으므로(예: 갑자기1 춥다1 × 2) 2는 안 된다.
            with torch.no_grad():
                generated = model.generate(
                    **inputs,
                    max_length=args.max_target,
                    num_beams=4,
                    no_repeat_ngram_size=3,
                )
            decoded = tokenizer.decode(generated[0], skip_special_tokens=True)
            print(f"  입력: {pair['source'][:70]}")
            print(f"  생성: {decoded[:70]}")
            print(f"  정답: {pair['target'][:70]}\n")

    print(f"[nlp] 최저 검증 손실 {best_loss:.4f} → {args.out / 'best'}")


if __name__ == "__main__":
    main()
