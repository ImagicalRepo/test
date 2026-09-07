"""画面の共通部品.

方針は「情報密度を上げ、装飾を足さない」。1 日 8 時間、1 件 30 秒で流す道具なので、
角丸や影で飾るより、いまどこを触っていて、どの行がどの状態かが
一目で分かることを優先する。

配色そのものは theme.py にある（tkinter に依存させず、検証できるようにするため）。
"""
from __future__ import annotations

import tkinter as tk
from tkinter import font as tkfont

from .theme import Theme

# ---------- 書体 ----------


def pick_font_family() -> str:
    """日本語が読みやすい書体を選ぶ。無ければ既定に任せる."""
    # 前半が Windows（配布先）、後半は開発機で確認するとき用
    preferred = [
        "Meiryo UI", "Meiryo", "Yu Gothic UI", "MS UI Gothic",
        "Noto Sans CJK JP", "IPAGothic",
    ]
    available = set(tkfont.families())
    for name in preferred:
        if name in available:
            return name
    return ""


class Fonts:
    """画面全体の書体。テーマの font_scale で一括して大きくできる."""

    def __init__(self, scale: float = 1.0) -> None:
        family = pick_font_family()

        def size(base: int) -> int:
            return max(8, round(base * scale))

        self.base = tkfont.Font(family=family, size=size(10))
        self.label = tkfont.Font(family=family, size=size(10))
        self.heading = tkfont.Font(family=family, size=size(12), weight="bold")
        self.result = tkfont.Font(family=family, size=size(26), weight="bold")
        self.reason = tkfont.Font(family=family, size=size(11))
        self.small = tkfont.Font(family=family, size=size(9))
        self.key = tkfont.Font(family=family, size=size(9), weight="bold")


# ---------- 共通部品 ----------


def heading(parent: tk.Misc, text: str, fonts: Fonts, theme: Theme) -> tk.Label:
    return tk.Label(parent, text=text, font=fonts.heading, bg=theme.bg, fg=theme.fg, anchor="w")


def separator(parent: tk.Misc, theme: Theme) -> tk.Frame:
    return tk.Frame(parent, height=1, bg=theme.line)


class KeyHintBar(tk.Frame):
    """いま押せるキーを常に出しておく帯.

    毎年入れ替わる未経験者が対象なので、覚えさせない。画面に出しておく。
    """

    def __init__(self, parent: tk.Misc, fonts: Fonts, theme: Theme) -> None:
        super().__init__(parent, bg=theme.surface, padx=6, pady=3)
        self.fonts = fonts
        self.theme = theme
        self._labels: list[tk.Widget] = []

    def show(self, pairs: list[tuple[str, str]]) -> None:
        """[("Enter", "完了して次へ"), ...] を並べる."""
        for widget in self._labels:
            widget.destroy()
        self._labels.clear()
        for key, action in pairs:
            holder = tk.Frame(self, bg=self.theme.surface)
            holder.pack(side="left", padx=(0, 12))
            tk.Label(
                holder, text=f" {key} ", font=self.fonts.key,
                bg=self.theme.fg, fg=self.theme.bg,
            ).pack(side="left")
            tk.Label(
                holder, text=f" {action}", font=self.fonts.small,
                bg=self.theme.surface, fg=self.theme.fg,
            ).pack(side="left")
            self._labels.append(holder)
