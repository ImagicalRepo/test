"""ツールA：資料作成支援ツール（作成者が閑散期に使用）.

3 つの作業を 1 本にまとめている。

  1. カタログ用画像   PDF → ページ選択 → マスキング → PNG 書き出し
  2. 論点抽出         チェックリスト検出 → 左側をクロップ → コンタクトシート
  3. 出力点検         DVD に焼く前の自主点検

スキャンデータは端末外に出さない。書き出しはマスク済み PNG のみ。
"""
from __future__ import annotations

import queue
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from PIL import ImageTk

from . import detect, extract, masking, pdfio
from .config import app_dir
from .ui import BG, FG, LINE, MUTED, Fonts

WINDOW_TITLE = "資料作成支援ツール"
THUMB_COLUMNS = 6
SELECTED_COLOR = "#1565c0"


class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.fonts = Fonts()
        self.title(WINDOW_TITLE)
        self.geometry("1240x820")
        self.configure(bg=BG)

        notebook = ttk.Notebook(self)
        notebook.pack(fill="both", expand=True, padx=8, pady=8)

        self.catalog_tab = CatalogTab(notebook, self.fonts)
        self.extract_tab = ExtractTab(notebook, self.fonts)
        self.audit_tab = AuditTab(notebook, self.fonts)

        notebook.add(self.catalog_tab, text="  ① カタログ用画像  ")
        notebook.add(self.extract_tab, text="  ② 論点抽出  ")
        notebook.add(self.audit_tab, text="  ③ 出力点検  ")


# --------------------------------------------------------------------------
# ① カタログ用画像
# --------------------------------------------------------------------------


