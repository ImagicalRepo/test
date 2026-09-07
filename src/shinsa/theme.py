"""配色（テーマ）とコントラストの計算.

画面から切り離してあるので、tkinter が無くても検証できる。
1 日 8 時間見る画面なので、配色は「見やすいと思う」ではなく
コントラスト比を計算して担保する（tests/test_theme.py）。

**色だけで情報を伝えない。** 状態は色に加えて記号（○ × △）と文字で示す。
色覚の個人差と、テーマを 8 色用意することの両方に効く。
"""
from __future__ import annotations

import json
from dataclasses import dataclass

from .config import (
    CHECK_ASK, CHECK_BLANK, CHECK_NA, CHECK_NG, CHECK_OK,
    RESULT_ASK, RESULT_NG, RESULT_OK, app_dir,
)

SETTINGS_NAME = "設定.json"

# 状態を表す記号。色が見分けられなくても判別できるようにする。
# ○×△ は日本語圏で意味が固定しているので、説明が要らない。
CHECK_SYMBOLS = {
    CHECK_OK: "○",
    CHECK_NG: "×",
    CHECK_ASK: "△",
    CHECK_NA: "－",
    CHECK_BLANK: "　",
}

RESULT_SYMBOLS = {RESULT_OK: "○", RESULT_NG: "×", RESULT_ASK: "△"}


@dataclass(frozen=True)
class Theme:
    """1 つの配色.

    どの色も、文字と背景の組み合わせでコントラスト比 4.5:1 以上を満たすこと。
    tests/test_theme.py で機械的に検証している。
    """

    name: str
    note: str
    bg: str            # 画面の地
    surface: str       # 一段沈めた面（一覧・入力欄）
    fg: str            # 本文
    muted: str         # 補足（キーヒントなど）
    line: str          # 罫線
    focus: str         # いま触っている場所の枠
    canvas_bg: str     # 書類画像の周囲
    select_bg: str     # 現在行
    select_fg: str
    ok_fg: str
    ok_bg: str
    ng_fg: str
    ng_bg: str
    ask_fg: str
    ask_bg: str
    # 枠線・強調にだけ使う色。彩度を落としてあり、本文の 4.5:1 は満たさないので
    # **文字色には使わない**。用途を分けることで、目に優しさと可読性を両立させる。
    accent: str = "#3b82f6"        # 強調（枠線・下線）
    accent_soft: str = "#93b8f5"   # 弱い強調（区切り・非活性）
    danger: str = "#ef4444"        # 警告の枠線
    font_scale: float = 1.0

    def result_colors(self) -> dict[str, tuple[str, str]]:
        return {
            RESULT_OK: (self.ok_fg, self.ok_bg),
            RESULT_NG: (self.ng_fg, self.ng_bg),
            RESULT_ASK: (self.ask_fg, self.ask_bg),
        }


