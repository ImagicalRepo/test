"""事前バッチ：作業の順序を決める.

全 1 万件を見るとしても、**順序は選べる**。

チェックリストのメモ欄は面積が大きいので、**黒画素の割合を測るだけで
「書き込みあり／なし」が機械的に判定できる**。OCR ではないので精度の心配がない。
書き込みのある案件を先に回せば、論点の全体像が早く掴める。

これが効くのは、クリティカルパスが管理者の決定だから。
全件終わってから相談を始めると間に合わない。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from PIL import Image

from . import detect, extract, pdfio
from .store import Store

# メモ欄に書き込みがあるとみなす黒画素率。
# 空欄でも枠線があるため 0 にはならない。実データで必ず調整すること。
DEFAULT_INK_THRESHOLD = 0.030

# これより暗い画素を「黒」とみなす（0-255）。スキャンの地色を拾わない程度に低くする。
DARK_LEVEL = 128

PRIORITY_HIGH = 10
PRIORITY_NORMAL = 0


@dataclass
class ScanResult:
    recipient_no: str
    page_index: int | None
    score: float
    memo_ink: float | None

    @property
    def found(self) -> bool:
        return self.page_index is not None


def ink_ratio(image: Image.Image) -> float:
    """暗い画素の割合を返す（0.0〜1.0）.

    OCR ではなく単なる濃度計算。手書きかどうかは判別しないが、
    「何か書いてあるか」の判定にはこれで足りる。
    """
    gray = image.convert("L")
    histogram = gray.histogram()
    dark = sum(histogram[:DARK_LEVEL])
    total = gray.width * gray.height
    return dark / total if total else 0.0


def scan_case(
    pdf_path: Path,
    template: list[float],
    memo_region: tuple[float, float, float, float],
    threshold: float = detect.DEFAULT_THRESHOLD,
) -> tuple[int | None, float, float | None]:
    """1 件を調べ、(チェックリストのページ, 類似度, メモ欄の黒画素率) を返す."""
    pages = pdfio.render_all(pdf_path, dpi=pdfio.DPI_THUMBNAIL)
    best = detect.best_page(pages, template)
    if best is None or best.score < threshold:
        return None, best.score if best else 0.0, None

    page = pdfio.render_page(pdf_path, best.page_index, dpi=pdfio.DPI_PREVIEW)
    memo = pdfio.crop_ratio(page, memo_region)
    return best.page_index, best.score, ink_ratio(memo)


def run(
    store: Store,
    template: list[float],
    memo_region: tuple[float, float, float, float] | None = None,
    ink_threshold: float = DEFAULT_INK_THRESHOLD,
    detect_threshold: float = detect.DEFAULT_THRESHOLD,
    progress: Callable[[int, int, str], bool] | None = None,
) -> list[ScanResult]:
    """全案件を調べ、優先順位を DB に書き込む.

    progress は (現在, 全体, 受給者番号) を受け取り、False を返すと中断する。
    中断しても、そこまでの結果は DB に反映済み。
    """
    memo_region = memo_region if memo_region is not None else extract.REGIONS["メモ欄"]
    cases = store.list_cases()
    results: list[ScanResult] = []

    for index, case in enumerate(cases, start=1):
        if progress and not progress(index, len(cases), case.recipient_no):
            break
        try:
            page_index, score, memo_ink = scan_case(
                case.primary_path, template, memo_region, detect_threshold
            )
        except (OSError, RuntimeError, ValueError):
            # 1 件の破損で全体を止めない。優先度は既定のまま残る
            results.append(ScanResult(case.recipient_no, None, 0.0, None))
            continue

        priority = PRIORITY_HIGH if (memo_ink or 0.0) >= ink_threshold else PRIORITY_NORMAL
        store.set_priority(case.recipient_no, priority, memo_ink)
        results.append(ScanResult(case.recipient_no, page_index, score, memo_ink))

    store.log("事前バッチ", detail=f"{len(results)} 件を判定（しきい値 {ink_threshold}）")
    return results


def distribution(results: list[ScanResult], buckets: int = 10) -> list[tuple[float, float, int]]:
    """黒画素率の分布。しきい値を人が決めるために使う.

    戻り値は (下限, 上限, 件数)。
    書き込みのある群と無い群で山が分かれるはずなので、その谷を選ぶ。
    """
    values = [r.memo_ink for r in results if r.memo_ink is not None]
    if not values:
        return []
    lowest, highest = min(values), max(values)
    if highest == lowest:
        return [(lowest, highest, len(values))]
    width = (highest - lowest) / buckets
    counts = [0] * buckets
    for value in values:
        index = min(buckets - 1, int((value - lowest) / width))
        counts[index] += 1
    return [(lowest + i * width, lowest + (i + 1) * width, counts[i]) for i in range(buckets)]
