"""作業窓：左右 2 カラムでページを見比べ、マークアップする.

左＝申請書、右＝その他の提出書類。各カラムは独立してページ送り・拡大できる。

左右を **1 つの Canvas** として扱っている。別ウィジェットに分けると、
カラムをまたぐ結線（＝何と何を比較したか）が引けないため。
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
from .ui import BG, FG, LINE, MUTED, Fonts
from .viewport import Viewport

MODE_REGION = "領域"
MODE_MASK = "マスク"

REGION_COLOR = "#c62828"
MASK_COLOR = "#37474f"
TEMP_COLOR = "#1565c0"
MIN_DRAG = 5


@dataclass
class PaneState:
    """1 カラムの状態."""

    side: str
    title: str
    pdf_path: Path | None = None
    page_index: int = 0
    page_count: int = 0
    doc_label: str = ""                       # この面の書類名（囲みのラベルになる）
    image: Image.Image | None = None
    viewport: Viewport | None = None
    bookmarks: list[int] = field(default_factory=list)
    photo: ImageTk.PhotoImage | None = None   # GC されないよう保持する
    # 利用者が拡大・スクロールしたか。していなければ、窓の大きさが変わるたびに
    # 全体が見えるように収め直す。これが無いと、窓の寸法が決まる前に計算した
    # 倍率のまま固定され、ページが表示されないことがある。
    user_adjusted: bool = False


class CanvasWindow(tk.Toplevel):
    def __init__(
        self,
        parent: tk.Misc,
        fonts: Fonts,
        prefetcher: Prefetcher,
        on_save: Callable[[ComparisonSet, str, str], None],
        comparison_options: list[str] | None = None,
        defect_options: list[str] | None = None,
    ) -> None:
        super().__init__(parent)
        self.fonts = fonts
        self.prefetcher = prefetcher
        self.on_save = on_save

        self.panes = {
            SIDE_LEFT: PaneState(SIDE_LEFT, "申請書"),
            SIDE_RIGHT: PaneState(SIDE_RIGHT, "その他の提出書類"),
        }
        self.regions: list[MarkupRegion] = []
        self.masks: list[MaskRegion] = []
        self.mode = tk.StringVar(value=MODE_REGION)
        self.mask_style = tk.StringVar(value=BLACKOUT)
        self.comparison = tk.StringVar()
        self.defect_code = tk.StringVar()
        self.note = tk.StringVar()
        self.mask_status = tk.StringVar(value=MASK_NOT_NEEDED)

        self._drag_start: tuple[int, int] | None = None
        self._drag_side: str | None = None
        self._temp_shape: int | None = None

        self.title("作業窓　－　書類の見比べ")
        self.geometry("1500x900")
        self.configure(bg=BG)
        self.protocol("WM_DELETE_WINDOW", self.withdraw)  # 閉じても状態を捨てない

        self._build(comparison_options or [], defect_options or [])
        self.canvas.bind("<Configure>", lambda _e: self._relayout())

    # ---------- 画面 ----------

    def _build(self, comparison_options: list[str], defect_options: list[str]) -> None:
        bar = tk.Frame(self, bg=BG, padx=8, pady=6)
        bar.pack(fill="x")

        for text, value in [("① 比較箇所を囲む", MODE_REGION), ("② 個人情報を隠す", MODE_MASK)]:
            tk.Radiobutton(
                bar, text=text, variable=self.mode, value=value, font=self.fonts.base,
                bg=BG, activebackground=BG, command=self._redraw,
            ).pack(side="left", padx=(0, 10))

        tk.Label(bar, text="│", bg=BG, fg=LINE).pack(side="left", padx=6)
        for text, value in [("黒塗り", BLACKOUT), ("モザイク", MOSAIC)]:
            tk.Radiobutton(
                bar, text=text, variable=self.mask_style, value=value,
                font=self.fonts.base, bg=BG, activebackground=BG,
            ).pack(side="left")

        tk.Button(bar, text="直前を取消", command=self._undo, font=self.fonts.base).pack(
            side="left", padx=(12, 4))
        tk.Button(bar, text="すべて消す", command=self._clear, font=self.fonts.base).pack(side="left")

        detail = tk.Frame(self, bg=BG, padx=8, pady=4)
        detail.pack(fill="x")
        tk.Label(detail, text="比較項目", bg=BG, fg=FG, font=self.fonts.base).pack(side="left")
        ttk.Combobox(
            detail, textvariable=self.comparison, values=comparison_options,
            width=14, font=self.fonts.base,
        ).pack(side="left", padx=(4, 12))
        tk.Label(detail, text="不備理由", bg=BG, fg=FG, font=self.fonts.base).pack(side="left")
        ttk.Combobox(
            detail, textvariable=self.defect_code, values=defect_options,
            width=12, state="readonly", font=self.fonts.base,
        ).pack(side="left", padx=(4, 12))
        tk.Label(detail, text="理由・気づいたこと", bg=BG, fg=FG, font=self.fonts.base).pack(side="left")
        tk.Entry(detail, textvariable=self.note, width=42, font=self.fonts.base).pack(
            side="left", padx=4)

        tk.Label(detail, text="マスキング", bg=BG, fg=FG, font=self.fonts.base).pack(
            side="left", padx=(12, 2))
        ttk.Combobox(
            detail, textvariable=self.mask_status, values=list(MASK_STATES),
            width=6, state="readonly", font=self.fonts.base,
        ).pack(side="left")
        tk.Button(
            detail, text="この比較を保存", command=self._save, font=self.fonts.heading
        ).pack(side="right")

        nav = tk.Frame(self, bg=BG)
        nav.pack(fill="x")
        self.nav_widgets = {}
        for side in (SIDE_LEFT, SIDE_RIGHT):
            holder = tk.Frame(nav, bg=BG, padx=8, pady=2)
            holder.pack(side="left", fill="x", expand=True)
            self.nav_widgets[side] = self._build_nav(holder, side)

        self.canvas = tk.Canvas(self, bg="#eceff1", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.canvas.bind("<ButtonPress-1>", self._on_press)
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_release)
        self.canvas.bind("<MouseWheel>", self._on_wheel)          # Windows
        self.canvas.bind("<Button-4>", lambda e: self._scroll(e, -120))
        self.canvas.bind("<Button-5>", lambda e: self._scroll(e, 120))

        tk.Label(
            self, bg=BG, fg=MUTED, font=self.fonts.small, anchor="w", padx=8,
            text="ドラッグで囲みます。左右それぞれを囲むと線で結ばれ、"
                 "「何と何を比べたか」が画像に残ります。ホイールでスクロール、Ctrl＋ホイールで拡大。",
        ).pack(fill="x", pady=(0, 4))

    def _build_nav(self, holder: tk.Frame, side: str) -> dict:
        pane = self.panes[side]
        top = tk.Frame(holder, bg=BG)
        top.pack(fill="x")
        title = tk.Label(top, text=pane.title, font=self.fonts.heading, bg=BG, fg=FG)
        title.pack(side="left")
        label = tk.Label(top, text="", font=self.fonts.small, bg=BG, fg=MUTED)
        label.pack(side="left", padx=8)

        controls = tk.Frame(holder, bg=BG)
        controls.pack(fill="x")
        tk.Button(controls, text="◀", width=3, command=lambda: self._step_page(side, -1)).pack(side="left")
        page = tk.Label(controls, text="- / -", font=self.fonts.base, bg=BG, fg=FG, width=8)
        page.pack(side="left")
        tk.Button(controls, text="▶", width=3, command=lambda: self._step_page(side, 1)).pack(side="left")
        tk.Button(controls, text="－", width=3, command=lambda: self._zoom(side, 1 / 1.25)).pack(side="left", padx=(10, 0))
        tk.Button(controls, text="＋", width=3, command=lambda: self._zoom(side, 1.25)).pack(side="left")
        tk.Button(controls, text="全体", command=lambda: self._fit(side)).pack(side="left", padx=4)
        tk.Button(controls, text="このページに印", command=lambda: self._bookmark(side)).pack(side="left", padx=4)

        marks = tk.Frame(holder, bg=BG)
        marks.pack(fill="x")
        return {"page": page, "label": label, "marks": marks}

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
        widgets["page"].config(text=f"{pane.page_index + 1} / {pane.page_count}" if pane.page_count else "- / -")
        widgets["label"].config(text=pane.doc_label or (pane.pdf_path.name if pane.pdf_path else ""))

        for child in widgets["marks"].winfo_children():
            child.destroy()
        if pane.bookmarks:
            tk.Label(widgets["marks"], text="印:", font=self.fonts.small, bg=BG, fg=MUTED).pack(side="left")
        for page_index in pane.bookmarks:
            tk.Button(
                widgets["marks"], text=f"p.{page_index + 1}", font=self.fonts.small,
                command=lambda s=side, p=page_index: self._goto(s, p),
            ).pack(side="left", padx=1)

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

    def _on_wheel(self, event: tk.Event) -> None:
        self._scroll(event, -event.delta)

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

    def _side_at(self, x: int) -> str | None:
        return SIDE_LEFT if x < self.canvas.winfo_width() // 2 else SIDE_RIGHT

    def _relayout(self) -> None:
        """窓の大きさが変わったとき.

        利用者が拡大・スクロールしていなければ収め直す。
        こうしないと、窓の寸法が決まる前に計算した倍率のまま固定されてしまう。
        """
        for side, pane in self.panes.items():
            if not pane.viewport:
                continue
            resized = pane.viewport.resized(*self._pane_rect(side))
            pane.viewport = resized if pane.user_adjusted else resized.fitted()
        self._redraw()

    def _redraw(self) -> None:
        self.canvas.delete("all")
        half = self.canvas.winfo_width() // 2
        self.canvas.create_line(half, 0, half, self.canvas.winfo_height(), fill=LINE)

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
                    box[0] + 3, box[1] - 10, text=region.label, anchor="w",
                    fill=REGION_COLOR, font=self.fonts.small,
                )
            anchors.setdefault(
                region.side,
                (box[2], (box[1] + box[3]) / 2) if region.side == SIDE_LEFT
                else (box[0], (box[1] + box[3]) / 2),
            )
        if SIDE_LEFT in anchors and SIDE_RIGHT in anchors:
            self.canvas.create_line(*anchors[SIDE_LEFT], *anchors[SIDE_RIGHT], fill=REGION_COLOR, width=2)

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
        pane = self.panes.get(side) if side else None
        if not pane or not pane.viewport:
            return
        self._drag_start = (event.x, event.y)
        self._drag_side = side

    def _on_drag(self, event: tk.Event) -> None:
        if not self._drag_start:
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
        self._drag_start = self._drag_side = None
        if self._temp_shape:
            self.canvas.delete(self._temp_shape)
            self._temp_shape = None
        if abs(event.x - start[0]) < MIN_DRAG or abs(event.y - start[1]) < MIN_DRAG:
            return  # 誤クリック

        pane = self.panes[side]
        box = pane.viewport.ratio_box(start, (event.x, event.y))
        if self.mode.get() == MODE_REGION:
            self.regions.append(MarkupRegion(side, pane.page_index, box, pane.doc_label))
        else:
            self.masks.append(MaskRegion(side, box, self.mask_style.get()))
        self._redraw()

    def _undo(self) -> None:
        target = self.regions if self.mode.get() == MODE_REGION else self.masks
        if target:
            target.pop()
            self._redraw()

    def _clear(self) -> None:
        self.regions.clear()
        self.masks.clear()
        self._redraw()

    # ---------- 保存 ----------

    def _save(self) -> None:
        if not self.regions:
            messagebox.showinfo("作業窓", "比較する箇所を囲んでください。")
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

    def current_images(self) -> tuple[Image.Image | None, Image.Image | None]:
        return self.panes[SIDE_LEFT].image, self.panes[SIDE_RIGHT].image

    def current_titles(self) -> tuple[str, str]:
        left, right = self.panes[SIDE_LEFT], self.panes[SIDE_RIGHT]
        return (
            f"{left.doc_label or left.title}  p.{left.page_index + 1}",
            f"{right.doc_label or right.title}  p.{right.page_index + 1}",
        )
