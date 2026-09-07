"""ツールB：審査判断支援ツール（オペレーター用）.

設計上の制約は 1 件あたり数十秒。よって：

- 判定ボタンを置かない。選択を変えた瞬間に結果が出る
- 入力は選択のみ。自由入力欄を作らない
- 結論だけでなく理由と記入方法を必ず出す（転記するだけで済むように）
- 判定表に無い組み合わせは必ず「管理者に相談」を出す
"""
from __future__ import annotations

import sys
import tkinter as tk
from tkinter import messagebox

from .config import MATCH_DIFF, MATCH_NA, MATCH_SAME, RESULT_LABEL, data_dir
from .rules import RuleSet, combine
from .ui import BG, FG, LINE, MUTED, RESULT_COLORS, Fonts, heading, separator

WINDOW_TITLE = "書類審査 判断支援ツール"


class App(tk.Tk):
    def __init__(self, rules: RuleSet) -> None:
        super().__init__()
        self.rules = rules
        self.fonts = Fonts()
        self.doc_vars: dict[str, tk.BooleanVar] = {}
        self.match_vars: dict[tuple[str, str], tk.StringVar] = {}
        self.current_item: str | None = None

        self.title(WINDOW_TITLE)
        self.geometry("1180x760")
        self.configure(bg=BG)
        self.minsize(980, 640)

        self._build()
        self._show_validation_warnings()

        if self.item_ids:
            self.item_list.selection_set(0)
            self._on_item_selected()

        self.bind("<Escape>", lambda _e: self._clear())
        self.bind("<F5>", lambda _e: self._reload_rules())

    # ---------- 画面構築 ----------

    def _build(self) -> None:
        left = tk.Frame(self, bg=BG, padx=12, pady=12)
        left.pack(side="left", fill="y")
        heading(left, "① 確認する項目", self.fonts).pack(fill="x", pady=(0, 6))

        self.item_ids = sorted(self.rules.checklist_items)
        self.item_list = tk.Listbox(
            left, width=34, height=26, font=self.fonts.base,
            exportselection=False, activestyle="none",
            highlightthickness=1, highlightbackground=LINE,
        )
        for item_id in self.item_ids:
            row = self.rules.checklist_items[item_id]
            self.item_list.insert("end", f"{item_id}  {row['確認書類']}")
        self.item_list.pack(fill="y", expand=True)
        self.item_list.bind("<<ListboxSelect>>", lambda _e: self._on_item_selected())

        tk.Label(
            left, text="Esc＝入力クリア　F5＝判定表の再読込",
            font=self.fonts.small, bg=BG, fg=MUTED, anchor="w",
        ).pack(fill="x", pady=(8, 0))

        right = tk.Frame(self, bg=BG, padx=16, pady=12)
        right.pack(side="left", fill="both", expand=True)

        self.item_text = tk.Label(
            right, text="", font=self.fonts.label, bg=BG, fg=MUTED,
            anchor="w", justify="left", wraplength=780,
        )
        self.item_text.pack(fill="x", pady=(0, 10))

        self.input_area = tk.Frame(right, bg=BG)
        self.input_area.pack(fill="both", expand=True)

        separator(right).pack(fill="x", pady=10)
        self._build_result_area(right)

    def _build_result_area(self, parent: tk.Misc) -> None:
        heading(parent, "③ 判定結果", self.fonts).pack(fill="x")

        self.result_label = tk.Label(
            parent, text="", font=self.fonts.result,
            anchor="w", padx=16, pady=12,
        )
        self.result_label.pack(fill="x", pady=(6, 8))

        self.reason_label = tk.Label(
            parent, text="", font=self.fonts.reason, bg=BG, fg=FG,
            anchor="w", justify="left", wraplength=820,
        )
        self.reason_label.pack(fill="x")

        self.entry_label = tk.Label(
            parent, text="", font=self.fonts.reason, bg="#f5f5f5", fg=FG,
            anchor="w", justify="left", wraplength=820, padx=10, pady=8,
        )
        self.entry_label.pack(fill="x", pady=(8, 0))

        self.source_label = tk.Label(
            parent, text="", font=self.fonts.small, bg=BG, fg=MUTED, anchor="w",
        )
        self.source_label.pack(fill="x", pady=(6, 0))

    # ---------- 項目切り替え ----------

    def _on_item_selected(self) -> None:
        selection = self.item_list.curselection()
        if not selection:
            return
        self.current_item = self.item_ids[selection[0]]
        row = self.rules.checklist_items[self.current_item]
        self.item_text.config(text=f"設問：{row['設問文']}")

        for child in self.input_area.winfo_children():
            child.destroy()
        self.doc_vars.clear()
        self.match_vars.clear()

        docs = self.rules.docs_for_item(self.current_item)
        fields = self.rules.match_fields(self.current_item)

        if docs:
            self._build_doc_checks(docs)
        if fields:
            self._build_match_matrix(fields)
        if not docs and not fields:
            tk.Label(
                self.input_area,
                text="この設問は判定表に未登録です。管理者に相談してください。",
                font=self.fonts.reason, bg=BG, fg=MUTED, anchor="w",
            ).pack(fill="x")

        self._judge()

    def _build_doc_checks(self, docs: list[dict]) -> None:
        heading(self.input_area, "② 提出された書類を選ぶ（複数可）", self.fonts).pack(
            fill="x", pady=(0, 6)
        )
        grid = tk.Frame(self.input_area, bg=BG)
        grid.pack(fill="x")
        for index, doc in enumerate(docs):
            var = tk.BooleanVar(value=False)
            self.doc_vars[doc["書類ID"]] = var
            tk.Checkbutton(
                grid, text=doc["表示名"], variable=var, command=self._judge,
                font=self.fonts.base, bg=BG, fg=FG, anchor="w",
                activebackground=BG, selectcolor="#ffffff", padx=4,
            ).grid(row=index // 2, column=index % 2, sticky="w", padx=(0, 24), pady=2)

    def _build_match_matrix(self, fields: list[str]) -> None:
        """比較項目 × 書類 のマトリクス.

        全パターンを列挙させず、基準書類に対して各書類が一致するかだけを聞く。
        判定表に登録のないパターンはワイルドカード行が受け、最終的に相談へ倒れる。
        """
        base = self.rules.match_base_doc(self.current_item)
        docs = self.rules.match_docs(self.current_item)
        label = f"② 突合の結果を選ぶ（基準：{self._doc_label(base)}）" if base else "② 突合の結果を選ぶ"
        heading(self.input_area, label, self.fonts).pack(fill="x", pady=(12, 6))

        grid = tk.Frame(self.input_area, bg=BG)
        grid.pack(fill="x")

        if not docs:
            # 対象書類が未設定のときは、項目ごとの一致／不一致だけを聞く簡易表示
            self._build_simple_match(grid, fields)
            return

        for col, doc in enumerate(docs, start=1):
            tk.Label(
                grid, text=self._doc_label(doc), font=self.fonts.base, bg=BG, fg=FG,
            ).grid(row=0, column=col, padx=(0, 18), pady=(0, 4))

        for row_index, field_name in enumerate(fields, start=1):
            tk.Label(
                grid, text=field_name, font=self.fonts.base, bg=BG, fg=FG,
                width=12, anchor="w",
            ).grid(row=row_index, column=0, sticky="w", pady=3)

            for col, doc in enumerate(docs, start=1):
                var = tk.StringVar(value="")
                self.match_vars[(field_name, doc)] = var
                cell = tk.Frame(grid, bg=BG)
                cell.grid(row=row_index, column=col, sticky="w", padx=(0, 18))
                for text, value in [("一致", MATCH_SAME), ("不一致", MATCH_DIFF), ("－", MATCH_NA)]:
                    tk.Radiobutton(
                        cell, text=text, variable=var, value=value, command=self._judge,
                        font=self.fonts.base, bg=BG, fg=FG, activebackground=BG,
                        selectcolor="#ffffff",
                    ).pack(side="left")

        tk.Label(
            self.input_area,
            text="－ ＝ その書類では確認できない（未確認のまま判定に含めません）",
            font=self.fonts.small, bg=BG, fg=MUTED, anchor="w",
        ).pack(fill="x", pady=(6, 0))

    def _build_simple_match(self, grid: tk.Frame, fields: list[str]) -> None:
        for row_index, field_name in enumerate(fields):
            tk.Label(
                grid, text=field_name, font=self.fonts.base, bg=BG, fg=FG,
                width=12, anchor="w",
            ).grid(row=row_index, column=0, sticky="w", pady=3)
            var = tk.StringVar(value="")
            self.match_vars[(field_name, "")] = var
            for col, (text, value) in enumerate(
                [("一致", MATCH_SAME), ("不一致", MATCH_DIFF), ("確認不可", MATCH_NA)], start=1
            ):
                tk.Radiobutton(
                    grid, text=text, variable=var, value=value, command=self._judge,
                    font=self.fonts.base, bg=BG, fg=FG, activebackground=BG,
                    selectcolor="#ffffff",
                ).grid(row=row_index, column=col, sticky="w", padx=(0, 14))

    def _doc_label(self, doc_id: str) -> str:
        row = self.rules.doc_types.get(doc_id)
        return row["表示名"] if row else doc_id

    # ---------- 判定 ----------

    def _judge(self) -> None:
        if not self.current_item:
            return

        judgements = []
        if self.doc_vars:
            selected = [d for d, v in self.doc_vars.items() if v.get()]
            judgements.append(self.rules.judge_single(self.current_item, selected))

        # 比較項目ごとに、不一致だった書類の集合を組み立てる
        mismatched: dict[str, list[str]] = {}
        touched: set[str] = set()
        for (field_name, doc_id), var in self.match_vars.items():
            state = var.get()
            if not state or state == MATCH_NA:
                continue  # 未入力・確認不可は判定に含めない
            touched.add(field_name)
            if state == MATCH_DIFF:
                mismatched.setdefault(field_name, []).append(doc_id or "不一致あり")

        for field_name in sorted(touched):
            judgements.append(
                self.rules.judge_match(
                    self.current_item, field_name, sorted(mismatched.get(field_name, []))
                )
            )

        if not judgements:
            self._render(None)
            return
        self._render(combine(judgements))

    def _render(self, judgement) -> None:
        if judgement is None:
            self.result_label.config(text="（選択してください）", fg=MUTED, bg="#fafafa")
            self.reason_label.config(text="")
            self.entry_label.config(text="")
            self.source_label.config(text="")
            return

        fg, bg = RESULT_COLORS[judgement.result]
        self.result_label.config(text=RESULT_LABEL[judgement.result], fg=fg, bg=bg)
        self.reason_label.config(text=f"理由：{judgement.reason}")
        self.entry_label.config(
            text=f"チェックリストへの記入：{judgement.entry_method}"
            if judgement.entry_method
            else "チェックリストへの記入：管理者の指示に従ってください。"
        )
        self.source_label.config(text=f"根拠：{judgement.source}")

    def _clear(self) -> None:
        for var in self.doc_vars.values():
            var.set(False)
        for var in self.match_vars.values():
            var.set("")
        self._judge()

    def _reload_rules(self) -> None:
        try:
            self.rules = RuleSet.load(data_dir())
        except Exception as exc:  # noqa: BLE001 - 利用者に理由を見せる
            messagebox.showerror(WINDOW_TITLE, f"判定表を読み込めませんでした。\n\n{exc}")
            return
        self._show_validation_warnings()
        self._on_item_selected()

    def _show_validation_warnings(self) -> None:
        problems = self.rules.validate()
        if problems:
            shown = "\n".join(f"・{p}" for p in problems[:15])
            more = f"\n\n他 {len(problems) - 15} 件" if len(problems) > 15 else ""
            messagebox.showwarning(
                WINDOW_TITLE,
                "判定表に問題があります。管理者に連絡してください。\n\n" + shown + more,
            )


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
            f"判定表が見つかりません。\n\nexe と同じ場所に data フォルダを置いてください。\n探した場所: {folder}",
        )
        return 1

    App(rules).mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
