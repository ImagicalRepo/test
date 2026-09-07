"""比較マークアップ.

「何と何を比較して、どこが NG なのか」を 1 枚の画像で残す。

単独のページに囲みを付けるだけでは、**何と比較したのかが画像から失われる**。
左右に並べて 1 枚にし、両方の該当箇所を囲んで線で結ぶ。
こうすれば画像単体で意味が完結し、そのままカタログに載せられる。

各領域には「何が届いているか」で選んだ書類名がラベルとして付く。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw

from .contactsheet import _font
from .masking import MaskRect, apply_masks

SIDE_LEFT = "左"
SIDE_RIGHT = "右"

GAP = 48                    # 左右の間隔
MARGIN = 28
HEADER = 44                 # 見出しの高さ
BACKGROUND = (255, 255, 255)
BOX_COLOR = (200, 30, 30)
LINE_COLOR = (200, 30, 30)
LABEL_BG = (255, 244, 244)
TEXT_COLOR = (20, 20, 20)
BOX_WIDTH = 4


@dataclass(frozen=True)
class MarkupRegion:
    """囲んだ 1 箇所.

    box は、その側に表示している画像に対する比率 (left, top, right, bottom)。
    比率で持つので、表示解像度と書き出し解像度が違っても同じ場所を指す。
    """

    side: str            # SIDE_LEFT / SIDE_RIGHT
    page_index: int      # 何ページ目を見ていたか（後から再現するため）
    box: tuple[float, float, float, float]
    label: str = ""      # 書類名（「何が届いているか」で選んだもの）


@dataclass
class ComparisonSet:
    """1 つの NG・迷いの記録."""

    regions: list[MarkupRegion] = field(default_factory=list)
    comparison: str = ""    # この比較は何か（記号番号・枝番 など。任意）
    defect_code: str = ""   # 不備理由コード
    note: str = ""          # 迷った理由など
    masks: list[MaskRect] = field(default_factory=list)  # 合成画像に対するマスク

    @property
    def is_complete(self) -> bool:
        """左右それぞれに 1 箇所以上あるか.

        片側だけでも記録は残せるが、比較としては成立しない。
        """
        sides = {r.side for r in self.regions}
        return SIDE_LEFT in sides and SIDE_RIGHT in sides


def build_comparison(
    left_image: Image.Image | None,
    right_image: Image.Image | None,
    comparison: ComparisonSet,
    left_title: str = "申請書",
    right_title: str = "提出書類",
) -> Image.Image:
    """左右を並べ、囲みと結線を描いた 1 枚の画像を作る."""
    if left_image is None and right_image is None:
        raise ValueError("画像が 1 枚もありません。")

    left = _to_rgb(left_image)
    right = _to_rgb(right_image)

    # 高さを揃えると見比べやすい
    height = max(img.height for img in (left, right) if img is not None)
    left = _fit_height(left, height)
    right = _fit_height(right, height)

    left_w = left.width if left else 0
    right_w = right.width if right else 0
    canvas = Image.new(
        "RGB",
        (MARGIN * 2 + left_w + GAP + right_w, MARGIN * 2 + HEADER + height),
        BACKGROUND,
    )
    draw = ImageDraw.Draw(canvas)
    font = _font(16)

    origins: dict[str, tuple[int, int, int, int]] = {}
    top = MARGIN + HEADER
    if left:
        canvas.paste(left, (MARGIN, top))
        origins[SIDE_LEFT] = (MARGIN, top, left.width, left.height)
        draw.text((MARGIN, MARGIN + 8), left_title, fill=TEXT_COLOR, font=font)
    if right:
        x = MARGIN + left_w + GAP
        canvas.paste(right, (x, top))
        origins[SIDE_RIGHT] = (x, top, right.width, right.height)
        draw.text((x, MARGIN + 8), right_title, fill=TEXT_COLOR, font=font)

    # 囲みを描き、各側の代表点を覚えておく
    anchors: dict[str, tuple[int, int]] = {}
    for region in comparison.regions:
        if region.side not in origins:
            continue  # その側の画像が無い
        box = _to_canvas_box(region.box, origins[region.side])
        draw.rectangle(box, outline=BOX_COLOR, width=BOX_WIDTH)
        if region.label:
            _draw_label(draw, box, region.label, font)
        anchors.setdefault(region.side, _edge_anchor(box, region.side))

    # 左右を結ぶ線。これが「何と何を比較したか」を表す
    if SIDE_LEFT in anchors and SIDE_RIGHT in anchors:
        draw.line([anchors[SIDE_LEFT], anchors[SIDE_RIGHT]], fill=LINE_COLOR, width=3)

    if comparison.comparison or comparison.note:
        caption = "　".join(filter(None, [comparison.comparison, comparison.note]))
        draw.text((MARGIN, MARGIN - 14), caption, fill=TEXT_COLOR, font=_font(14))

    return canvas


def export_comparison(
    left_image: Image.Image | None,
    right_image: Image.Image | None,
    comparison: ComparisonSet,
    out_dir: Path,
    prefix: str = "cmp",
    left_title: str = "申請書",
    right_title: str = "提出書類",
) -> Path:
    """合成してマスクを焼き込み、PNG として書き出す.

    マスクは**合成後の画像に対して**掛ける。合成前に掛けるより取り扱いが単純で、
    書き出す画像そのものを見て塗り残しを確認できる。
    """
    from .masking import export_masked  # 循環参照を避けるため関数内で読み込む

    canvas = build_comparison(left_image, right_image, comparison, left_title, right_title)
    note = "　".join(filter(None, [comparison.comparison, comparison.defect_code, comparison.note]))
    return export_masked(canvas, comparison.masks, out_dir, prefix=prefix, note=note)


def preview_with_masks(
    left_image: Image.Image | None,
    right_image: Image.Image | None,
    comparison: ComparisonSet,
) -> Image.Image:
    """書き出す前に、マスクを掛けた状態を確認するための画像."""
    canvas = build_comparison(left_image, right_image, comparison)
    return apply_masks(canvas, comparison.masks) if comparison.masks else canvas


# ---------- 補助 ----------


def _to_rgb(image: Image.Image | None) -> Image.Image | None:
    return image.convert("RGB") if image is not None else None


def _fit_height(image: Image.Image | None, height: int) -> Image.Image | None:
    if image is None or image.height == height:
        return image
    width = max(1, round(image.width * height / image.height))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def _to_canvas_box(
    box: tuple[float, float, float, float], origin: tuple[int, int, int, int]
) -> tuple[int, int, int, int]:
    x0, y0, width, height = origin
    left, top, right, bottom = box
    return (
        x0 + int(width * min(left, right)),
        y0 + int(height * min(top, bottom)),
        x0 + int(width * max(left, right)),
        y0 + int(height * max(top, bottom)),
    )


def _edge_anchor(box: tuple[int, int, int, int], side: str) -> tuple[int, int]:
    """結線の起点。左側の囲みは右辺から、右側の囲みは左辺から引く."""
    x0, y0, x1, y1 = box
    middle = (y0 + y1) // 2
    return (x1, middle) if side == SIDE_LEFT else (x0, middle)


def _draw_label(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, font) -> None:
    """囲みの上に書類名を置く。枠外にはみ出す場合は内側へ入れる."""
    x0, y0, _x1, _y1 = box
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    width, height = right - left, bottom - top
    y = y0 - height - 6
    if y < 0:
        y = y0 + 4
    draw.rectangle((x0, y, x0 + width + 8, y + height + 6), fill=LABEL_BG, outline=BOX_COLOR)
    draw.text((x0 + 4, y + 3), text, fill=BOX_COLOR, font=font)
