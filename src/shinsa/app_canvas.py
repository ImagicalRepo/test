"""作業窓：左右 2 カラムでページを見比べ、マークアップする.

左＝申請書、右＝その他の提出書類。各カラムは独立してページ送り・拡大できる。

左右を **1 つの Canvas** として扱っている。別ウィジェットに分けると、
カラムをまたぐ結線（＝何と何を比較したか）が引けないため。

**既定は「閲覧」で、ドラッグはスクロールになる。** 枠が出るのは「囲む」を
選んだときだけ。ふいのクリックで枠が出ると鬱陶しいため。
"""
from __future__ import annotations

import tkinter as tk
from dataclasses import dataclass, field
from pathlib import Path
from tkinter import messagebox, ttk
from typing import Callable

from PIL import Image, ImageTk

from . import pdfio
from .config import MASK_NOT_NEEDED, MASK_STATES
from .markup import SIDE_LEFT, SIDE_RIGHT, ComparisonSet, MarkupRegion, MaskRegion
from .masking import BLACKOUT, MOSAIC
from .prefetch import Prefetcher
from .theme import Theme
from .ui import Fonts, KeyHintBar, keep_style, polish, setup_ttk_style
from .viewport import Viewport

MODE_VIEW = "閲覧"
MODE_REGION = "囲む"
MODE_MASK = "隠す"

REGION_COLOR = "#d32f2f"
MASK_COLOR = "#263238"
TEMP_COLOR = "#1565c0"
MIN_DRAG = 5

KEY_HINTS = [
    ("0", "閲覧"), ("1", "囲む"), ("2", "隠す"),
    ("←→", "ページ"), ("Tab", "左右"), ("+ -", "拡大"), ("F", "全体"), ("B", "印"),
    ("Ctrl+Z", "取消"), ("Enter", "保存"), ("Esc", "閲覧へ"),
]


@dataclass
class PaneState:
    """1 カラムの状態."""

    side: str
    title: str
    pdf_path: Path | None = None
    page_index: int = 0
    page_count: int = 0
    doc_label: str = ""
    image: Image.Image | None = None
    viewport: Viewport | None = None
    bookmarks: list[int] = field(default_factory=list)
    photo: ImageTk.PhotoImage | None = None   # GC されないよう保持する
    # 利用者が拡大・スクロールしたか。していなければ、窓の大きさが変わるたびに
    # 全体が見えるように収め直す。
    user_adjusted: bool = False


