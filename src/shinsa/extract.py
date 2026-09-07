"""論点抽出の処理本体.

GUI から切り離してあるので、画面なしで検証・バッチ実行ができる。

流れ:
  申請書一式PDF（奇数）→ チェックリストのページを検出 → 左側の欄をクロップ
  → コンタクトシートに並べる → 管理者が眺めて分類する

チェックリストのページ位置は可変なので検出が要る。検出は半自動で、
閾値を下げて候補を多めに出す（取りこぼしは集計を歪めるが、誤検出は人が外せる）。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from PIL import Image

from . import detect, pdfio
from .contactsheet import save_sheets

# チェックリスト上の切り出し範囲（ページ全体に対する比率）。
# 実物 R8年度版のレイアウトから算出。スキャンの傾き・ずれを吸収するため
# 余白を大きめに取っている。現地で必ず数ページ見て調整すること。
REGIONS: dict[str, tuple[float, float, float, float]] = {
    # 左半分をまとめて切る。取りこぼしがなく実装も単純なので既定はこれ。
    "左側一括": (0.02, 0.10, 0.56, 1.00),
    # 個別に切りたい場合の目安
    "書類確認欄": (0.02, 0.12, 0.56, 0.68),
    "メモ欄": (0.02, 0.88, 0.56, 1.00),
}

DEFAULT_REGION = "左側一括"
CONFIG_NAME = "抽出設定.json"


@dataclass
class ExtractionResult:
    pdf_count: int = 0
    hit_count: int = 0
    sheets: list[Path] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    def summary(self) -> str:
        lines = [
            f"処理した PDF: {self.pdf_count} 件",
            f"検出したチェックリスト: {self.hit_count} 枚",
            f"作成したコンタクトシート: {len(self.sheets)} 枚",
        ]
        if self.skipped:
            lines.append(f"読み飛ばし: {len(self.skipped)} 件")
        return "\n".join(lines)


def load_region(config_dir: Path, name: str = DEFAULT_REGION) -> tuple[float, float, float, float]:
    """切り出し範囲を返す。設定ファイルがあればそちらを優先する.

    現地調整の結果をコードに手を入れず残せるようにしている。
    """
    config = config_dir / CONFIG_NAME
    if config.exists():
        data = json.loads(config.read_text(encoding="utf-8"))
        box = data.get("切り出し範囲", {}).get(name)
        if box:
            return tuple(box)  # type: ignore[return-value]
    return REGIONS[name]


def save_region(config_dir: Path, name: str, box: tuple[float, float, float, float]) -> None:
    config = config_dir / CONFIG_NAME
    data = json.loads(config.read_text(encoding="utf-8")) if config.exists() else {}
    data.setdefault("切り出し範囲", {})[name] = list(box)
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def make_template(pdf_path: Path, page_index: int) -> list[float]:
    """見本にするチェックリストのページから署名を作る."""
    img = pdfio.render_page(pdf_path, page_index, dpi=pdfio.DPI_THUMBNAIL)
    return detect.signature(img)


def rank_pdf_pages(pdf_path: Path, template: list[float]) -> list[detect.PageHit]:
    """1 つの PDF の全ページを類似度順に並べる（閾値の調整用）."""
    return detect.rank_pages(pdfio.render_all(pdf_path, dpi=pdfio.DPI_THUMBNAIL), template)


def extract(
    pdf_paths: list[Path],
    template: list[float],
    out_dir: Path,
    region: tuple[float, float, float, float],
    threshold: float = detect.DEFAULT_THRESHOLD,
    one_per_pdf: bool = True,
    per_sheet: int = 20,
    progress: Callable[[int, int, str], bool] | None = None,
) -> ExtractionResult:
    """チェックリストを検出して切り出し、コンタクトシートにまとめる.

    progress は (現在, 全体, メッセージ) を受け取り、False を返すと中断する。
    """
    result = ExtractionResult(pdf_count=len(pdf_paths))
    items: list[tuple[Image.Image, str]] = []

    for index, pdf_path in enumerate(pdf_paths, start=1):
        if progress and not progress(index, len(pdf_paths), pdf_path.name):
            break
        try:
            hits = _find_hits(pdf_path, template, threshold, one_per_pdf)
        except Exception as exc:  # noqa: BLE001 - 1 件の破損で全体を止めない
            result.skipped.append(f"{pdf_path.name}: {exc}")
            continue

        for hit in hits:
            page = pdfio.render_page(pdf_path, hit.page_index, dpi=pdfio.DPI_PREVIEW)
            items.append(
                (
                    pdfio.crop_ratio(page, region),
                    f"{pdf_path.stem}  p.{hit.page_index + 1}  類似度{hit.score:.2f}",
                )
            )
            result.hit_count += 1

    if items:
        result.sheets = save_sheets(items, out_dir, per_sheet=per_sheet, prefix="論点シート")
    return result


def _find_hits(
    pdf_path: Path, template: list[float], threshold: float, one_per_pdf: bool
) -> list[detect.PageHit]:
    pages = pdfio.render_all(pdf_path, dpi=pdfio.DPI_THUMBNAIL)
    if one_per_pdf:
        # 1 申請につきチェックリストは 1 枚という前提。最も似た 1 ページだけ採る。
        best = detect.best_page(pages, template)
        return [best] if best and best.score >= threshold else []
    return detect.detect_pages(pages, template, threshold)
