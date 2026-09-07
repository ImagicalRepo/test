"""マスキングと安全な書き出し.

本ツール唯一の情報漏えいリスク箇所。以下を破ってはならない。

1. 必ず画像として焼き込む（PDF に矩形を重ねる方式は下の情報が残り復元可能）
2. 出力ファイル名に個人情報を含めない（連番のみ）
3. 出力先は専用フォルダに限定し、原本フォルダには一切書き込まない
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw

BLACKOUT = "黒塗り"
MOSAIC = "モザイク"

# モザイクの粗さ。値が小さいほど粗く、復元が困難になる。
MOSAIC_BLOCKS = 8

# 出力ファイル名は連番のみを許可する。
_SAFE_NAME = re.compile(r"^[0-9a-zA-Z_\-]+$")


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, value))


@dataclass(frozen=True)
class MaskRect:
    """マスクする矩形。画像サイズに対する比率で保持する.

    比率で持つことで、プレビュー解像度で指定したマスクを
    書き出し解像度にそのまま適用できる。
    """

    left: float
    top: float
    right: float
    bottom: float
    style: str = BLACKOUT

    def to_pixels(self, size: tuple[int, int]) -> tuple[int, int, int, int]:
        """画像内に収まる矩形を返す.

        画像の外までドラッグされることがあるため 0.0-1.0 に丸める。
        丸めないとモザイク処理で空領域が生まれて落ちる。
        """
        w, h = size
        left, right = _clamp(self.left), _clamp(self.right)
        top, bottom = _clamp(self.top), _clamp(self.bottom)
        x0, x1 = sorted((int(w * left), int(w * right)))
        y0, y1 = sorted((int(h * top), int(h * bottom)))
        # 幅・高さが 0 だと描画されないため最低 1px を保証する
        return x0, y0, max(x1, x0 + 1), max(y1, y0 + 1)

    def as_dict(self) -> dict:
        return {
            "left": self.left,
            "top": self.top,
            "right": self.right,
            "bottom": self.bottom,
            "style": self.style,
        }


def apply_masks(img: Image.Image, rects: list[MaskRect]) -> Image.Image:
    """マスクを焼き込んだ新しい画像を返す（元画像は変更しない）."""
    out = img.convert("RGB").copy()
    draw = ImageDraw.Draw(out)
    for rect in rects:
        box = rect.to_pixels(out.size)
        if rect.style == MOSAIC:
            region = out.crop(box)
            small = region.resize(
                (max(1, region.width // MOSAIC_BLOCKS), max(1, region.height // MOSAIC_BLOCKS)),
                Image.Resampling.BILINEAR,
            )
            out.paste(small.resize(region.size, Image.Resampling.NEAREST), box)
        else:
            draw.rectangle(box, fill=(0, 0, 0))
    return out


def next_serial(out_dir: Path, prefix: str = "img") -> int:
    """出力フォルダ内の既存連番の次の番号を返す."""
    used = []
    for f in out_dir.glob(f"{prefix}_*.png"):
        tail = f.stem[len(prefix) + 1 :]
        if tail.isdigit():
            used.append(int(tail))
    return max(used, default=0) + 1


def export_masked(
    img: Image.Image,
    rects: list[MaskRect],
    out_dir: Path,
    prefix: str = "img",
    note: str = "",
) -> Path:
    """マスクを焼き込んだ PNG を連番で書き出す.

    ファイル名には受給者番号・氏名を一切含めない。
    どの原本から作ったかは、別ファイルの控えに残す（持ち出さない）。
    """
    if not _SAFE_NAME.match(prefix):
        raise ValueError(f"ファイル名の接頭辞に使えない文字が含まれています: {prefix!r}")
    out_dir.mkdir(parents=True, exist_ok=True)

    serial = next_serial(out_dir, prefix)
    path = out_dir / f"{prefix}_{serial:04d}.png"
    apply_masks(img, rects).save(path, format="PNG")

    _append_log(out_dir, path.name, rects, note)
    return path


def _append_log(out_dir: Path, filename: str, rects: list[MaskRect], note: str) -> None:
    """マスク内容の控え。検証用であり、持ち出し対象ではない."""
    log = out_dir / "_マスク控え.jsonl"
    record = {
        "出力ファイル": filename,
        "作成日時": datetime.now().isoformat(timespec="seconds"),
        "マスク数": len(rects),
        "マスク": [r.as_dict() for r in rects],
        "備考": note,
    }
    with log.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def audit_output_dir(out_dir: Path) -> list[str]:
    """DVD に焼く前の自主点検。問題があれば警告文のリストを返す.

    ここで空リストが返ることが、持ち出してよいことの最低条件。
    最終的には人が目視で塗り残しを確認すること。
    """
    warnings: list[str] = []
    if not out_dir.exists():
        return [f"出力フォルダが存在しません: {out_dir}"]

    pngs = sorted(out_dir.glob("*.png"))
    if not pngs:
        warnings.append("PNG が 1 枚もありません。")

    for f in out_dir.iterdir():
        if f.name.startswith("_"):
            continue  # 控えファイル（持ち出さない）
        if f.suffix.lower() != ".png":
            warnings.append(f"PNG 以外のファイルが混在しています: {f.name}")
            continue
        if not _SAFE_NAME.match(f.stem):
            warnings.append(f"ファイル名に想定外の文字が含まれます（個人情報混入の疑い）: {f.name}")
        if re.search(r"\d{7}", f.stem):
            warnings.append(f"ファイル名に受給者番号らしき 7 桁数字があります: {f.name}")

    masked = {r["出力ファイル"] for r in _read_log(out_dir)}
    for f in pngs:
        if f.name not in masked:
            warnings.append(f"マスク控えに記録がない PNG です（本ツール以外で作成？）: {f.name}")
    for r in _read_log(out_dir):
        if r["マスク数"] == 0:
            warnings.append(f"マスクが 1 つも指定されていません: {r['出力ファイル']}")
    return warnings


def _read_log(out_dir: Path) -> list[dict]:
    log = out_dir / "_マスク控え.jsonl"
    if not log.exists():
        return []
    records = []
    for line in log.read_text(encoding="utf-8").splitlines():
        if line.strip():
            records.append(json.loads(line))
    return records
