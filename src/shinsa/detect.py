"""チェックリストのページ検出.

申請書一式 PDF の中でチェックリストのページ位置は可変のため、
定型様式であることを利用して「見た目の似ているページ」を候補として提示する。

意図的に半自動にしている。誤検出は人が外せばよいが、
取りこぼしは気づかれないまま集計を歪めるため、閾値は低めに設定して
候補を多めに出す方針を取る。

numpy に依存させない（exe を小さく保ち、誤検知を減らすため）。
署名は 32x44 の縮小画像なので、純 Python でも 1 万ページを数秒で処理できる。
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps

SIG_WIDTH = 32
SIG_HEIGHT = 44

# 署名を取る範囲（ページ全体に対する比率）。
#
# ページ全体から取ると、メモ欄の手書きが署名を支配してしまい、
# **書き込みの多いページほど検出できなくなる**。一番拾いたい対象を落とすので致命的。
# 帳票を identify しているのは罫線の構造なので、記入内容の多い下部を外す。
FORM_REGION = (0.0, 0.03, 1.0, 0.82)

# 既定の閾値。1.0 が完全一致。
# スキャンの劣化が激しいと同一様式でも 0.6 台まで落ちるため低めに設定している。
# 実データで必ず調整すること。閾値に頼らず rank_pages() で人が切る運用を推奨。
DEFAULT_THRESHOLD = 0.70


@dataclass(frozen=True)
class PageHit:
    page_index: int
    score: float


def signature(
    img: Image.Image,
    region: tuple[float, float, float, float] | None = FORM_REGION,
) -> list[float]:
    """ページ画像から、レイアウトを表す正規化済みの特徴ベクトルを作る.

    平均を引いて L2 正規化するため、スキャンの濃淡差の影響を受けにくい。

    region で署名を取る範囲を絞れる。既定は FORM_REGION で、
    記入内容に左右されにくい罫線の構造だけを見る。
    """
    if region is not None:
        left, top, right, bottom = region
        width, height = img.size
        img = img.crop(
            (int(width * left), int(height * top), int(width * right), int(height * bottom))
        )
    small = ImageOps.autocontrast(img.convert("L")).resize(
        (SIG_WIDTH, SIG_HEIGHT), Image.Resampling.LANCZOS
    )
    values = [float(v) for v in small.getdata()]
    mean = sum(values) / len(values)
    centered = [v - mean for v in values]
    norm = math.sqrt(sum(v * v for v in centered))
    if norm == 0:  # 真っ白／真っ黒なページ
        return [0.0] * len(centered)
    return [v / norm for v in centered]


def similarity(a: list[float], b: list[float]) -> float:
    """2 つの署名の類似度。正規化済みなので内積がそのまま相関係数になる."""
    if len(a) != len(b):
        raise ValueError("署名の長さが一致しません。")
    return sum(x * y for x, y in zip(a, b))


def save_template(sig: list[float], path: Path, note: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"幅": SIG_WIDTH, "高さ": SIG_HEIGHT, "備考": note, "署名": sig},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def load_template(path: Path) -> list[float]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("幅") != SIG_WIDTH or data.get("高さ") != SIG_HEIGHT:
        raise ValueError("テンプレートの寸法が現在の設定と異なります。作り直してください。")
    return data["署名"]


def detect_pages(
    pages,
    template: list[float],
    threshold: float = DEFAULT_THRESHOLD,
) -> list[PageHit]:
    """(page_index, Image) の並びから、テンプレートに似たページを返す.

    pages は generator でよい（1 万件を扱うためページ単位で解放する）。
    """
    hits = []
    for page_index, img in pages:
        score = similarity(signature(img), template)
        if score >= threshold:
            hits.append(PageHit(page_index, score))
    return hits


def best_page(pages, template: list[float]) -> PageHit | None:
    """最も似ているページを 1 つだけ返す（1 PDF に 1 枚しかない前提のとき）."""
    best: PageHit | None = None
    for page_index, img in pages:
        score = similarity(signature(img), template)
        if best is None or score > best.score:
            best = PageHit(page_index, score)
    return best


def rank_pages(pages, template: list[float]) -> list[PageHit]:
    """全ページを類似度の高い順に並べて返す.

    閾値を決め打ちせず、人がスコアを見ながら「どこまでを候補とするか」を
    決めるための関数。実データでの調整はこれを使う。
    """
    hits = [PageHit(i, similarity(signature(img), template)) for i, img in pages]
    return sorted(hits, key=lambda h: h.score, reverse=True)
