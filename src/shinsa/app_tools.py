"""見直しツールの付随機能.

本体の作業（1 件ずつ見る）から外れる 3 つをここにまとめる。

  事前バッチ    … メモ欄の書き込みを見て、確認する順序を決める
  マスキング待ち … 「未」を残したまま持ち出さないための一覧
  出力点検      … 持ち出す前の自主点検
"""
from __future__ import annotations

import queue
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from . import detect, masking, prescan
from .config import MASK_DONE, MASK_NOT_NEEDED, MASK_TODO, app_dir
from .store import Store
from .ui import BG, FG, MUTED, Fonts


class PrescanDialog(tk.Toplevel):
    """事前バッチ：メモ欄の書き込みで優先順位を付ける."""

    def __init__(self, parent: tk.Misc, fonts: Fonts, store: Store) -> None:
        super().__init__(parent)
        self.fonts = fonts
        self.store = store
        self.queue: queue.Queue = queue.Queue()
        self.cancelled = False
        self.template: list[float] | None = None
        self.template_path = app_dir() / "data" / "チェックリスト見本.json"

        self.sample_pdf = tk.StringVar()
        self.sample_page = tk.StringVar(value="1")
        self.ink_threshold = tk.StringVar(value=str(prescan.DEFAULT_INK_THRESHOLD))

        self.title("事前バッチ　－　確認する順序を決める")
        self.geometry("820x620")
        self.configure(bg=BG)
        self._build()
        self._load_template()

    def _build(self) -> None:
        tk.Label(
            self, bg=BG, fg=MUTED, font=self.fonts.small, anchor="w", justify="left", padx=10,
            text="全 1 万件を見るとしても、順序は選べます。\n"
                 "チェックリストのメモ欄に書き込みがある案件を先に回すと、論点が早く見えます。\n"
                 "（文字を読むのではなく、黒い画素の割合を測っているだけです）",
        ).pack(fill="x", pady=8)

        step1 = self._section("手順1　チェックリストの見本を登録する")
        tk.Button(step1, text="見本の PDF を選ぶ", command=self._choose_sample,
                  font=self.fonts.base).grid(row=0, column=0, sticky="w")
        tk.Label(step1, textvariable=self.sample_pdf, font=self.fonts.small, bg=BG,
                 fg=MUTED).grid(row=0, column=1, sticky="w", padx=8)
        tk.Label(step1, text="チェックリストのページ番号", font=self.fonts.base,
                 bg=BG, fg=FG).grid(row=1, column=0, sticky="w", pady=4)
        tk.Entry(step1, textvariable=self.sample_page, width=6,
                 font=self.fonts.base).grid(row=1, column=1, sticky="w", padx=8)
        tk.Button(step1, text="見本として登録", command=self._make_template,
                  font=self.fonts.base).grid(row=2, column=0, sticky="w", pady=4)
        self.template_status = tk.Label(step1, text="", font=self.fonts.small, bg=BG, fg=MUTED)
        self.template_status.grid(row=2, column=1, sticky="w", padx=8)

        step2 = self._section("手順2　実行する")
        tk.Label(step2, text="書き込みありとみなす黒画素率", font=self.fonts.base,
                 bg=BG, fg=FG).grid(row=0, column=0, sticky="w")
        tk.Entry(step2, textvariable=self.ink_threshold, width=8,
                 font=self.fonts.base).grid(row=0, column=1, sticky="w", padx=8)
        self.run_button = tk.Button(step2, text="実行", command=self._run, font=self.fonts.heading)
        self.run_button.grid(row=1, column=0, sticky="w", pady=6)
        tk.Button(step2, text="中止", command=self._cancel,
                  font=self.fonts.base).grid(row=1, column=1, sticky="w")

        self.progress = ttk.Progressbar(self, mode="determinate")
        self.progress.pack(fill="x", padx=10, pady=(8, 4))
        self.log = tk.Text(self, height=14, font=self.fonts.small, bg="#fafafa",
                           relief="solid", bd=1)
        self.log.pack(fill="both", expand=True, padx=10, pady=(0, 10))

    def _section(self, title: str) -> tk.Frame:
        tk.Label(self, text=title, font=self.fonts.heading, bg=BG, fg=FG,
                 anchor="w", padx=10).pack(fill="x", pady=(8, 2))
        frame = tk.Frame(self, bg=BG, padx=22)
        frame.pack(fill="x")
        return frame

    def _write(self, text: str) -> None:
        self.log.insert("end", text + "\n")
        self.log.see("end")

    def _load_template(self) -> None:
        if self.template_path.exists():
            try:
                self.template = detect.load_template(self.template_path)
                self.template_status.config(text="登録済みの見本を読み込みました。")
            except (ValueError, OSError) as exc:
                self.template_status.config(text=f"見本を読み込めません: {exc}")

    def _choose_sample(self) -> None:
        path = filedialog.askopenfilename(title="見本にする PDF", filetypes=[("PDF", "*.pdf")])
        if path:
            self.sample_pdf.set(path)

    def _make_template(self) -> None:
        try:
            page = int(self.sample_page.get()) - 1
            signature = prescan.make_template(Path(self.sample_pdf.get()), page)
        except (ValueError, IndexError, OSError) as exc:
            messagebox.showerror("事前バッチ", f"見本を作れませんでした。\n\n{exc}", parent=self)
            return
        detect.save_template(signature, self.template_path,
                             note=f"{Path(self.sample_pdf.get()).name} p.{page + 1}")
        self.template = signature
        self.template_status.config(text="登録しました。")
        self._write("見本を登録しました。")

    def _run(self) -> None:
        if not self.template:
            messagebox.showinfo("事前バッチ", "先に見本を登録してください。", parent=self)
            return
        try:
            threshold = float(self.ink_threshold.get())
        except ValueError:
            messagebox.showerror("事前バッチ", "黒画素率は数字で入れてください。", parent=self)
            return

        total = len(self.store.list_cases())
        if not total:
            messagebox.showinfo("事前バッチ", "作業リストが空です。", parent=self)
            return

        self.cancelled = False
        self.run_button.config(state="disabled")
        self.progress.config(maximum=total, value=0)
        self._write(f"--- 開始（{total} 件）---")
        threading.Thread(target=self._worker, args=(threshold,), daemon=True).start()
        self.after(100, self._poll)

    def _worker(self, threshold: float) -> None:
        def progress(current: int, total: int, recipient_no: str) -> bool:
            self.queue.put(("progress", current, recipient_no))
            return not self.cancelled

        try:
            results = prescan.run(
                self.store, self.template, ink_threshold=threshold, progress=progress
            )
            self.queue.put(("done", results, ""))
        except Exception as exc:  # noqa: BLE001
            self.queue.put(("error", exc, ""))

    def _poll(self) -> None:
        try:
            while True:
                kind, payload, name = self.queue.get_nowait()
                if kind == "progress":
                    self.progress.config(value=payload)
                    if payload % 50 == 0 or payload == 1:
                        self._write(f"  {payload} 件目: {name}")
                elif kind == "done":
                    self.run_button.config(state="normal")
                    found = [r for r in payload if r.found]
                    high = [r for r in payload if (r.memo_ink or 0) >= float(self.ink_threshold.get())]
                    self._write("--- 完了 ---")
                    self._write(f"チェックリストを検出: {len(found)} / {len(payload)} 件")
                    self._write(f"書き込みあり（先に確認）: {len(high)} 件")
                    if len(found) < len(payload):
                        self._write(
                            "※ 検出できなかった案件は順序が付きません。"
                            "見本のページが正しいか確認してください。"
                        )
                    self._write("\n黒画素率の分布（しきい値を決める目安）")
                    for low, high_edge, count in prescan.distribution(payload):
                        if count:
                            self._write(f"  {low:.4f}〜{high_edge:.4f}: {count} 件")
                    self._write("2 つの山に分かれていれば、その谷をしきい値にしてください。")
                    return
                elif kind == "error":
                    self.run_button.config(state="normal")
                    self._write(f"エラー: {payload}")
                    return
        except queue.Empty:
            pass
        self.after(100, self._poll)

    def _cancel(self) -> None:
        self.cancelled = True
        self._write("中止を要求しました。")


