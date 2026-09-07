"""コンタクトシート（切り出し画像の一覧）の生成.

1 件ずつ PDF を開いて閉じる作業を、一覧を眺めるだけの作業に変えるための機能。
論点集計の速度はここで決まる。
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CELL_GAP = 12
LABEL_HEIGHT = 22
MARGIN = 24
BACKGROUND = (255, 255, 255)
LABEL_COLOR = (0, 0, 0)
BORDER_COLOR = (170, 170, 170)


def _font(size: int = 14) -> ImageFont.ImageFont:
    """日本語が出せるフォントを探す。無ければ既定フォント（英数字のみ）."""
    candidates = [
        "C:/Windows/Fonts/meiryo.ttc",
        "C:/Windows/Fonts/YuGothM.ttc",
        "C:/Windows/Fonts/msgothic.ttc",
        "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def build_contact_sheet(
    items: list[tuple[Image.Image, str]],
    columns: int = 4,
    cell_width: int = 460,
    cell_height: int = 300,
) -> Image.Image:
    """(画像, ラベル) の並びを 1 枚のシートに組む.

    既定は 4 列 × 5 行 = 20 件／枚。プランの「1 ページ 15〜20 件」に合わせている。
    """
    if not items:
        raise ValueError("コンタクトシートに載せる画像がありません。")

    rows = (len(items) + columns - 1) // columns
    cell_total_h = cell_height + LABEL_HEIGHT + CELL_GAP
    width = MARGIN * 2 + columns * cell_width + (columns - 1) * CELL_GAP
    height = MARGIN * 2 + rows * cell_total_h

    sheet = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(sheet)
    font = _font()

    for index, (img, label) in enumerate(items):
        col, row = index % columns, index // columns
        x = MARGIN + col * (cell_width + CELL_GAP)
        y = MARGIN + row * cell_total_h

        thumb = _fit(img, cell_width, cell_height)
        # セル内で中央寄せ
        sheet.paste(thumb, (x + (cell_width - thumb.width) // 2, y + (cell_height - thumb.height) // 2))
        draw.rectangle((x, y, x + cell_width, y + cell_height), outline=BORDER_COLOR)
        draw.text((x + 2, y + cell_height + 3), label, fill=LABEL_COLOR, font=font)

    return sheet


def _fit(img: Image.Image, max_w: int, max_h: int) -> Image.Image:
    """縦横比を保ったまま枠に収める."""
    scale = min(max_w / img.width, max_h / img.height)
    size = (max(1, int(img.width * scale)), max(1, int(img.height * scale)))
    return img.convert("RGB").resize(size, Image.Resampling.LANCZOS)


def save_sheets(
    items: list[tuple[Image.Image, str]],
    out_dir: Path,
    per_sheet: int = 20,
    columns: int = 5,
    cell_width: int = 290,
    cell_height: int = 400,
    prefix: str = "sheet",
) -> list[Path]:
    """件数に応じて複数枚のシートに分割して保存する.

    既定は縦長セル 5 列 × 4 行 = 20 件／枚。
    チェックリストの左側は縦長に切り出されるため、セルも縦長にして余白を減らす。
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for n, start in enumerate(range(0, len(items), per_sheet), start=1):
        sheet = build_contact_sheet(
            items[start : start + per_sheet],
            columns=columns,
            cell_width=cell_width,
            cell_height=cell_height,
        )
        path = out_dir / f"{prefix}_{n:03d}.png"
        sheet.save(path, format="PNG")
        paths.append(path)
    return paths