class CatalogTab(tk.Frame):
    """PDF からページを選び、マスクして書き出す."""

    def __init__(self, parent: tk.Misc, fonts: Fonts) -> None:
        super().__init__(parent, bg=BG, padx=10, pady=10)
        self.fonts = fonts
        self.pdf_paths: list[Path] = []
        self.current_pdf: Path | None = None
        self.thumbs: list[ImageTk.PhotoImage] = []
        self.selected_pages: set[int] = set()
        self.thumb_frames: dict[int, tk.Frame] = {}
        self.out_dir = tk.StringVar(value=str(app_dir() / "出力" / "カタログ用"))
        self.prefix = tk.StringVar(value="img")

        self._build()

    def _build(self) -> None:
        bar = tk.Frame(self, bg=BG)
        bar.pack(fill="x")
        tk.Button(bar, text="PDF のフォルダを選ぶ", command=self._choose_folder,
                  font=self.fonts.base).pack(side="left")
        self.odd_only = tk.BooleanVar(value=True)
        tk.Checkbutton(bar, text="通し番号が奇数のもののみ（申請書一式）",
                       variable=self.odd_only, command=self._reload_pdfs,
                       font=self.fonts.base, bg=BG, activebackground=BG).pack(side="left", padx=12)
        self.folder_label = tk.Label(bar, text="（未選択）", font=self.fonts.small,
                                     bg=BG, fg=MUTED)
        self.folder_label.pack(side="left", padx=8)

        body = tk.Frame(self, bg=BG)
        body.pack(fill="both", expand=True, pady=8)

        left = tk.Frame(body, bg=BG)
        left.pack(side="left", fill="y")
        tk.Label(left, text="PDF 一覧", font=self.fonts.heading, bg=BG, fg=FG).pack(anchor="w")
        self.pdf_list = tk.Listbox(left, width=38, height=30, font=self.fonts.small,
                                   exportselection=False, highlightbackground=LINE)
        self.pdf_list.pack(fill="y", expand=True)
        self.pdf_list.bind("<<ListboxSelect>>", lambda _e: self._load_thumbnails())

        right = tk.Frame(body, bg=BG)
        right.pack(side="left", fill="both", expand=True, padx=(10, 0))
        tk.Label(right, text="ページを選ぶ（複数選ぶと 1 つの書類として続けて処理します）",
                 font=self.fonts.heading, bg=BG, fg=FG).pack(anchor="w")

        canvas_holder = tk.Frame(right, bg=BG)
        canvas_holder.pack(fill="both", expand=True)
        self.canvas = tk.Canvas(canvas_holder, bg="#fafafa", highlightthickness=1,
                                highlightbackground=LINE)
        scroll = tk.Scrollbar(canvas_holder, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.thumb_area = tk.Frame(self.canvas, bg="#fafafa")
        self.canvas.create_window((0, 0), window=self.thumb_area, anchor="nw")
        self.thumb_area.bind(
            "<Configure>",
            lambda _e: self.canvas.configure(scrollregion=self.canvas.bbox("all")),
        )

        footer = tk.Frame(self, bg=BG)
        footer.pack(fill="x")
        tk.Label(footer, text="書き出し先", font=self.fonts.base, bg=BG, fg=FG).pack(side="left")
        tk.Entry(footer, textvariable=self.out_dir, font=self.fonts.small, width=52).pack(
            side="left", padx=6)
        tk.Button(footer, text="…", command=self._choose_out_dir).pack(side="left")
        tk.Label(footer, text="  ファイル名の接頭辞", font=self.fonts.base, bg=BG, fg=FG).pack(
            side="left", padx=(12, 0))
        tk.Entry(footer, textvariable=self.prefix, font=self.fonts.small, width=10).pack(
            side="left", padx=6)
        tk.Button(footer, text="選んだページをマスク編集へ", command=self._open_editor,
                  font=self.fonts.heading).pack(side="right")

    def _choose_folder(self) -> None:
        folder = filedialog.askdirectory(title="申請書一式 PDF のあるフォルダ")
        if folder:
            self.folder = Path(folder)
            self.folder_label.config(text=str(self.folder))
            self._reload_pdfs()

    def _reload_pdfs(self) -> None:
        if not hasattr(self, "folder"):
            return
        self.pdf_paths = pdfio.find_pdfs(self.folder, odd_only=self.odd_only.get())
        self.pdf_list.delete(0, "end")
        for path in self.pdf_paths:
            self.pdf_list.insert("end", path.name)

    def _choose_out_dir(self) -> None:
        folder = filedialog.askdirectory(title="マスク済み画像の書き出し先")
        if folder:
            self.out_dir.set(folder)

    def _load_thumbnails(self) -> None:
        selection = self.pdf_list.curselection()
        if not selection:
            return
        self.current_pdf = self.pdf_paths[selection[0]]
        self.selected_pages.clear()
        for child in self.thumb_area.winfo_children():
            child.destroy()
        self.thumbs.clear()
        self.thumb_frames.clear()

        for page_index, img in pdfio.render_all(self.current_pdf, dpi=pdfio.DPI_THUMBNAIL):
            img.thumbnail((150, 210))
            photo = ImageTk.PhotoImage(img)
            self.thumbs.append(photo)

            cell = tk.Frame(self.thumb_area, bg="#fafafa", bd=3, relief="flat")
            cell.grid(row=page_index // THUMB_COLUMNS, column=page_index % THUMB_COLUMNS,
                      padx=6, pady=6)
            label = tk.Label(cell, image=photo, bd=1, relief="solid")
            label.pack()
            tk.Label(cell, text=f"p.{page_index + 1}", font=self.fonts.small,
                     bg="#fafafa", fg=MUTED).pack()
            for widget in (cell, label):
                widget.bind("<Button-1>", lambda _e, i=page_index: self._toggle_page(i))
            self.thumb_frames[page_index] = cell

    def _toggle_page(self, page_index: int) -> None:
        cell = self.thumb_frames[page_index]
        if page_index in self.selected_pages:
            self.selected_pages.discard(page_index)
            cell.config(bg="#fafafa", relief="flat")
        else:
            self.selected_pages.add(page_index)
            cell.config(bg=SELECTED_COLOR, relief="solid")

    def _open_editor(self) -> None:
        if not self.current_pdf or not self.selected_pages:
            messagebox.showinfo(WINDOW_TITLE, "ページを 1 つ以上選んでください。")
            return
        try:
            MaskEditor(
                self, self.fonts, self.current_pdf, sorted(self.selected_pages),
                Path(self.out_dir.get()), self.prefix.get(),
            )
        except ValueError as exc:
            messagebox.showerror(WINDOW_TITLE, str(exc))


class MaskEditor(tk.Toplevel):
    """1 ページずつマスクを描いて書き出す.

    マスクは画像に焼き込んで PNG 保存する。元 PDF には一切書き込まない。
    """

    def __init__(self, parent: tk.Misc, fonts: Fonts, pdf_path: Path,
                 page_indexes: list[int], out_dir: Path, prefix: str) -> None:
        super().__init__(parent)
        self.fonts = fonts
        self.pdf_path = pdf_path
        self.page_indexes = page_indexes
        self.out_dir = out_dir
        self.prefix = prefix
        self.position = 0
        self.rects: list[masking.MaskRect] = []
        self.drag_start: tuple[int, int] | None = None
        self.temp_shape: int | None = None
        self.style = tk.StringVar(value=masking.BLACKOUT)

        self.title(f"マスク編集 － {pdf_path.name}")
        self.geometry("1080x860")
        self.configure(bg=BG)
        self._build()
        self._show_page()

    def _build(self) -> None:
        bar = tk.Frame(self, bg=BG, padx=8, pady=8)
        bar.pack(fill="x")
        self.status = tk.Label(bar, text="", font=self.fonts.heading, bg=BG, fg=FG)
        self.status.pack(side="left")
        for text, value in [("黒塗り", masking.BLACKOUT), ("モザイク", masking.MOSAIC)]:
            tk.Radiobutton(bar, text=text, variable=self.style, value=value,
                           font=self.fonts.base, bg=BG, activebackground=BG).pack(
                side="left", padx=(12, 0))
        tk.Button(bar, text="直前を取り消す", command=self._undo,
                  font=self.fonts.base).pack(side="left", padx=12)
        tk.Button(bar, text="このページを書き出す", command=self._export,
                  font=self.fonts.heading).pack(side="right")

        self.canvas = tk.Canvas(self, bg="#eeeeee", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.canvas.bind("<ButtonPress-1>", self._on_press)
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_release)

        tk.Label(
            self, bg=BG, fg=MUTED, font=self.fonts.small, anchor="w", padx=8,
            text="ドラッグで個人情報を囲みます。書き出すと元の情報は画像から消えます"
                 "（原本の PDF は変更しません）。",
        ).pack(fill="x", pady=(0, 6))

    def _show_page(self) -> None:
        page_index = self.page_indexes[self.position]
        self.preview = pdfio.render_page(self.pdf_path, page_index, dpi=pdfio.DPI_PREVIEW)
        display = self.preview.copy()
        display.thumbnail((900, 700))
        self.scale = display.width / self.preview.width
        self.photo = ImageTk.PhotoImage(display)
        self.canvas.delete("all")
        self.canvas.create_image(20, 20, image=self.photo, anchor="nw")
        self.rects.clear()
        self.status.config(
            text=f"p.{page_index + 1}　（{self.position + 1} / {len(self.page_indexes)} ページ目）"
        )

    # ---- マスク矩形の描画 ----

    def _on_press(self, event: tk.Event) -> None:
        self.drag_start = (event.x, event.y)

    def _on_drag(self, event: tk.Event) -> None:
        if not self.drag_start:
            return
        if self.temp_shape:
            self.canvas.delete(self.temp_shape)
        self.temp_shape = self.canvas.create_rectangle(
            *self.drag_start, event.x, event.y, outline=SELECTED_COLOR, width=2
        )

    def _on_release(self, event: tk.Event) -> None:
        if not self.drag_start:
            return
        x0, y0 = self.drag_start
        x1, y1 = event.x, event.y
        self.drag_start = None
        if self.temp_shape:
            self.canvas.delete(self.temp_shape)
            self.temp_shape = None
        if abs(x1 - x0) < 4 or abs(y1 - y0) < 4:
            return  # 誤クリック

        width = self.photo.width()
        height = self.photo.height()
        rect = masking.MaskRect(
            left=(min(x0, x1) - 20) / width,
            top=(min(y0, y1) - 20) / height,
            right=(max(x0, x1) - 20) / width,
            bottom=(max(y0, y1) - 20) / height,
            style=self.style.get(),
        )
        self.rects.append(rect)
        fill = "#000000" if rect.style == masking.BLACKOUT else "#9e9e9e"
        self.canvas.create_rectangle(
            min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1),
            fill=fill, outline=fill, tags="mask",
        )

    def _undo(self) -> None:
        if not self.rects:
            return
        self.rects.pop()
        for shape in self.canvas.find_withtag("mask")[-1:]:
            self.canvas.delete(shape)

    def _export(self) -> None:
        if not self.rects:
            if not messagebox.askyesno(
                WINDOW_TITLE,
                "マスクが 1 つも指定されていません。\n"
                "このまま書き出すと個人情報がそのまま残ります。続けますか？",
            ):
                return
        page_index = self.page_indexes[self.position]
        # 書き出しは印刷品質で描き直す。マスクは比率で持っているのでそのまま使える。
        full = pdfio.render_page(self.pdf_path, page_index, dpi=pdfio.DPI_EXPORT)
        try:
            path = masking.export_masked(
                full, self.rects, self.out_dir, self.prefix,
                note=f"{self.pdf_path.name} p.{page_index + 1}",
            )
        except (ValueError, OSError) as exc:
            messagebox.showerror(WINDOW_TITLE, f"書き出せませんでした。\n\n{exc}")
            return

        self.position += 1
        if self.position >= len(self.page_indexes):
            messagebox.showinfo(WINDOW_TITLE, f"書き出しました。\n\n最後のファイル: {path.name}")
            self.destroy()
        else:
            self._show_page()