class MaskQueueDialog(tk.Toplevel):
    """マスキング待ちの一覧.

    「未」が残ったまま持ち出さないための歯止め。
    """

    def __init__(self, parent: tk.Misc, fonts: Fonts, store: Store) -> None:
        super().__init__(parent)
        self.fonts = fonts
        self.store = store
        self.rows: list = []

        self.title("マスキング待ち")
        self.geometry("980x560")
        self.configure(bg=BG)
        self._build()
        self._refresh()

    def _build(self) -> None:
        bar = tk.Frame(self, bg=BG, padx=10, pady=8)
        bar.pack(fill="x")
        self.summary = tk.Label(bar, text="", font=self.fonts.heading, bg=BG, fg=FG)
        self.summary.pack(side="left")
        tk.Button(bar, text="更新", command=self._refresh, font=self.fonts.base).pack(side="right")
        tk.Button(bar, text="選んだものを「済」にする", command=self._mark_done,
                  font=self.fonts.base).pack(side="right", padx=8)

        tk.Label(
            self, bg=BG, fg=MUTED, font=self.fonts.small, anchor="w", justify="left", padx=10,
            text="マスキングが必要なのは、端末の外へ持ち出す画像だけです。"
                 "端末内に置くだけなら「不要」のままで構いません。\n"
                 "「未」を「済」にする前に、実際にマスキングを済ませてください"
                 "（画像を開いて塗り残しがないか目視で確認）。",
        ).pack(fill="x", pady=(0, 6))

        columns = ("受給者番号", "設問", "状態", "ファイル")
        self.tree = ttk.Treeview(self, columns=columns, show="headings", selectmode="extended")
        for column, width in zip(columns, (110, 80, 60, 620)):
            self.tree.heading(column, text=column)
            self.tree.column(column, width=width, anchor="w")
        self.tree.pack(fill="both", expand=True, padx=10, pady=(0, 10))

    def _refresh(self) -> None:
        self.tree.delete(*self.tree.get_children())
        self.rows = self.store.list_markups()
        todo = 0
        for row in self.rows:
            if row["mask_status"] == MASK_NOT_NEEDED:
                continue
            todo += row["mask_status"] == MASK_TODO
            self.tree.insert(
                "", "end", iid=str(row["id"]),
                values=(row["recipient_no"], row["item_id"], row["mask_status"], row["image_path"]),
            )
        self.summary.config(
            text=f"マスキング未　{todo} 件" + ("　← 持ち出せません" if todo else ""),
            fg="#b71c1c" if todo else FG,
        )

    def _mark_done(self) -> None:
        selected = self.tree.selection()
        if not selected:
            return
        if not messagebox.askyesno(
            "マスキング待ち",
            f"{len(selected)} 件を「済」にします。\n\n"
            "実際にマスキングを済ませ、画像を開いて塗り残しがないことを確認しましたか？",
            parent=self,
        ):
            return
        for item in selected:
            self.store.set_mask_status(int(item), MASK_DONE)
        self._refresh()


