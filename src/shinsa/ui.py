"""GUI 共通部品.

想定利用者は PC 操作に慣れていない短期雇用のオペレーター。
文字は大きく、色の意味を固定し、余計な装飾を置かない。
"""
from __future__ import annotations

import tkinter as tk
from tkinter import font as tkfont

from .config import RESULT_ASK, RESULT_NG, RESULT_OK

# 結果ごとの配色。信号と同じ意味づけにして、説明を要らなくする。
RESULT_COLORS = {
    RESULT_OK: ("#1b5e20", "#e8f5e9"),   # 文字色, 背景色
    RESULT_NG: ("#b71c1c", "#ffebee"),
    RESULT_ASK: ("#e65100", "#fff8e1"),
}

BG = "#ffffff"
FG = "#212121"
MUTED = "#616161"
LINE = "#bdbdbd"


def pick_font_family() -> str:
    """日本語が読みやすいフォントを選ぶ。無ければ既定に任せる."""
    # 前半が Windows（配布先）、後半は開発機で確認するとき用
    preferred = [
        "Meiryo UI", "Meiryo", "Yu Gothic UI", "MS UI Gothic",
        "Noto Sans CJK JP", "IPAGothic",
    ]
    available = set(tkfont.families())
    for name in preferred:
        if name in available:
            return name
    return ""  # Tk の既定


class Fonts:
    """画面全体のフォント。1 件数十秒で読むため大きめに取る."""

    def __init__(self) -> None:
        family = pick_font_family()
        self.base = tkfont.Font(family=family, size=11)
        self.label = tkfont.Font(family=family, size=11)
        self.heading = tkfont.Font(family=family, size=13, weight="bold")
        self.result = tkfont.Font(family=family, size=28, weight="bold")
        self.reason = tkfont.Font(family=family, size=12)
        self.small = tkfont.Font(family=family, size=9)


def heading(parent: tk.Misc, text: str, fonts: Fonts) -> tk.Label:
    return tk.Label(parent, text=text, font=fonts.heading, bg=BG, fg=FG, anchor="w")


def separator(parent: tk.Misc) -> tk.Frame:
    return tk.Frame(parent, height=1, bg=LINE)
