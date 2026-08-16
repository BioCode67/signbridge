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
    data_dir: Path, split: str, direction: str, merge_variants: bool
) -> list[dict[str, str]]:
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
    args = parser.parse_args()

    train_pairs = build_pairs(args.data, "train", args.direction, args.merge_variants)
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
        labels = tokenizer(
            [item["target"] for item in batch],
            max_length=args.max_target,
            padding=True,
            truncation=True,
            return_tensors="pt",
        ).input_ids
        # 패딩 토큰은 손실에서 제외한다(-100은 HF의 무시 인덱스).
        labels[labels == tokenizer.pad_token_id] = -100
        encoded["labels"] = labels
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
            with torch.no_grad():
                generated = model.generate(**inputs, max_length=args.max_target, num_beams=4)
            decoded = tokenizer.decode(generated[0], skip_special_tokens=True)
            print(f"  입력: {pair['source'][:70]}")
            print(f"  생성: {decoded[:70]}")
            print(f"  정답: {pair['target'][:70]}\n")

    print(f"[nlp] 최저 검증 손실 {best_loss:.4f} → {args.out / 'best'}")


if __name__ == "__main__":
    main()
