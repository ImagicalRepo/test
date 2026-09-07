"""チェックリスト窓：見直し作業の中心.

作業リストから 1 件ずつ開き、届いた書類を選び、チェックリストを埋める。
NG や迷いがあれば作業窓でマークアップして記録する。

速度の要は 3 つ。
  ・「すべて OK」ボタン（大半の案件は 1 クリックで終わる）
  ・前提が NG の設問を自動で「判定不能」にして入力を飛ばす
  ・次の申請を裏で先読みしておく
"""
from __future__ import annotations

import sys
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk

from .app_canvas import CanvasWindow
from .app_tools import AuditDialog, MaskQueueDialog, PrescanDialog
from .caselist import build_cases, scan_folder
from .config import (
    CASE_CONSULT, CASE_DONE, CHECK_ASK, CHECK_NG, CHECK_OK,
    MASK_TODO, app_dir, data_dir,
)
from .markup import SIDE_LEFT, SIDE_RIGHT, export_comparison
from .prefetch import Prefetcher
from .rules import RuleSet
from .session import ReviewSession
from .store import Store
from .ui import BG, FG, LINE, MUTED, Fonts, heading, separator

WINDOW_TITLE = "審査データ見直しツール"


class App(tk.Tk):
    def __init__(self, rules: RuleSet, store: Store) -> None:
        super().__init__()
        self.rules = rules
        self.store = store
        self.fonts = Fonts()
        self.prefetcher = Prefetcher()
        self.canvas_window: CanvasWindow | None = None

        # 判断は ReviewSession が持つ。画面はその状態を映すだけにして、
        # 同じロジックを二重に持たないようにする（session.py は画面なしで検証済み）。
        self.session: ReviewSession | None = None
        self.doc_vars: dict[str, tk.BooleanVar] = {}
        self.check_vars: dict[str, tk.StringVar] = {}
        self.defect_vars: dict[str, tk.StringVar] = {}
        self.row_widgets: dict[str, dict] = {}

        self.title(WINDOW_TITLE)
        self.geometry("1320x900")
        self.configure(bg=BG)
        self._build_menu()
        self._build()
        self._refresh_list()
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    @property
    def current(self) -> str | None:
        return self.session.recipient_no if self.session else None

    # ---------- 画面 ----------

    def _build_menu(self) -> None:
        menubar = tk.Menu(self)
        tools = tk.Menu(menubar, tearoff=0)
        tools.add_command(
            label="事前バッチ（確認する順序を決める）",
            command=lambda: PrescanDialog(self, self.fonts, self.store),
        )
        tools.add_separator()
        tools.add_command(
            label="マスキング待ち",
            command=lambda: MaskQueueDialog(self, self.fonts, self.store),
        )
        tools.add_command(
            label="出力点検（持ち出す前に）",
            command=lambda: AuditDialog(self, self.fonts, self.store),
        )
        menubar.add_cascade(label="ツール", menu=tools)
        self.config(menu=menubar)

    def _build(self) -> None:
        left = tk.Frame(self, bg=BG, padx=10, pady=10)
        left.pack(side="left", fill="y")

        tk.Button(left, text="フォルダを取り込む", command=self._import_folder,
                  font=self.fonts.base).pack(fill="x")
        self.progress_label = tk.Label(left, text="", font=self.fonts.small, bg=BG, fg=MUTED,
                                       justify="left", anchor="w")
        self.progress_label.pack(fill="x", pady=(6, 4))

        self.case_list = tk.Listbox(left, width=32, height=30, font=self.fonts.small,
                                    exportselection=False, activestyle="none",
                                    highlightthickness=1, highlightbackground=LINE)
        self.case_list.pack(fill="y", expand=True)
        self.case_list.bind("<<ListboxSelect>>", lambda _e: self._open_selected())

        self.mask_label = tk.Label(left, text="", font=self.fonts.base, bg=BG, anchor="w")
        self.mask_label.pack(fill="x", pady=(6, 0))

        right = tk.Frame(self, bg=BG, padx=14, pady=10)
        right.pack(side="left", fill="both", expand=True)

        header = tk.Frame(right, bg=BG)
        header.pack(fill="x")
        self.case_label = tk.Label(header, text="（案件を選んでください）", font=self.fonts.heading,
                                   bg=BG, fg=FG, anchor="w")
        self.case_label.pack(side="left")
        self.swap_button = tk.Button(header, text="本体を入れ替える", command=self._swap_primary,
                                     font=self.fonts.small, state="disabled")
        self.swap_button.pack(side="right")

        heading(right, "① 何が届いているか（複数選べます）", self.fonts).pack(fill="x", pady=(10, 4))
        self.doc_area = tk.Frame(right, bg=BG)
        self.doc_area.pack(fill="x")

        separator(right).pack(fill="x", pady=8)

        check_header = tk.Frame(right, bg=BG)
        check_header.pack(fill="x")
        heading(check_header, "② チェックリスト", self.fonts).pack(side="left")
        tk.Button(check_header, text="すべて OK", command=self._all_ok,
                  font=self.fonts.heading).pack(side="right")

        holder = tk.Frame(right, bg=BG)
        holder.pack(fill="both", expand=True, pady=(4, 0))
        self.check_canvas = tk.Canvas(holder, bg=BG, highlightthickness=0)
        scroll = tk.Scrollbar(holder, orient="vertical", command=self.check_canvas.yview)
        self.check_canvas.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.check_canvas.pack(side="left", fill="both", expand=True)
        self.check_area = tk.Frame(self.check_canvas, bg=BG)
        self.check_canvas.create_window((0, 0), window=self.check_area, anchor="nw")
        self.check_area.bind(
            "<Configure>",
            lambda _e: self.check_canvas.configure(scrollregion=self.check_canvas.bbox("all")),
        )

        footer = tk.Frame(right, bg=BG, pady=8)
        footer.pack(fill="x")
        tk.Button(footer, text="作業窓を開く", command=self._open_canvas,
                  font=self.fonts.base).pack(side="left")
        tk.Button(footer, text="相談へ送る", command=self._send_consultation,
                  font=self.fonts.base).pack(side="left", padx=8)
        tk.Button(footer, text="完了して次へ", command=self._complete,
                  font=self.fonts.heading).pack(side="right")

    # ---------- 作業リスト ----------

    def _import_folder(self) -> None:
        folder = filedialog.askdirectory(title="スキャンデータのフォルダ（サブフォルダも探します）")
        if not folder:
            return
        parsed, unparsed = scan_folder(Path(folder))
        cases = build_cases(parsed)
        added, updated = self.store.sync_cases(cases)
        message = f"{added} 件を追加、{updated} 件を更新しました。"
        if unparsed:
            message += (
                f"\n\nファイル名の規則に合わないものが {len(unparsed)} 件あります。"
                "作業リストには入りません。\n例: " + "\n".join(p.name for p in unparsed[:5])
            )
        messagebox.showinfo(WINDOW_TITLE, message)
        self._refresh_list()

    def _refresh_list(self) -> None:
        self.cases = self.store.list_cases()
        self.case_list.delete(0, "end")
        for case in self.cases:
            mark = {CASE_DONE: "✓", CASE_CONSULT: "△"}.get(case.status, "　")
            flag = "●" if case.priority > 0 else "　"
            self.case_list.insert("end", f"{mark}{flag} {case.recipient_no}  {case.received_on}")

        counts = self.store.progress()
        self.progress_label.config(
            text=f"全 {counts['合計']} 件　完了 {counts[CASE_DONE]}　"
                 f"作業中 {counts['作業中']}　相談中 {counts[CASE_CONSULT]}\n"
                 "●＝メモ欄に書き込みあり（先に確認）"
        )
        self._refresh_mask_label()

    def _refresh_mask_label(self) -> None:
        todo = self.store.count_mask_todo()
        color = "#b71c1c" if todo else MUTED
        text = (
            f"マスキング未　{todo} 件　← 持ち出せません" if todo else "マスキング未　0 件"
        )
        self.mask_label.config(text=text, fg=color)

    def _open_selected(self) -> None:
        selection = self.case_list.curselection()
        if not selection:
            return
        self._load_case(self.cases[selection[0]].recipient_no)

    # ---------- 1 件を開く ----------

    def _load_case(self, recipient_no: str) -> None:
        case = self.store.get_case(recipient_no)
        if case is None:
            return
        self.session = ReviewSession.open(self.rules, self.store, recipient_no)

        extra = f"　追加書類 {len(case.additional)} 件" if case.additional else ""
        self.case_label.config(text=f"受給者番号 {recipient_no}　受付 {case.received_on}{extra}")
        self.swap_button.config(state="normal" if case.additional else "disabled")

        self._build_doc_checks(self.session.documents)
        self._build_check_rows()
        self._render_rows()

        if self.canvas_window and self.canvas_window.winfo_exists():
            self._load_into_canvas(case)
        self.prefetcher.warm(case.primary_path, pages=3)
        self._prefetch_next(recipient_no)

    def _prefetch_next(self, recipient_no: str) -> None:
        """次の案件を先読みする。OK 案件を 30 秒で流すための肝."""
        following = [c for c in self.cases if c.recipient_no > recipient_no]
        for case in following[:2]:
            self.prefetcher.warm(case.primary_path, pages=2)

    def _build_doc_checks(self, selected: set[str]) -> None:
        for child in self.doc_area.winfo_children():
            child.destroy()
        self.doc_vars.clear()

        docs = sorted(
            self.rules.doc_types.values(),
            key=lambda r: int(r.get("表示順") or 999),
        )
        for index, doc in enumerate(docs):
            var = tk.BooleanVar(value=doc["書類ID"] in selected)
            self.doc_vars[doc["書類ID"]] = var
            suffix = "（仮登録）" if self.rules.is_provisional(doc["書類ID"]) else ""
            tk.Checkbutton(
                self.doc_area, text=doc["表示名"] + suffix, variable=var,
                command=self._on_documents_changed, font=self.fonts.base,
                bg=BG, fg=FG, anchor="w", activebackground=BG, selectcolor="#ffffff",
            ).grid(row=index // 3, column=index % 3, sticky="w", padx=(0, 18), pady=1)

        tk.Button(
            self.doc_area, text="＋ 一覧にない書類を追加", command=self._add_provisional,
            font=self.fonts.small,
        ).grid(row=len(docs) // 3 + 1, column=0, sticky="w", pady=(6, 0))

    def _add_provisional(self) -> None:
        name = simpledialog.askstring(WINDOW_TITLE, "書類の名前を入力してください。", parent=self)
        if not name or not name.strip():
            return
        name = name.strip()
        self.store.add_provisional_doc(name)
        # 仮登録は判定に使わない。確定するまで必ず「相談」に倒れる
        self.rules.doc_types[name] = {
            "書類ID": name, "表示名": name, "カテゴリ": "仮登録",
            "表示順": "900", "仮登録": "○", "備考": "",
        }
        messagebox.showinfo(
            WINDOW_TITLE,
            f"「{name}」を仮登録しました。\n\n"
            "管理者が正式に登録するまで、この書類を選んだ案件は「相談」になります。",
        )
        selected = {d for d, v in self.doc_vars.items() if v.get()} | {name}
        self._build_doc_checks(selected)
        self._on_documents_changed()

    # ---------- チェックリスト ----------

    def _build_check_rows(self) -> None:
        for child in self.check_area.winfo_children():
            child.destroy()
        self.check_vars.clear()
        self.defect_vars.clear()
        self.row_widgets.clear()

        defect_options = [""] + sorted(
            self.rules.defect_codes, key=lambda c: int(self.rules.defect_codes[c].get("表示順") or 99)
        )
        for row_index, item in enumerate(self.rules.tool_items()):
            item_id = item["設問ID"]
            row = tk.Frame(self.check_area, bg=BG)
            row.grid(row=row_index, column=0, sticky="w", pady=1)

            tk.Label(row, text=item_id, font=self.fonts.small, bg=BG, fg=MUTED,
                     width=7, anchor="w").pack(side="left")
            tk.Label(row, text=item["設問文"].replace("\n", " "), font=self.fonts.base,
                     bg=BG, fg=FG, width=52, anchor="w", justify="left").pack(side="left")

            var = tk.StringVar()
            self.check_vars[item_id] = var
            buttons = []
            for text, value in [("OK", CHECK_OK), ("NG", CHECK_NG), ("要相談", CHECK_ASK)]:
                button = tk.Radiobutton(
                    row, text=text, variable=var, value=value, font=self.fonts.base,
                    bg=BG, activebackground=BG, selectcolor="#ffffff",
                    command=lambda i=item_id: self._on_check_changed(i),
                )
                button.pack(side="left")
                buttons.append(button)

            defect = tk.StringVar()
            self.defect_vars[item_id] = defect
            combo = ttk.Combobox(row, textvariable=defect, values=defect_options,
                                 width=9, state="readonly", font=self.fonts.small)
            combo.pack(side="left", padx=(8, 0))
            combo.bind("<<ComboboxSelected>>", lambda _e, i=item_id: self._on_check_changed(i))

            hint = tk.Label(row, text="", font=self.fonts.small, bg=BG, fg=MUTED,
                            width=30, anchor="w")
            hint.pack(side="left", padx=(8, 0))

            self.row_widgets[item_id] = {"buttons": buttons, "combo": combo, "hint": hint}

    def _render_rows(self) -> None:
        """セッションの状態を画面に映す."""
        if not self.session:
            return
        for item_id, state in self.session.rows.items():
            widgets = self.row_widgets.get(item_id)
            if not widgets:
                continue
            self.check_vars[item_id].set(state.result)
            self.defect_vars[item_id].set(state.defect_code)
            widgets["hint"].config(text=state.hint)
            for button in widgets["buttons"]:
                button.config(state="normal" if state.editable else "disabled")
            widgets["combo"].config(state="readonly" if state.editable else "disabled")

    def _on_check_changed(self, item_id: str) -> None:
        if not self.session:
            return
        self.session.set_check(
            item_id, self.check_vars[item_id].get(), self.defect_vars[item_id].get()
        )
        self._render_rows()

    def _all_ok(self) -> None:
        if not self.session:
            return
        self.session.all_ok()
        self._render_rows()

    def _on_documents_changed(self) -> None:
        if not self.session:
            return
        self.session.set_documents({d for d, v in self.doc_vars.items() if v.get()})
        self._render_rows()

    # ---------- 作業窓 ----------

    def _open_canvas(self) -> None:
        if not self.current:
            messagebox.showinfo(WINDOW_TITLE, "先に案件を選んでください。")
            return
        if self.canvas_window is None or not self.canvas_window.winfo_exists():
            self.canvas_window = CanvasWindow(
                self, self.fonts, self.prefetcher, self._on_markup_saved,
                comparison_options=self._comparison_options(),
                defect_options=sorted(self.rules.defect_codes),
            )
        self.canvas_window.deiconify()
        self.canvas_window.lift()
        self._load_into_canvas(self.store.get_case(self.current))

    def _comparison_options(self) -> list[str]:
        seen: list[str] = []
        for item in self.rules.tool_items():
            for field_name in self.rules.match_fields(item["設問ID"]):
                if field_name not in seen:
                    seen.append(field_name)
        return seen

    def _load_into_canvas(self, case) -> None:
        if not self.canvas_window:
            return
        self.canvas_window.set_document(SIDE_LEFT, case.primary_path, "申請書")
        # 右は既定で同じ PDF。ページ送りで提出書類まで進めて使う
        self.canvas_window.set_document(SIDE_RIGHT, case.primary_path, "提出書類", page_index=1)

    def _on_markup_saved(self, comparison, mask_status: str, note: str) -> None:
        if not self.current or not self.canvas_window:
            return
        left, right = self.canvas_window.current_images()
        left_title, right_title = self.canvas_window.current_titles()
        out_dir = app_dir() / "出力" / "マークアップ" / self.current
        try:
            path = export_comparison(
                left, right, comparison, out_dir, prefix="cmp",
                left_title=left_title, right_title=right_title,
            )
        except (OSError, ValueError) as exc:
            messagebox.showerror(WINDOW_TITLE, f"書き出せませんでした。\n\n{exc}")
            return

        self.store.add_markup(
            self.current, str(path), comparison=comparison.comparison,
            defect_code=comparison.defect_code, note=note, mask_status=mask_status,
        )
        self.canvas_window.reset()
        self._refresh_mask_label()
        messagebox.showinfo(
            WINDOW_TITLE,
            f"記録しました。\n\n{path.name}"
            + ("\n\nマスキングは「未」です。持ち出す前に必ず処理してください。"
               if mask_status == MASK_TODO else ""),
        )

    # ---------- 保存 ----------

    def _save_current(self) -> None:
        if self.session:
            self.session.save()

    def _send_consultation(self) -> None:
        if not self.current:
            return
        reason = simpledialog.askstring(
            WINDOW_TITLE, "何に迷っているかを書いてください。", parent=self
        )
        if not reason:
            return
        self.session.send_to_consultation(reason)
        self._refresh_list()
        messagebox.showinfo(WINDOW_TITLE, "相談へ送りました。管理者の回答を待ちます。")

    def _complete(self) -> None:
        if not self.current:
            return
        blank = self.session.blank_items
        if blank and not messagebox.askyesno(
            WINDOW_TITLE,
            f"未入力の設問が {len(blank)} 件あります。\n"
            f"（{'、'.join(blank[:5])}{' ほか' if len(blank) > 5 else ''}）\n\n"
            "このまま完了しますか？",
        ):
            return
        self.session.complete()
        self._refresh_list()

        following = self.store.next_pending()
        if following:
            self._load_case(following.recipient_no)
        else:
            self.session = None
            self.case_label.config(text="未着手の案件はありません。")

    def _swap_primary(self) -> None:
        case = self.store.get_case(self.current) if self.current else None
        if not case or not case.additional:
            return
        choices = [str(case.primary_path)] + case.additional
        answer = simpledialog.askinteger(
            WINDOW_TITLE,
            "申請書一式の本体にするものを番号で選んでください。\n\n"
            + "\n".join(f"{i}: {Path(p).name}" for i, p in enumerate(choices)),
            parent=self, minvalue=0, maxvalue=len(choices) - 1,
        )
        if answer is None or answer == 0:
            return
        new_primary = choices[answer]
        rest = [p for p in choices if p != new_primary]
        self.store.set_primary(self.current, new_primary, rest)
        self._load_case(self.current)
        self._refresh_list()

    def _on_close(self) -> None:
        self._save_current()
        self.prefetcher.stop()
        self.store.close()
        self.destroy()


def main() -> int:
    folder = data_dir()
    try:
        rules = RuleSet.load(folder)
    except Exception as exc:  # noqa: BLE001
        tk.Tk().withdraw()
        messagebox.showerror(WINDOW_TITLE, f"判定表を読み込めませんでした。\n\n{folder}\n\n{exc}")
        return 1

    if not rules.checklist_items:
        tk.Tk().withdraw()
        messagebox.showerror(
            WINDOW_TITLE,
            f"判定表が見つかりません。\n\nexe と同じ場所に data フォルダを置いてください。\n{folder}",
        )
        return 1

    problems = rules.validate()
    store = Store(app_dir() / "作業" / "見直し.db", worker="")
    app = App(rules, store)
    if problems:
        messagebox.showwarning(
            WINDOW_TITLE,
            "判定表に問題があります。管理者に連絡してください。\n\n"
            + "\n".join(f"・{p}" for p in problems[:10]),
        )
    app.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
