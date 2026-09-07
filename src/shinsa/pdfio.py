"""PDF のページ画像化.

スキャン PDF が対象のため、ページはすべてラスタ画像として扱う。
テキスト抽出は行わない（手書きが主で、OCR は精度が出ないため）。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

try:  # PyMuPDF 1.24 以降の推奨名。古い版では fitz のみ。
    import pymupdf as fitz
except ImportError:  # pragma: no cover - 環境依存
    import fitz
from PIL import Image

# 用途別の解像度。サムネイルは一覧性、書き出しは印刷品質を優先する。
DPI_THUMBNAIL = 50
DPI_PREVIEW = 110
DPI_EXPORT = 200


@dataclass(frozen=True)
class PageRef:
    """1 ページを指す参照."""

    pdf_path: Path
    page_index: int  # 0 始まり

    @property
    def label(self) -> str:
        return f"{self.pdf_path.name} p.{self.page_index + 1}"


def page_count(pdf_path: Path) -> int:
    with fitz.open(pdf_path) as doc:
        return doc.page_count


def render_page(pdf_path: Path, page_index: int, dpi: int = DPI_PREVIEW) -> Image.Image:
    """1 ページを PIL Image（RGB）で返す."""
    with fitz.open(pdf_path) as doc:
        if not 0 <= page_index < doc.page_count:
            raise IndexError(f"ページ番号が範囲外です: {page_index} / {doc.page_count}")
        pix = doc.load_page(page_index).get_pixmap(dpi=dpi, alpha=False)
        return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def render_all(pdf_path: Path, dpi: int = DPI_THUMBNAIL):
    """全ページを順に描画する generator。1 万件を扱うのでページ単位で解放する."""
    with fitz.open(pdf_path) as doc:
        for i in range(doc.page_count):
            pix = doc.load_page(i).get_pixmap(dpi=dpi, alpha=False)
            yield i, Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def crop_ratio(img: Image.Image, box: tuple[float, float, float, float]) -> Image.Image:
    """比率 (left, top, right, bottom) 0.0-1.0 で切り出す.

    スキャンは傾き・位置ずれが必ずあるため、座標は絶対値ではなく比率で持ち、
    呼び出し側で余白を大きめに取る。
    """
    left, top, right, bottom = box
    if not (0.0 <= left < right <= 1.0 and 0.0 <= top < bottom <= 1.0):
        raise ValueError(f"切り出し範囲が不正です: {box}")
    w, h = img.size
    return img.crop((int(w * left), int(h * top), int(w * right), int(h * bottom)))


def find_pdfs(folder: Path, odd_only: bool = False) -> list[Path]:
    """フォルダ内の PDF を列挙する.

    odd_only=True のとき、ファイル名末尾の通し番号が奇数のものだけを返す
    （奇数＝申請書一式、偶数＝臨床調査個人票、という命名規則の前提）。
    規則に合わないファイル名は判定できないため、除外せず残して人が判断する。
    """
    pdfs = sorted(p for p in folder.glob("*.pdf") if p.is_file())
    if not odd_only:
        return pdfs
    kept = []
    for p in pdfs:
        serial = _trailing_serial(p.stem)
        if serial is None or serial % 2 == 1:
            kept.append(p)
    return kept


def _trailing_serial(stem: str) -> int | None:
    """ファイル名末尾の `_数字` を通し番号として取り出す。取れなければ None."""
    tail = stem.rsplit("_", 1)[-1] if "_" in stem else ""
    return int(tail) if tail.isdigit() else None