class AuditDialog(tk.Toplevel):
    """持ち出す前の自主点検."""

    def __init__(self, parent: tk.Misc, fonts: Fonts, store: Store) -> None:
        super().__init__(parent)
        self.fonts = fonts
        self.store = store
        self.target = tk.StringVar(value=str(app_dir() / "出力" / "マークアップ"))

        self.title("出力点検　－　持ち出す前に")
        self.geometry("900x600")
        self.configure(bg=BG)
        self._build()

    def _build(self) -> None:
        bar = tk.Frame(self, bg=BG, padx=10, pady=8)
        bar.pack(fill="x")
        tk.Label(bar, text="点検するフォルダ", font=self.fonts.base, bg=BG, fg=FG).pack(side="left")
        tk.Entry(bar, textvariable=self.target, width=58, font=self.fonts.small).pack(
            side="left", padx=6)
        tk.Button(bar, text="…", command=self._choose).pack(side="left")
        tk.Button(bar, text="点検する", command=self._audit,
                  font=self.fonts.heading).pack(side="left", padx=12)

        tk.Label(
            self, bg=BG, fg=MUTED, font=self.fonts.small, anchor="w", justify="left", padx=10,
            text="この点検が見るのは「ファイル名に個人情報が入っていないか」"
                 "「マスクが指定されているか」だけです。\n"
                 "塗り残しは検出できません。持ち出す前に、必ず全ての画像を目視で確認してください。",
        ).pack(fill="x", pady=(0, 6))

        self.result = tk.Text(self, height=24, font=self.fonts.base, bg="#fafafa",
                              relief="solid", bd=1)
        self.result.pack(fill="both", expand=True, padx=10, pady=(0, 10))

    def _choose(self) -> None:
        folder = filedialog.askdirectory(title="点検するフォルダ")
        if folder:
            self.target.set(folder)

    def _audit(self) -> None:
        self.result.delete("1.0", "end")
        root = Path(self.target.get())
        todo = self.store.count_mask_todo()
        if todo:
            self.result.insert(
                "end",
                f"■ マスキング「未」が {todo} 件あります。持ち出してはいけません。\n"
                "　 「マスキング待ち」から確認してください。\n\n",
            )

        # 受給者番号ごとのフォルダに分かれているため、下位も含めて点検する
        folders = [root] + sorted(f for f in root.glob("*") if f.is_dir()) if root.exists() else []
        if not folders:
            self.result.insert("end", f"フォルダがありません: {root}\n")
            return

        total = 0
        for folder in folders:
            warnings = masking.audit_output_dir(folder)
            images = list(folder.glob("*.png"))
            if not images and warnings == [f"出力フォルダが存在しません: {folder}"]:
                continue
            if not images and not warnings:
                continue
            self.result.insert("end", f"【{folder.name or folder}】 画像 {len(images)} 枚\n")
            for warning in warnings:
                if warning.startswith("PNG が 1 枚も"):
                    continue
                total += 1
                self.result.insert("end", f"　・{warning}\n")
            self.result.insert("end", "\n")

        if total == 0 and not todo:
            self.result.insert(
                "end",
                "機械的な点検では問題は見つかりませんでした。\n\n"
                "次に、全ての画像を開いて塗り残しがないか目視で確認してください。\n",
            )
        else:
            self.result.insert("end", f"■ 指摘 {total} 件\n")