class CanvasWindow(tk.Toplevel):
    def __init__(
        self,
        parent: tk.Misc,
        fonts: Fonts,
        theme: Theme,
        prefetcher: Prefetcher,
        on_save: Callable[[ComparisonSet, str, str], None],
        comparison_options: list[str] | None = None,
        defect_options: list[str] | None = None,
    ) -> None:
        super().__init__(parent)
        self.fonts = fonts
        self.theme = theme
        self.prefetcher = prefetcher
        self.on_save = on_save

        self.panes = {
            SIDE_LEFT: PaneState(SIDE_LEFT, "申請書"),
            SIDE_RIGHT: PaneState(SIDE_RIGHT, "その他の提出書類"),
        }
        self.active_side = SIDE_LEFT
        self.regions: list[MarkupRegion] = []
        self.masks: list[MaskRegion] = []
        # 囲みとマスクを混ぜて、追加した順に取り消せるようにする
        self.history: list[tuple[str, object]] = []

        self.mode = tk.StringVar(value=MODE_VIEW)
        self.mask_style = tk.StringVar(value=BLACKOUT)
        self.comparison = tk.StringVar()
        self.defect_code = tk.StringVar()
        self.note = tk.StringVar()
        self.mask_status = tk.StringVar(value=MASK_NOT_NEEDED)

        self._drag_start: tuple[int, int] | None = None
        self._drag_side: str | None = None
        self._drag_last: tuple[int, int] | None = None
        self._temp_shape: int | None = None

        self.title("作業窓　－　書類の見比べ")
        self.geometry("1500x920")
        self.configure(bg=theme.bg)
        self.protocol("WM_DELETE_WINDOW", self.withdraw)  # 閉じても状態を捨てない

        setup_ttk_style(self, theme, fonts)
        self._build(comparison_options or [], defect_options or [])
        polish(self, theme)
        self._bind_keys()
        self.canvas.bind("<Configure>", lambda _e: self._relayout())
        self._update_mode_look()

    # ---------- 画面 ----------

    def _build(self, comparison_options: list[str], defect_options: list[str]) -> None:
        t = self.theme
        bar = tk.Frame(self, bg=t.surface, padx=6, pady=4)
        bar.pack(fill="x")

        self.mode_buttons: dict[str, tk.Radiobutton] = {}
        for key, text, value in [("0", "閲覧", MODE_VIEW), ("1", "囲む", MODE_REGION),
                                 ("2", "隠す", MODE_MASK)]:
            button = tk.Radiobutton(
                bar, text=f"[{key}] {text}", variable=self.mode, value=value,
                font=self.fonts.base, bg=t.surface, fg=t.fg, activebackground=t.surface,
                selectcolor=t.bg, indicatoron=False, padx=10, pady=3,
                command=self._on_mode_changed,
            )
            button.pack(side="left", padx=(0, 4))
            keep_style(button)   # _update_mode_look が色を塗り替えるため
            self.mode_buttons[value] = button

        tk.Label(bar, text="│", bg=t.surface, fg=t.line).pack(side="left", padx=6)
        for text, value in [("黒塗り", BLACKOUT), ("モザイク", MOSAIC)]:
            tk.Radiobutton(
                bar, text=text, variable=self.mask_style, value=value,
                font=self.fonts.base, bg=t.surface, fg=t.fg,
                activebackground=t.surface, selectcolor=t.bg,
            ).pack(side="left")

        tk.Button(bar, text="直前を取消 (Ctrl+Z)", command=self._undo,
                  font=self.fonts.base).pack(side="left", padx=(12, 4))
        tk.Button(bar, text="すべて消す", command=self._clear,
                  font=self.fonts.base).pack(side="left")

        detail = tk.Frame(self, bg=t.bg, padx=6, pady=3)
        detail.pack(fill="x")
        for label, widget in [
            ("比較項目", ttk.Combobox(detail, textvariable=self.comparison,
                                      values=comparison_options, width=13, font=self.fonts.base)),
            ("不備理由", ttk.Combobox(detail, textvariable=self.defect_code,
                                      values=defect_options, width=11, state="readonly",
                                      font=self.fonts.base)),
        ]:
            tk.Label(detail, text=label, bg=t.bg, fg=t.fg, font=self.fonts.base).pack(side="left")
            widget.pack(side="left", padx=(3, 10))
        tk.Label(detail, text="理由・気づいたこと", bg=t.bg, fg=t.fg,
                 font=self.fonts.base).pack(side="left")
        tk.Entry(detail, textvariable=self.note, width=44, font=self.fonts.base,
                 bg=t.surface, fg=t.fg, insertbackground=t.fg).pack(side="left", padx=3)
        tk.Label(detail, text="マスキング", bg=t.bg, fg=t.fg,
                 font=self.fonts.base).pack(side="left", padx=(10, 2))
        ttk.Combobox(detail, textvariable=self.mask_status, values=list(MASK_STATES),
                     width=5, state="readonly", font=self.fonts.base).pack(side="left")
        tk.Button(detail, text="この比較を保存 (Enter)", command=self._save,
                  font=self.fonts.heading).pack(side="right")

        nav = tk.Frame(self, bg=t.bg)
        nav.pack(fill="x")
        self.nav_widgets = {}
        for side in (SIDE_LEFT, SIDE_RIGHT):
            holder = tk.Frame(nav, bg=t.bg, padx=6, pady=1,
                              highlightthickness=2, highlightbackground=t.bg)
            holder.pack(side="left", fill="x", expand=True)
            self.nav_widgets[side] = self._build_nav(holder, side)
            self.nav_widgets[side]["holder"] = holder

        self.canvas = tk.Canvas(self, bg=t.canvas_bg, highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.canvas.bind("<ButtonPress-1>", self._on_press)
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_release)
        self.canvas.bind("<MouseWheel>", lambda e: self._scroll(e, -e.delta))
        self.canvas.bind("<Button-4>", lambda e: self._scroll(e, -120))
        self.canvas.bind("<Button-5>", lambda e: self._scroll(e, 120))

        self.hint_bar = KeyHintBar(self, self.fonts, t)
        self.hint_bar.pack(fill="x")
        self.hint_bar.show(KEY_HINTS)

        self.status = tk.Label(self, text="", font=self.fonts.small, bg=t.bg, fg=t.muted,
                               anchor="w", padx=6)
        self.status.pack(fill="x")

    def _build_nav(self, holder: tk.Frame, side: str) -> dict:
        t = self.theme
        pane = self.panes[side]
        top = tk.Frame(holder, bg=t.bg)
        top.pack(fill="x")
        tk.Label(top, text=pane.title, font=self.fonts.heading, bg=t.bg, fg=t.fg).pack(side="left")
        label = tk.Label(top, text="", font=self.fonts.small, bg=t.bg, fg=t.muted)
        label.pack(side="left", padx=6)

        controls = tk.Frame(holder, bg=t.bg)
        controls.pack(fill="x")
        tk.Button(controls, text="◀", width=3,
                  command=lambda: self._step_page(side, -1)).pack(side="left")
        page = tk.Label(controls, text="- / -", font=self.fonts.base, bg=t.bg, fg=t.fg, width=8)
        page.pack(side="left")
        tk.Button(controls, text="▶", width=3,
                  command=lambda: self._step_page(side, 1)).pack(side="left")
        tk.Button(controls, text="－", width=3,
                  command=lambda: self._zoom(side, 1 / 1.25)).pack(side="left", padx=(8, 0))
        tk.Button(controls, text="＋", width=3,
                  command=lambda: self._zoom(side, 1.25)).pack(side="left")
        tk.Button(controls, text="全体", command=lambda: self._fit(side)).pack(side="left", padx=3)
        tk.Button(controls, text="このページに印",
                  command=lambda: self._bookmark(side)).pack(side="left", padx=3)

        marks = tk.Frame(holder, bg=t.bg)
        marks.pack(fill="x")
        return {"page": page, "label": label, "marks": marks}

    # ---------- キー ----------

    def _bind_keys(self) -> None:
        binds = {
            "<Key-0>": lambda e: self._set_mode(MODE_VIEW),
            "<KP_0>": lambda e: self._set_mode(MODE_VIEW),
            "<Key-1>": lambda e: self._set_mode(MODE_REGION),
            "<KP_1>": lambda e: self._set_mode(MODE_REGION),
            "<Key-2>": lambda e: self._set_mode(MODE_MASK),
            "<KP_2>": lambda e: self._set_mode(MODE_MASK),
            "<Escape>": lambda e: self._set_mode(MODE_VIEW),
            "<Control-z>": lambda e: self._undo(),
            "<Return>": lambda e: self._save(),
            "<KP_Enter>": lambda e: self._save(),
            "<Tab>": lambda e: self._switch_side(),
            "<Left>": lambda e: self._step_page(self.active_side, -1),
            "<Right>": lambda e: self._step_page(self.active_side, 1),
            "<plus>": lambda e: self._zoom(self.active_side, 1.25),
            "<KP_Add>": lambda e: self._zoom(self.active_side, 1.25),
            "<minus>": lambda e: self._zoom(self.active_side, 1 / 1.25),
            "<KP_Subtract>": lambda e: self._zoom(self.active_side, 1 / 1.25),
            "<f>": lambda e: self._fit(self.active_side),
            "<b>": lambda e: self._bookmark(self.active_side),
        }
        for sequence, handler in binds.items():
            self.bind(sequence, lambda e, h=handler: self._guard(e, h))

    def _guard(self, event: tk.Event, handler) -> str | None:
        """入力欄で打っているときは、キー操作を横取りしない."""
        if isinstance(event.widget, (tk.Entry, ttk.Combobox, ttk.Entry)):
            return None
        handler(event)
        return "break"

    def _switch_side(self) -> None:
        self.active_side = SIDE_RIGHT if self.active_side == SIDE_LEFT else SIDE_LEFT
        self._update_mode_look()

    def _set_mode(self, mode: str) -> None:
        self.mode.set(mode)
        self._on_mode_changed()

    def _on_mode_changed(self) -> None:
        self._update_mode_look()
        self._redraw()

    def _update_mode_look(self) -> None:
        """いまのモードと、操作対象のカラムを枠で示す."""
        t = self.theme
        for value, button in self.mode_buttons.items():
            selected = self.mode.get() == value
            button.config(bg=t.focus if selected else t.surface,
                          fg=t.bg if selected else t.fg)
        for side, widgets in self.nav_widgets.items():
            widgets["holder"].config(
                highlightbackground=t.focus if side == self.active_side else t.bg
            )
        mode = self.mode.get()
        message = {
            MODE_VIEW: "閲覧中：ドラッグで画像を動かします。枠は出ません。",
            MODE_REGION: "囲む：左右それぞれをドラッグで囲むと、線で結ばれます。",
            MODE_MASK: "隠す：個人情報をドラッグで囲むと、書き出し時に消えます。",
        }[mode]
        self.status.config(text=f"{message}　操作するカラム: {self.active_side}")

    # ---------- ページの読み込み ----------

    def set_document(
        self, side: str, pdf_path: Path, doc_label: str = "",
        page_index: int = 0, bookmarks: list[int] | None = None,
    ) -> None:
        pane = self.panes[side]
        pane.pdf_path = pdf_path
        pane.page_count = pdfio.page_count(pdf_path)
        pane.page_index = max(0, min(page_index, pane.page_count - 1))
        pane.doc_label = doc_label
        pane.bookmarks = bookmarks if bookmarks is not None else []
        pane.user_adjusted = False
        self._load_page(side, fit=True)

    def _load_page(self, side: str, fit: bool = False) -> None:
        pane = self.panes[side]
        if pane.pdf_path is None:
            return
        pane.image = self.prefetcher.load(pane.pdf_path, pane.page_index)
        # 窓の寸法が確定してから倍率を決める。確定前だと幅が 1 のまま計算され、
        # 極小の倍率で固定されてページが見えなくなる。
        self.canvas.update_idletasks()
        rect = self._pane_rect(side)
        view = Viewport(pane.image.width, pane.image.height, *rect)
        if fit or pane.viewport is None or not pane.user_adjusted:
            pane.viewport = view.fitted()
            pane.user_adjusted = False
        else:
            pane.viewport = view.resized(*rect)
        self._refresh_nav(side)
        self._redraw()

    def _refresh_nav(self, side: str) -> None:
        pane = self.panes[side]
        widgets = self.nav_widgets[side]
        widgets["page"].config(
            text=f"{pane.page_index + 1} / {pane.page_count}" if pane.page_count else "- / -"
        )
        widgets["label"].config(text=pane.doc_label or (pane.pdf_path.name if pane.pdf_path else ""))

        for child in widgets["marks"].winfo_children():
            child.destroy()
        if pane.bookmarks:
            tk.Label(widgets["marks"], text="印:", font=self.fonts.small,
                     bg=self.theme.bg, fg=self.theme.muted).pack(side="left")
        for page_index in pane.bookmarks:
            tk.Button(
                widgets["marks"], text=f"p.{page_index + 1}", font=self.fonts.small,
                command=lambda s=side, p=page_index: self._goto(s, p),
            ).pack(side="left", padx=1)
        polish(widgets["marks"], self.theme)

    # ---------- 操作 ----------

    def _step_page(self, side: str, delta: int) -> None:
        pane = self.panes[side]
        if not pane.page_count:
            return
        self._goto(side, max(0, min(pane.page_index + delta, pane.page_count - 1)))

    def _goto(self, side: str, page_index: int) -> None:
        pane = self.panes[side]
        if page_index == pane.page_index:
            return
        pane.page_index = page_index
        self._load_page(side, fit=True)

    def _bookmark(self, side: str) -> None:
        """申請書はオモテ・ウラ・ダミーで 3 ページに及ぶことがあるため、印で行き来する."""
        pane = self.panes[side]
        if not pane.page_count:
            return
        if pane.page_index in pane.bookmarks:
            pane.bookmarks.remove(pane.page_index)
        else:
            pane.bookmarks.append(pane.page_index)
            pane.bookmarks.sort()
        self._refresh_nav(side)

    def _zoom(self, side: str, factor: float) -> None:
        pane = self.panes[side]
        if pane.viewport:
            pane.viewport = pane.viewport.zoomed(factor)
            pane.user_adjusted = True
            self._redraw()

    def _fit(self, side: str) -> None:
        pane = self.panes[side]
        if pane.viewport:
            pane.viewport = pane.viewport.fitted()
            pane.user_adjusted = False
            self._redraw()

    def _scroll(self, event: tk.Event, delta: int) -> None:
        side = self._side_at(event.x)
        pane = self.panes.get(side) if side else None
        if not pane or not pane.viewport:
            return
        if event.state & 0x0004:  # Ctrl
            pane.viewport = pane.viewport.zoomed(1.1 if delta < 0 else 1 / 1.1, (event.x, event.y))
        else:
            pane.viewport = pane.viewport.scrolled(0, delta * 0.6)
        pane.user_adjusted = True
        self._redraw()

    # ---------- 描画 ----------

    def _pane_rect(self, side: str) -> tuple[int, int, int, int]:
        width = max(self.canvas.winfo_width(), 2)
        height = max(self.canvas.winfo_height(), 2)
        half = width // 2
        return (0, 0, half, height) if side == SIDE_LEFT else (half, 0, width - half, height)

    def _side_at(self, x: int) -> str:
        return SIDE_LEFT if x < self.canvas.winfo_width() // 2 else SIDE_RIGHT

    def _relayout(self) -> None:
        for side, pane in self.panes.items():
            if not pane.viewport:
                continue
            resized = pane.viewport.resized(*self._pane_rect(side))
            pane.viewport = resized if pane.user_adjusted else resized.fitted()
        self._redraw()

    def _redraw(self) -> None:
        self.canvas.delete("all")
        half = self.canvas.winfo_width() // 2
        self.canvas.create_line(half, 0, half, self.canvas.winfo_height(),
                                fill=self.theme.line)

        for side, pane in self.panes.items():
            if pane.image is None or pane.viewport is None:
                continue
            visible = pane.viewport.visible_source()
            if visible is None:
                continue
            crop, size, position = visible
            pane.photo = ImageTk.PhotoImage(
                pane.image.crop(crop).resize(size, Image.Resampling.BILINEAR)
            )
            self.canvas.create_image(position, image=pane.photo, anchor="nw")

        anchors: dict[str, tuple[float, float]] = {}
        for region in self.regions:
            pane = self.panes[region.side]
            if not pane.viewport:
                continue
            box = pane.viewport.canvas_box(region.box)
            self.canvas.create_rectangle(box, outline=REGION_COLOR, width=3)
            if region.label:
                self.canvas.create_text(
                    box[0] + 3, box[1] - 9, text=region.label, anchor="w",
                    fill=REGION_COLOR, font=self.fonts.small,
                )
            anchors.setdefault(
                region.side,
                (box[2], (box[1] + box[3]) / 2) if region.side == SIDE_LEFT
                else (box[0], (box[1] + box[3]) / 2),
            )
        if SIDE_LEFT in anchors and SIDE_RIGHT in anchors:
            self.canvas.create_line(*anchors[SIDE_LEFT], *anchors[SIDE_RIGHT],
                                    fill=REGION_COLOR, width=2)

        for mask in self.masks:
            pane = self.panes[mask.side]
            if not pane.viewport:
                continue
            self.canvas.create_rectangle(
                pane.viewport.canvas_box(mask.box),
                fill=MASK_COLOR, outline=MASK_COLOR,
                stipple="gray50" if mask.style == MOSAIC else "",
            )

    # ---------- ドラッグ ----------

    def _on_press(self, event: tk.Event) -> None:
        side = self._side_at(event.x)
        pane = self.panes.get(side)
        if not pane or not pane.viewport:
            return
        self.active_side = side
        self._drag_start = (event.x, event.y)
        self._drag_last = (event.x, event.y)
        self._drag_side = side
        self._update_mode_look()

    def _on_drag(self, event: tk.Event) -> None:
        if not self._drag_start or not self._drag_side:
            return
        if self.mode.get() == MODE_VIEW:
            # 閲覧中はドラッグで画像を動かす。枠は出さない
            pane = self.panes[self._drag_side]
            if pane.viewport and self._drag_last:
                dx = self._drag_last[0] - event.x
                dy = self._drag_last[1] - event.y
                pane.viewport = pane.viewport.scrolled(dx, dy)
                pane.user_adjusted = True
                self._redraw()
            self._drag_last = (event.x, event.y)
            return
        if self._temp_shape:
            self.canvas.delete(self._temp_shape)
        self._temp_shape = self.canvas.create_rectangle(
            *self._drag_start, event.x, event.y, outline=TEMP_COLOR, width=2
        )

    def _on_release(self, event: tk.Event) -> None:
        if not self._drag_start or not self._drag_side:
            return
        start, side = self._drag_start, self._drag_side
        self._drag_start = self._drag_side = self._drag_last = None
        if self._temp_shape:
            self.canvas.delete(self._temp_shape)
            self._temp_shape = None

        mode = self.mode.get()
        if mode == MODE_VIEW:
            return  # 閲覧中は何も作らない
        if abs(event.x - start[0]) < MIN_DRAG or abs(event.y - start[1]) < MIN_DRAG:
            return  # 誤クリック

        pane = self.panes[side]
        box = pane.viewport.ratio_box(start, (event.x, event.y))
        if mode == MODE_REGION:
            region = MarkupRegion(side, pane.page_index, box, pane.doc_label)
            self.regions.append(region)
            self.history.append((MODE_REGION, region))
        else:
            mask = MaskRegion(side, box, self.mask_style.get())
            self.masks.append(mask)
            self.history.append((MODE_MASK, mask))
        self._redraw()

    def _undo(self) -> None:
        """囲みとマスクを、追加した順に取り消す（Ctrl+Z）."""
        if not self.history:
            return
        kind, item = self.history.pop()
        target = self.regions if kind == MODE_REGION else self.masks
        if item in target:
            target.remove(item)
        self._redraw()

    def _clear(self) -> None:
        self.regions.clear()
        self.masks.clear()
        self.history.clear()
        self._redraw()

    # ---------- 保存 ----------

    def _save(self) -> None:
        if not self.regions:
            messagebox.showinfo("作業窓", "比較する箇所を囲んでください。", parent=self)
            return
        comparison = ComparisonSet(
            regions=list(self.regions),
            comparison=self.comparison.get().strip(),
            defect_code=self.defect_code.get().strip(),
            note=self.note.get().strip(),
            masks=list(self.masks),
        )
        if not comparison.is_complete and not messagebox.askyesno(
            "作業窓",
            "片側しか囲まれていません。\n"
            "このままだと「何と比べたか」が画像に残りません。続けますか？",
            parent=self,
        ):
            return
        self.on_save(comparison, self.mask_status.get(), self.note.get().strip())

    def reset(self) -> None:
        """次の申請に移るときに呼ぶ."""
        self._clear()
        self.comparison.set("")
        self.defect_code.set("")
        self.note.set("")
        self.mask_status.set(MASK_NOT_NEEDED)
        self._set_mode(MODE_VIEW)

    def current_images(self) -> tuple[Image.Image | None, Image.Image | None]:
        return self.panes[SIDE_LEFT].image, self.panes[SIDE_RIGHT].image

    def current_titles(self) -> tuple[str, str]:
        left, right = self.panes[SIDE_LEFT], self.panes[SIDE_RIGHT]
        return (
            f"{left.doc_label or left.title}  p.{left.page_index + 1}",
            f"{right.doc_label or right.title}  p.{right.page_index + 1}",
        )