# --------------------------------------------------------------------------
# ② 論点抽出
# --------------------------------------------------------------------------


class ExtractTab(tk.Frame):
    """チェックリストを検出し、左側を切り出してコンタクトシートにまとめる."""

    def __init__(self, parent: tk.Misc, fonts: Fonts) -> None:
        super().__init__(parent, bg=BG, padx=10, pady=10)
        self.fonts = fonts
        self.template: list[float] | None = None
        self.queue: queue.Queue = queue.Queue()
        self.cancelled = False

        self.sample_pdf = tk.StringVar()
        self.sample_page = tk.StringVar(value="1")
        self.target_folder = tk.StringVar()
        self.out_dir = tk.StringVar(value=str(app_dir() / "出力" / "論点シート"))
        self.threshold = tk.StringVar(value=str(detect.DEFAULT_THRESHOLD))
        self.template_path = app_dir() / "data" / "チェックリスト見本.json"

        self._build()
        self._try_load_template()

    def _build(self) -> None:
        step1 = self._section("手順1　チェックリストの見本を登録する")
        tk.Button(step1, text="見本の PDF を選ぶ", command=self._choose_sample,
                  font=self.fonts.base).grid(row=0, column=0, sticky="w")
        tk.Label(step1, textvariable=self.sample_pdf, font=self.fonts.small, bg=BG,
                 fg=MUTED, anchor="w").grid(row=0, column=1, sticky="w", padx=8)
        tk.Label(step1, text="チェックリストのページ番号", font=self.fonts.base,
                 bg=BG, fg=FG).grid(row=1, column=0, sticky="w", pady=4)
        tk.Entry(step1, textvariable=self.sample_page, width=6,
                 font=self.fonts.base).grid(row=1, column=1, sticky="w", padx=8)
        tk.Button(step1, text="見本として登録", command=self._make_template,
                  font=self.fonts.base).grid(row=2, column=0, sticky="w", pady=4)
        self.template_status = tk.Label(step1, text="", font=self.fonts.small, bg=BG, fg=MUTED)
        self.template_status.grid(row=2, column=1, sticky="w", padx=8)

        step2 = self._section("手順2　類似度を確かめて、しきい値を決める")
        tk.Button(step2, text="見本 PDF のページ別スコアを見る", command=self._show_scores,
                  font=self.fonts.base).grid(row=0, column=0, sticky="w")
        tk.Label(step2, text="しきい値（1.00 が完全一致）", font=self.fonts.base,
                 bg=BG, fg=FG).grid(row=1, column=0, sticky="w", pady=4)
        tk.Entry(step2, textvariable=self.threshold, width=6,
                 font=self.fonts.base).grid(row=1, column=1, sticky="w", padx=8)

        step3 = self._section("手順3　まとめて抽出する")
        tk.Button(step3, text="対象フォルダを選ぶ", command=self._choose_target,
                  font=self.fonts.base).grid(row=0, column=0, sticky="w")
        tk.Label(step3, textvariable=self.target_folder, font=self.fonts.small, bg=BG,
                 fg=MUTED).grid(row=0, column=1, sticky="w", padx=8)
        tk.Label(step3, text="書き出し先", font=self.fonts.base, bg=BG,
                 fg=FG).grid(row=1, column=0, sticky="w", pady=4)
        tk.Entry(step3, textvariable=self.out_dir, width=60,
                 font=self.fonts.small).grid(row=1, column=1, sticky="w", padx=8)
        self.run_button = tk.Button(step3, text="抽出を実行", command=self._run,
                                    font=self.fonts.heading)
        self.run_button.grid(row=2, column=0, sticky="w", pady=6)
        tk.Button(step3, text="中止", command=self._cancel,
                  font=self.fonts.base).grid(row=2, column=1, sticky="w", padx=8)

        self.progress = ttk.Progressbar(self, mode="determinate")
        self.progress.pack(fill="x", pady=(10, 4))
        self.log = tk.Text(self, height=12, font=self.fonts.small, bg="#fafafa",
                           relief="solid", bd=1)
        self.log.pack(fill="both", expand=True)

    def _section(self, title: str) -> tk.Frame:
        tk.Label(self, text=title, font=self.fonts.heading, bg=BG, fg=FG,
                 anchor="w").pack(fill="x", pady=(8, 2))
        frame = tk.Frame(self, bg=BG)
        frame.pack(fill="x", padx=12)
        return frame

    def _write(self, text: str) -> None:
        self.log.insert("end", text + "\n")
        self.log.see("end")

    def _try_load_template(self) -> None:
        if self.template_path.exists():
            try:
                self.template = detect.load_template(self.template_path)
                self.template_status.config(text="登録済みの見本を読み込みました。")
            except (ValueError, OSError) as exc:
                self.template_status.config(text=f"見本を読み込めません: {exc}")

    def _choose_sample(self) -> None:
        path = filedialog.askopenfilename(title="見本にする PDF",
                                          filetypes=[("PDF", "*.pdf")])
        if path:
            self.sample_pdf.set(path)

    def _choose_target(self) -> None:
        folder = filedialog.askdirectory(title="申請書一式 PDF のあるフォルダ")
        if folder:
            self.target_folder.set(folder)

    def _make_template(self) -> None:
        try:
            page = int(self.sample_page.get()) - 1
            sig = extract.make_template(Path(self.sample_pdf.get()), page)
        except (ValueError, IndexError, OSError) as exc:
            messagebox.showerror(WINDOW_TITLE, f"見本を作れませんでした。\n\n{exc}")
            return
        detect.save_template(sig, self.template_path,
                             note=f"{Path(self.sample_pdf.get()).name} p.{page + 1}")
        self.template = sig
        self.template_status.config(text=f"登録しました: {self.template_path.name}")
        self._write("見本を登録しました。")

    def _show_scores(self) -> None:
        if not self.template:
            messagebox.showinfo(WINDOW_TITLE, "先に見本を登録してください。")
            return
        try:
            hits = extract.rank_pdf_pages(Path(self.sample_pdf.get()), self.template)
        except OSError as exc:
            messagebox.showerror(WINDOW_TITLE, str(exc))
            return
        self._write("--- ページ別スコア（高い順）---")
        for hit in hits[:10]:
            self._write(f"  p.{hit.page_index + 1}: {hit.score:.3f}")
        self._write("チェックリストのページと、それ以外との差が開く値をしきい値にしてください。")

    def _run(self) -> None:
        if not self.template:
            messagebox.showinfo(WINDOW_TITLE, "先に見本を登録してください。")
            return
        if not self.target_folder.get():
            messagebox.showinfo(WINDOW_TITLE, "対象フォルダを選んでください。")
            return
        try:
            threshold = float(self.threshold.get())
        except ValueError:
            messagebox.showerror(WINDOW_TITLE, "しきい値は数字で入れてください。")
            return

        pdfs = pdfio.find_pdfs(Path(self.target_folder.get()), odd_only=True)
        if not pdfs:
            messagebox.showinfo(WINDOW_TITLE, "対象の PDF が見つかりません。")
            return

        self.cancelled = False
        self.run_button.config(state="disabled")
        self.progress.config(maximum=len(pdfs), value=0)
        self._write(f"--- 抽出開始（{len(pdfs)} 件）---")

        thread = threading.Thread(
            target=self._worker, args=(pdfs, threshold), daemon=True
        )
        thread.start()
        self.after(100, self._poll)

    def _worker(self, pdfs: list[Path], threshold: float) -> None:
        def progress(current: int, total: int, name: str) -> bool:
            self.queue.put(("progress", current, name))
            return not self.cancelled

        try:
            result = extract.extract(
                pdfs, self.template, Path(self.out_dir.get()),
                extract.load_region(app_dir() / "data"),
                threshold=threshold, progress=progress,
            )
            self.queue.put(("done", result, ""))
        except Exception as exc:  # noqa: BLE001 - 画面に理由を出す
            self.queue.put(("error", exc, ""))

    def _poll(self) -> None:
        try:
            while True:
                kind, payload, name = self.queue.get_nowait()
                if kind == "progress":
                    self.progress.config(value=payload)
                    if payload % 25 == 0 or payload == 1:
                        self._write(f"  {payload} 件目: {name}")
                elif kind == "done":
                    self.run_button.config(state="normal")
                    self._write("--- 完了 ---")
                    self._write(payload.summary())
                    for line in payload.skipped[:10]:
                        self._write(f"  読み飛ばし: {line}")
                    return
                elif kind == "error":
                    self.run_button.config(state="normal")
                    self._write(f"エラー: {payload}")
                    messagebox.showerror(WINDOW_TITLE, str(payload))
                    return
        except queue.Empty:
            pass
        self.after(100, self._poll)

    def _cancel(self) -> None:
        self.cancelled = True
        self._write("中止を要求しました。処理中の 1 件が終わったら止まります。")