THEMES: dict[str, Theme] = {
    "標準": Theme(
        accent="#3b82f6", accent_soft="#9dbdf5", danger="#ef4444",
        name="標準", note="白地。既定",
        bg="#ffffff", surface="#f2f2f2", fg="#141414", muted="#475569",
        line="#919191", focus="#0d47a1", canvas_bg="#5c5c5c",
        select_bg="#d6e4f7", select_fg="#101010",
        ok_fg="#14521a", ok_bg="#e4f2e5", ng_fg="#8c1111", ng_bg="#fbe4e4",
        ask_fg="#6b3a00", ask_bg="#fdf0d9",
    ),
    "アイボリー": Theme(
        accent="#b06d1f", accent_soft="#ddc08e", danger="#d9534f",
        name="アイボリー", note="白がまぶしい人向け",
        bg="#faf7ef", surface="#f0eadb", fg="#241f16", muted="#4d4638",
        line="#978c73", focus="#8a4b00", canvas_bg="#5a544a",
        select_bg="#e6d9b8", select_fg="#1a160f",
        ok_fg="#14521a", ok_bg="#e2eedd", ng_fg="#8c1111", ng_bg="#f6e2dc",
        ask_fg="#6b3a00", ask_bg="#f4e6c8",
    ),
    "ミント": Theme(
        accent="#2f8f73", accent_soft="#9ccfbc", danger="#d9534f",
        name="ミント", note="淡い緑",
        bg="#f1f7f4", surface="#e3efea", fg="#12271f", muted="#3d5349",
        line="#759388", focus="#0d5c46", canvas_bg="#4f5a56",
        select_bg="#c9e3d8", select_fg="#0d1f19",
        ok_fg="#14521a", ok_bg="#dcecdd", ng_fg="#8c1111", ng_bg="#f5e0e0",
        ask_fg="#6b3a00", ask_bg="#f1e6cc",
    ),
    "サクラ": Theme(
        accent="#c2557a", accent_soft="#e6adc0", danger="#d9534f",
        name="サクラ", note="淡い桃",
        bg="#fdf4f6", surface="#f7e7eb", fg="#2b1a1f", muted="#564249",
        line="#a2848b", focus="#8a1f43", canvas_bg="#5c5254",
        select_bg="#f0d2da", select_fg="#22151a",
        ok_fg="#14521a", ok_bg="#e4efe2", ng_fg="#8c1111", ng_bg="#f8ddde",
        ask_fg="#6b3a00", ask_bg="#f6e7cd",
    ),
    "スカイ": Theme(
        accent="#2f7fbf", accent_soft="#9dc4e0", danger="#d9534f",
        name="スカイ", note="淡い青",
        bg="#f2f7fc", surface="#e4eef7", fg="#12222e", muted="#41525f",
        line="#7990a2", focus="#0b4a7a", canvas_bg="#4e565e",
        select_bg="#cde0f0", select_fg="#0d1a23",
        ok_fg="#14521a", ok_bg="#e0eede", ng_fg="#8c1111", ng_bg="#f7dfe0",
        ask_fg="#6b3a00", ask_bg="#f4e7cc",
    ),
    "ラベンダー": Theme(
        accent="#7a5fb0", accent_soft="#c0aede", danger="#d9534f",
        name="ラベンダー", note="淡い紫",
        bg="#f7f4fb", surface="#ebe4f4", fg="#211a2c", muted="#4a4057",
        line="#9185a5", focus="#4a2a7a", canvas_bg="#575262",
        select_bg="#ddd0ee", select_fg="#191324",
        ok_fg="#14521a", ok_bg="#e2eee0", ng_fg="#8c1111", ng_bg="#f7dfe2",
        ask_fg="#6b3a00", ask_bg="#f4e6cd",
    ),
    "高コントラスト": Theme(
        accent="#00308f", accent_soft="#5a7fc0", danger="#7a0000",
        name="高コントラスト", note="文字を大きく、線を濃く",
        bg="#ffffff", surface="#ededed", fg="#000000", muted="#2b2b2b",
        line="#000000", focus="#00308f", canvas_bg="#3a3a3a",
        select_bg="#ffe680", select_fg="#000000",
        ok_fg="#00420a", ok_bg="#ffffff", ng_fg="#7a0000", ng_bg="#ffffff",
        ask_fg="#5a2f00", ask_bg="#ffffff",
        font_scale=1.15,
    ),
    "ダーク": Theme(
        accent="#7fb3ff", accent_soft="#4a6a99", danger="#f28b82",
        name="ダーク", note="暗い部屋・夜間",
        bg="#1f2124", surface="#2a2d31", fg="#e9eaec", muted="#a9adb3",
        line="#686e75", focus="#7fb3ff", canvas_bg="#141517",
        select_bg="#3c4552", select_fg="#ffffff",
        ok_fg="#8fd694", ok_bg="#22301f", ng_fg="#f28b82", ng_bg="#331f1f",
        ask_fg="#f2c16b", ask_bg="#332a1c",
    ),
}

DEFAULT_THEME = "標準"


# ---------- コントラスト比（WCAG） ----------


def _channel(value: int) -> float:
    ratio = value / 255
    return ratio / 12.92 if ratio <= 0.04045 else ((ratio + 0.055) / 1.055) ** 2.4


def luminance(color: str) -> float:
    """相対輝度. color は #rrggbb."""
    text = color.lstrip("#")
    r, g, b = (int(text[i : i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def contrast_ratio(a: str, b: str) -> float:
    """2 色のコントラスト比（1.0〜21.0）. 本文は 4.5 以上が目安."""
    high, low = sorted((luminance(a), luminance(b)), reverse=True)
    return (high + 0.05) / (low + 0.05)


# ---------- 設定の保存 ----------


def load_theme_name() -> str:
    path = app_dir() / SETTINGS_NAME
    if path.exists():
        try:
            name = json.loads(path.read_text(encoding="utf-8")).get("テーマ")
            if name in THEMES:
                return name
        except (OSError, ValueError):
            pass
    return DEFAULT_THEME


def save_theme_name(name: str) -> None:
    path = app_dir() / SETTINGS_NAME
    data = {}
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
    data["テーマ"] = name
    try:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass  # 書き込めなくても動作は続ける（読み取り専用の場所に置かれた場合）
