"""画面の共通部品.

方針は「情報密度を上げ、装飾を足さない」。1 日 8 時間、1 件 30 秒で流す道具なので、
角丸や影で飾るより、いまどこを触っていて、どの行がどの状態かが
一目で分かることを優先する。

配色そのものは theme.py にある（tkinter に依存させず、検証できるようにするため）。
"""
from __future__ import annotations

import tkinter as tk
from tkinter import font as tkfont, ttk

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


class ProgressWindow(tk.Toplevel):
    """時間のかかる処理の間、画面を固まったままにしないための小窓.

    「反応が無い」と、利用者は失敗したと思って強制終了してしまう。
    """

    def __init__(self, parent: tk.Misc, fonts: Fonts, theme: Theme, title: str) -> None:
        super().__init__(parent)
        self.title(title)
        self.configure(bg=theme.bg)
        self.geometry("420x110")
        self.resizable(False, False)
        self.transient(parent)
        self.grab_set()

        self.message = tk.Label(self, text="準備しています…", font=fonts.base,
                                bg=theme.bg, fg=theme.fg, anchor="w", padx=14, pady=12)
        self.message.pack(fill="x")
        self.bar = ttk.Progressbar(self, mode="indeterminate")
        self.bar.pack(fill="x", padx=14, pady=(0, 12))
        self.bar.start(12)
        self.update()

    def report(self, text: str, current: int | None = None, total: int | None = None) -> None:
        if current is not None and total:
            if self.bar["mode"] != "determinate":
                self.bar.stop()
                self.bar.config(mode="determinate", maximum=total)
            self.bar.config(value=current)
            self.message.config(text=f"{text}　{current} / {total}")
        else:
            self.message.config(text=text)
        self.update()

    def close(self) -> None:
        self.bar.stop()
        self.grab_release()
        self.destroy()


# ---------- 見た目を整える ----------
#
# 画面を組み終わったあとにウィジェットを歩いて、立体感を消し、内側に余白を足す。
# **構築側のコードに触らないので、bind も grid/pack も影響を受けない。**
# キーボード操作を壊さないことを、注意ではなくやり方で保証している。

SKIP_ATTR = "_shinsa_no_polish"

# 内側の余白（px）。情報密度は落とさず、文字と枠がくっつく息苦しさだけを解く。
PAD_X = 8
PAD_Y = 4


def keep_style(widget: tk.Misc) -> tk.Misc:
    """このウィジェットは触らない、という印。

    表示のたびに色を塗り替えている箇所（モード切替ボタンなど）に付ける。
    """
    setattr(widget, SKIP_ATTR, True)
    return widget


def polish(widget: tk.Misc, theme: Theme) -> None:
    """組み上がった画面を平らにする。子まで再帰する."""
    if not getattr(widget, SKIP_ATTR, False):
        try:
            _polish_one(widget, theme)
        except tk.TclError:
            pass  # その項目を持たないウィジェットは黙って飛ばす
    for child in widget.winfo_children():
        polish(child, theme)


def _polish_one(widget: tk.Misc, theme: Theme) -> None:
    kind = widget.winfo_class()

    if kind == "Button":
        widget.config(
            relief="flat", borderwidth=0, highlightthickness=1,
            highlightbackground=theme.line, highlightcolor=theme.accent,
            bg=theme.surface, fg=theme.fg,
            activebackground=theme.select_bg, activeforeground=theme.select_fg,
            padx=PAD_X, pady=PAD_Y, cursor="hand2",
        )
    elif kind == "Entry":
        widget.config(
            relief="flat", borderwidth=0, highlightthickness=1,
            highlightbackground=theme.line, highlightcolor=theme.accent,
            bg=theme.surface, fg=theme.fg, insertbackground=theme.fg,
        )
    elif kind == "Listbox":
        widget.config(
            relief="flat", borderwidth=0, highlightthickness=1,
            highlightbackground=theme.line, highlightcolor=theme.accent,
            bg=theme.surface, fg=theme.fg,
            selectbackground=theme.select_bg, selectforeground=theme.select_fg,
            activestyle="none",
        )
    elif kind in ("Checkbutton", "Radiobutton"):
        widget.config(
            relief="flat", borderwidth=0, highlightthickness=0,
            activebackground=widget.cget("bg"), activeforeground=theme.fg,
            selectcolor=theme.surface, padx=4, pady=2, cursor="hand2",
        )
    elif kind == "Text":
        widget.config(
            relief="flat", borderwidth=0, highlightthickness=1,
            highlightbackground=theme.line, bg=theme.surface, fg=theme.fg,
            padx=PAD_X, pady=PAD_Y,
        )
    elif kind == "Scrollbar":
        widget.config(
            relief="flat", borderwidth=0, highlightthickness=0,
            troughcolor=theme.surface, bg=theme.line, activebackground=theme.muted,
        )
    elif kind == "Menu":
        widget.config(
            bg=theme.surface, fg=theme.fg, relief="flat", borderwidth=0,
            activebackground=theme.select_bg, activeforeground=theme.select_fg,
        )
    # Label / Frame / Canvas は触らない。
    # Label と Frame は既定で平ら、Canvas はマークアップの描画に関わるため。


def setup_ttk_style(root: tk.Misc, theme: Theme, fonts: Fonts) -> None:
    """ttk（Combobox・進捗バー・スクロールバー）を平らにする.

    Windows 既定の vista / winnative は立体感が強く、色も変えられない。
    clam に切り替えたうえで、テーマの色で塗り直す。
    """
    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except tk.TclError:
        return

    flat = {"lightcolor": theme.surface, "darkcolor": theme.surface,
            "bordercolor": theme.line, "relief": "flat"}

    style.configure(
        "TCombobox", fieldbackground=theme.surface, background=theme.surface,
        foreground=theme.fg, arrowcolor=theme.muted, padding=(6, 3), **flat,
    )
    style.map(
        "TCombobox",
        fieldbackground=[("readonly", theme.surface), ("disabled", theme.bg)],
        foreground=[("disabled", theme.muted)],
        selectbackground=[("readonly", theme.surface)],
        selectforeground=[("readonly", theme.fg)],
        bordercolor=[("focus", theme.accent)],
    )
    style.configure(
        "TProgressbar", background=theme.accent, troughcolor=theme.surface,
        thickness=10, **flat,
    )
    style.configure(
        "Vertical.TScrollbar", background=theme.line, troughcolor=theme.surface,
        arrowcolor=theme.muted, **flat,
    )
    style.configure(
        "Treeview", background=theme.surface, fieldbackground=theme.surface,
        foreground=theme.fg, rowheight=int(22 * theme.font_scale), **flat,
    )
    style.configure(
        "Treeview.Heading", background=theme.bg, foreground=theme.muted,
        font=fonts.small, **flat,
    )
    style.map("Treeview", background=[("selected", theme.select_bg)],
              foreground=[("selected", theme.select_fg)])