# --------------------------------------------------------------------------
# ③ 出力点検
# --------------------------------------------------------------------------


class AuditTab(tk.Frame):
    """DVD に焼く前の自主点検.

    ここで問題なしと出ることは最低条件であり、十分条件ではない。
    最後は必ず人が目視で塗り残しを確認すること。
    """

    def __init__(self, parent: tk.Misc, fonts: Fonts) -> None:
        super().__init__(parent, bg=BG, padx=10, pady=10)
        self.fonts = fonts
        self.target = tk.StringVar(value=str(app_dir() / "出力" / "カタログ用"))
        self._build()

    def _build(self) -> None:
        bar = tk.Frame(self, bg=BG)
        bar.pack(fill="x")
        tk.Label(bar, text="点検するフォルダ", font=self.fonts.base, bg=BG, fg=FG).pack(side="left")
        tk.Entry(bar, textvariable=self.target, width=60, font=self.fonts.small).pack(
            side="left", padx=6)
        tk.Button(bar, text="…", command=self._choose).pack(side="left")
        tk.Button(bar, text="点検する", command=self._audit,
                  font=self.fonts.heading).pack(side="left", padx=12)

        tk.Label(
            self, bg=BG, fg=MUTED, font=self.fonts.small, anchor="w", justify="left",
            text="このチェックは「ファイル名に個人情報が入っていないか」「マスクが指定されて"
                 "いるか」を機械的に見るだけです。\n"
                 "塗り残しは検出できません。DVD に焼く前に、必ず全ての画像を目視で確認して"
                 "ください。DVD は後から消せません。",
        ).pack(fill="x", pady=8)

        self.result = tk.Text(self, height=22, font=self.fonts.base, bg="#fafafa",
                              relief="solid", bd=1)
        self.result.pack(fill="both", expand=True)

    def _choose(self) -> None:
        folder = filedialog.askdirectory(title="点検するフォルダ")
        if folder:
            self.target.set(folder)

    def _audit(self) -> None:
        warnings = masking.audit_output_dir(Path(self.target.get()))
        self.result.delete("1.0", "end")
        if not warnings:
            self.result.insert("end", "機械的な点検では問題は見つかりませんでした。\n\n")
            self.result.insert("end", "次に、全ての画像を開いて塗り残しがないか目視で確認してください。\n")
            return
        self.result.insert("end", f"{len(warnings)} 件の問題が見つかりました。\n\n")
        for warning in warnings:
            self.result.insert("end", f"・{warning}\n")


def main() -> int:
    App().mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
