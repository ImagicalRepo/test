"""チェックリスト窓：見直し作業の中心.

作業リストから 1 件ずつ開き、届いた書類を選び、チェックリストを埋める。
NG や迷いがあれば作業窓でマークアップして記録する。

速度の要は 4 つ。
  ・「すべて OK」（大半の案件はこれ 1 回で終わる）
  ・前提が NG の設問を自動で「判定不能」にして入力を飛ばす
  ・次の申請を裏で先読みしておく
  ・**キーボードだけで 1 件が完結する**（NumLock を切ればテンキーだけで回る）

入力は打つそばから保存される。数か月続く作業なので、停電や強制終了で
編集中の 1 件を失わないようにしている。
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
    CASE_CONSULT, CASE_DONE, CASE_WORKING, CHECK_ASK, CHECK_NA,
    CHECK_NG, CHECK_OK, MASK_TODO, app_dir, data_dir,
)
from .markup import SIDE_LEFT, SIDE_RIGHT, export_comparison
from .prefetch import Prefetcher
from .rules import RuleSet
from .session import ReviewSession
from .store import Store
from .theme import CHECK_SYMBOLS, THEMES, Theme, load_theme_name, save_theme_name
from .ui import Fonts, KeyHintBar, ProgressWindow, polish, setup_ttk_style

WINDOW_TITLE = "審査データ見直しツール"

ZONE_DOCS = "書類"
ZONE_CHECKS = "チェック"

# 行に並べる 3 つの状態。記号を付けて、色が見分けられなくても判別できるようにする。
STATE_CELLS = [
    ("1", CHECK_OK, f"{CHECK_SYMBOLS[CHECK_OK]} OK"),
    ("2", CHECK_NG, f"{CHECK_SYMBOLS[CHECK_NG]} NG"),
    ("3", CHECK_ASK, f"{CHECK_SYMBOLS[CHECK_ASK]} 要相談"),
]

HINTS_COMMON = [
    ("Tab", "書類⇄チェック"), ("Space", "すべてOK"), ("Enter", "完了して次へ"),
    ("Ctrl+Z", "元に戻す"), ("+ -", "次/前の案件"), (".", "作業窓"), ("/", "相談"),
    ("Esc", "クリア"),
]
HINTS_DOCS = [("1〜0", "書類を選ぶ")]
HINTS_CHECKS = [("↑↓", "行を移動"), ("1", "○OK"), ("2", "×NG"), ("3", "△要相談")]


class App(tk.Tk):
    def __init__(self, rules: RuleSet, store: Store) -> None:
        super().__init__()
        self.rules = rules
        self.store = store
        self.theme: Theme = THEMES[load_theme_name()]
        self.fonts = Fonts(self.theme.font_scale)
        self.prefetcher = Prefetcher()
        self.canvas_window: CanvasWindow | None = None

        # 判断は ReviewSession が持つ。画面はその状態を映すだけにして、
        # 同じロジックを二重に持たないようにする（session.py は画面なしで検証済み）。
        self.session: ReviewSession | None = None
        self.zone = ZONE_DOCS
        self.cursor = 0                      # チェックリストの現在行
        self.doc_order: list[str] = []       # 数字キーの割り当て順
        self.doc_vars: dict[str, tk.BooleanVar] = {}
        self.row_widgets: dict[str, dict] = {}
        self.item_ids: list[str] = []

        self.title(WINDOW_TITLE)
        self.geometry("1500x920")
        self.minsize(1180, 700)
        self.configure(bg=self.theme.bg)
        setup_ttk_style(self, self.theme, self.fonts)
        self._build_menu()
        self._build()
        # 組み終わってから平らにする。構築側に触れないので bind も配置も無傷。
        polish(self, self.theme)
        self._bind_keys()
        self._refresh_list()
        self._resume()
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    @property
    def current(self) -> str | None:
        return self.session.recipient_no if self.session else None

    # ---------- 画面 ----------

    def _build_menu(self) -> None:
        menubar = tk.Menu(self)

        tools = tk.Menu(menubar, tearoff=0)
        tools.add_command(label="事前バッチ（確認する順序を決める）",
                          command=lambda: PrescanDialog(self, self.fonts, self.theme, self.store))
        tools.add_separator()
        tools.add_command(label="マスキング待ち",
                          command=lambda: MaskQueueDialog(self, self.fonts, self.theme, self.store))
        tools.add_command(label="出力点検（持ち出す前に）",
                          command=lambda: AuditDialog(self, self.fonts, self.theme, self.store))
        menubar.add_cascade(label="ツール", menu=tools)

        colors = tk.Menu(menubar, tearoff=0)
        self.theme_var = tk.StringVar(value=self.theme.name)
        for name, theme in THEMES.items():
            colors.add_radiobutton(
                label=f"{name}（{theme.note}）", value=name, variable=self.theme_var,
                command=lambda n=name: self._change_theme(n),
            )
        menubar.add_cascade(label="配色", menu=colors)
        self.config(menu=menubar)

    def _change_theme(self, name: str) -> None:
        save_theme_name(name)
        messagebox.showinfo(
            WINDOW_TITLE,
            f"配色を「{name}」にしました。\n\n次に起動したときから変わります。",
        )

    def _build(self) -> None:
        t = self.theme
        # キーヒント帯を先に確保する。あとから pack すると左右のパネルが
        # 先に高さを取ってしまい、帯が見切れる。
        self.hint_bar = KeyHintBar(self, self.fonts, t)
        self.hint_bar.pack(fill="x", side="bottom")

        left = tk.Frame(self, bg=t.bg, padx=8, pady=8)
        left.pack(side="left", fill="y")

        tk.Button(left, text="フォルダを取り込む", command=self._import_folder,
                  font=self.fonts.base).pack(fill="x")
        self.progress_label = tk.Label(left, text="", font=self.fonts.small, bg=t.bg,
                                       fg=t.muted, justify="left", anchor="w")
        self.progress_label.pack(fill="x", pady=(5, 3))

        self.case_list = tk.Listbox(
            left, width=30, height=32, font=self.fonts.small, exportselection=False,
            activestyle="none", highlightthickness=1, highlightbackground=t.line,
            bg=t.surface, fg=t.fg, selectbackground=t.select_bg, selectforeground=t.select_fg,
        )
        self.case_list.pack(fill="y", expand=True)
        self.case_list.bind("<<ListboxSelect>>", lambda _e: self._open_selected())

        self.mask_label = tk.Label(left, text="", font=self.fonts.base, bg=t.bg, anchor="w")
        self.mask_label.pack(fill="x", pady=(5, 0))

        right = tk.Frame(self, bg=t.bg, padx=10, pady=8)
        right.pack(side="left", fill="both", expand=True)

        header = tk.Frame(right, bg=t.bg)
        header.pack(fill="x")
        self.case_label = tk.Label(header, text="",
                                   font=self.fonts.heading, bg=t.bg, fg=t.fg, anchor="w")
        self.case_label.pack(side="left")
        self.swap_button = tk.Button(header, text="本体を入れ替える", command=self._swap_primary,
                                     font=self.fonts.small, state="disabled")
        self.swap_button.pack(side="right")

        # ① 書類選択ゾーン
        self.doc_zone = tk.Frame(right, bg=t.bg, highlightthickness=2, highlightbackground=t.bg,
                                 padx=4, pady=3)
        self.doc_zone.pack(fill="x", pady=(6, 0))
        self.doc_heading = tk.Label(self.doc_zone, text="① 何が届いているか",
                                    font=self.fonts.heading, bg=t.bg, fg=t.fg, anchor="w")
        self.doc_heading.pack(fill="x")
        self.doc_area = tk.Frame(self.doc_zone, bg=t.bg)
        self.doc_area.pack(fill="x")

        # ② チェックリストゾーン
        self.check_zone = tk.Frame(right, bg=t.bg, highlightthickness=2,
                                   highlightbackground=t.bg, padx=4, pady=3)
        self.check_zone.pack(fill="both", expand=True, pady=(6, 0))
        check_header = tk.Frame(self.check_zone, bg=t.bg)
        check_header.pack(fill="x")
        self.check_heading = tk.Label(check_header, text="② チェックリスト",
                                      font=self.fonts.heading, bg=t.bg, fg=t.fg)
        self.check_heading.pack(side="left")
        tk.Button(check_header, text="すべて OK (Space)", command=self._all_ok,
                  font=self.fonts.heading).pack(side="right")

        holder = tk.Frame(self.check_zone, bg=t.bg)
        holder.pack(fill="both", expand=True, pady=(3, 0))
        self.check_canvas = tk.Canvas(holder, bg=t.bg, highlightthickness=0)
        scroll = tk.Scrollbar(holder, orient="vertical", command=self.check_canvas.yview)
        self.check_canvas.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.check_canvas.pack(side="left", fill="both", expand=True)
        self.check_area = tk.Frame(self.check_canvas, bg=t.bg)
        self.check_window = self.check_canvas.create_window((0, 0), window=self.check_area,
                                                            anchor="nw")
        self.check_area.bind(
            "<Configure>",
            lambda _e: self.check_canvas.configure(scrollregion=self.check_canvas.bbox("all")),
        )

        footer = tk.Frame(right, bg=t.bg, pady=5)
        footer.pack(fill="x")
        for text, command in [
            ("作業窓を開く (.)", self._open_canvas),
            ("相談へ送る (/)", self._send_consultation),
            ("保存して閉じる (Ctrl+S)", self._save_and_close),
        ]:
            tk.Button(footer, text=text, command=command,
                      font=self.fonts.base).pack(side="left", padx=(0, 6))
        tk.Button(footer, text="完了して次へ (Enter)", command=self._complete,
                  font=self.fonts.heading).pack(side="right")

        self._update_zone_look()

    # ---------- キー操作 ----------

    def _bind_keys(self) -> None:
        binds = {
            "<Tab>": lambda e: self._switch_zone(),
            "<ISO_Left_Tab>": lambda e: self._switch_zone(),
            "<space>": lambda e: self._all_ok(),
            "<Return>": lambda e: self._complete(),
            "<KP_Enter>": lambda e: self._complete(),
            "<Escape>": lambda e: self._clear_inputs(),
            "<Control-z>": lambda e: self._undo(),
            "<Control-s>": lambda e: self._save_and_close(),
            "<Up>": lambda e: self._move_cursor(-1),
            "<Down>": lambda e: self._move_cursor(1),
            "<plus>": lambda e: self._step_case(1),
            "<KP_Add>": lambda e: self._step_case(1),
            "<minus>": lambda e: self._step_case(-1),
            "<KP_Subtract>": lambda e: self._step_case(-1),
            "<period>": lambda e: self._open_canvas(),
            "<KP_Decimal>": lambda e: self._open_canvas(),
            "<slash>": lambda e: self._send_consultation(),
            "<KP_Divide>": lambda e: self._send_consultation(),
        }
        for digit in range(10):
            binds[f"<Key-{digit}>"] = lambda e, d=digit: self._digit(d)
            binds[f"<KP_{digit}>"] = lambda e, d=digit: self._digit(d)
        for sequence, handler in binds.items():
            self.bind(sequence, lambda e, h=handler: self._guard(e, h))

    def _guard(self, event: tk.Event, handler) -> str | None:
        """入力欄で打っているときは、キー操作を横取りしない."""
        if isinstance(event.widget, (tk.Entry, tk.Text, ttk.Combobox, ttk.Entry)):
            return None
        handler(event)
        return "break"

    def _switch_zone(self) -> None:
        self.zone = ZONE_CHECKS if self.zone == ZONE_DOCS else ZONE_DOCS
        self._update_zone_look()

    def _digit(self, digit: int) -> None:
        if not self.session:
            return
        if self.zone == ZONE_DOCS:
            # 1〜9 を 1 番目〜9 番目、0 を 10 番目に割り当てる
            index = 9 if digit == 0 else digit - 1
            if index < len(self.doc_order):
                self.session.toggle_document(self.doc_order[index])
                self._render_documents()
                self._render_rows()
            return
        # チェックリストゾーン
        item_id = self._cursor_item()
        if item_id is None:
            return
        for key, state, _label in STATE_CELLS:
            if key == str(digit):
                self.session.set_check(item_id, state, self.session.rows[item_id].defect_code)
                self._render_rows()
                return
        # 4〜8 は不備理由（NG のときだけ意味を持つ）
        codes = self._defect_codes()
        index = digit - 4
        if 0 <= index < len(codes):
            row = self.session.rows[item_id]
            self.session.set_check(item_id, row.result, codes[index])
            self._render_rows()

    def _move_cursor(self, delta: int) -> None:
        if not self.item_ids:
            return
        self.zone = ZONE_CHECKS
        self.cursor = max(0, min(self.cursor + delta, len(self.item_ids) - 1))
        self._update_zone_look()
        self._render_rows()
        self._scroll_to_cursor()

    def _cursor_item(self) -> str | None:
        if not self.item_ids:
            return None
        self.cursor = max(0, min(self.cursor, len(self.item_ids) - 1))
        return self.item_ids[self.cursor]

    def _scroll_to_cursor(self) -> None:
        item_id = self._cursor_item()
        widgets = self.row_widgets.get(item_id or "")
        if not widgets:
            return
        self.check_canvas.update_idletasks()
        row = widgets["row"]
        top = row.winfo_y()
        height = max(self.check_canvas.winfo_height(), 1)
        total = max(self.check_area.winfo_height(), 1)
        if total <= height:
            return
        self.check_canvas.yview_moveto(max(0.0, (top - height / 2) / total))

    def _update_zone_look(self) -> None:
        t = self.theme
        self.doc_zone.config(highlightbackground=t.focus if self.zone == ZONE_DOCS else t.bg)
        self.check_zone.config(highlightbackground=t.focus if self.zone == ZONE_CHECKS else t.bg)
        self.doc_heading.config(
            text="① 何が届いているか" + ("　◀ 操作中" if self.zone == ZONE_DOCS else "")
        )
        self.check_heading.config(
            text="② チェックリスト" + ("　◀ 操作中" if self.zone == ZONE_CHECKS else "")
        )
        hints = (HINTS_DOCS if self.zone == ZONE_DOCS else HINTS_CHECKS) + HINTS_COMMON
        self.hint_bar.show(hints)

    # ---------- 作業リスト ----------

    def _import_folder(self) -> None:
        folder = filedialog.askdirectory(title="スキャンデータのフォルダ（サブフォルダも探します）")
        if not folder:
            return
        progress = ProgressWindow(self, self.fonts, self.theme, "取り込み中")
        try:
            progress.report("フォルダを調べています…（サブフォルダも探します）")
            parsed, unparsed = scan_folder(Path(folder))
            progress.report(f"{len(parsed)} 件のファイルを読みました。作業リストを作っています…")
            cases = build_cases(parsed)
            added, updated = self.store.sync_cases(
                cases, progress=lambda i, n: progress.report("作業リストに登録中", i, n)
            )
        finally:
            progress.close()
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
        selection = self.case_list.curselection()
        self.case_list.delete(0, "end")
        for case in self.cases:
            mark = {CASE_DONE: "済", CASE_CONSULT: "相", CASE_WORKING: "作"}.get(case.status, "　")
            flag = "●" if case.priority > 0 else "　"
            self.case_list.insert("end", f"{mark}{flag} {case.recipient_no}  {case.received_on}")
        if selection:
            self.case_list.selection_set(selection[0])

        counts = self.store.progress()
        done, total = counts[CASE_DONE], counts["合計"]
        percent = f"{done * 100 // total}%" if total else "-"
        self.progress_label.config(
            text=f"全 {total} 件　完了 {done}（{percent}）　作業中 {counts[CASE_WORKING]}　"
                 f"相談中 {counts[CASE_CONSULT]}\n●＝メモ欄に書き込みあり（先に確認）"
        )
        self._refresh_mask_label()

    def _refresh_mask_label(self) -> None:
        todo = self.store.count_mask_todo()
        self.mask_label.config(
            text=f"マスキング未　{todo} 件" + ("　← 持ち出せません" if todo else ""),
            fg=self.theme.ng_fg if todo else self.theme.muted,
        )

    def _resume(self) -> None:
        """前回の続きから開く。何も無ければ、次にすることを案内する."""
        case = self.store.resume_point()
        if case:
            self._load_case(case.recipient_no)
        elif self.store.progress()["合計"] == 0:
            self.case_label.config(
                text="まず「フォルダを取り込む」で、スキャンデータのある場所を指定してください。"
            )
        else:
            self.case_label.config(text="未着手の案件はありません。おつかれさまでした。")

    def _open_selected(self) -> None:
        selection = self.case_list.curselection()
        if selection:
            self._load_case(self.cases[selection[0]].recipient_no)

    def _step_case(self, delta: int) -> None:
        if not self.cases:
            return
        numbers = [c.recipient_no for c in self.cases]
        index = numbers.index(self.current) if self.current in numbers else -delta
        self._load_case(numbers[max(0, min(index + delta, len(numbers) - 1))])

    # ---------- 1 件を開く ----------

    def _load_case(self, recipient_no: str) -> None:
        case = self.store.get_case(recipient_no)
        if case is None:
            return
        self.session = ReviewSession.open(self.rules, self.store, recipient_no)
        self.cursor = 0
        self.zone = ZONE_DOCS

        extra = f"　追加書類 {len(case.additional)} 件" if case.additional else ""
        self.case_label.config(text=f"受給者番号 {recipient_no}　受付 {case.received_on}{extra}")
        self.swap_button.config(state="normal" if case.additional else "disabled")

        self._build_doc_checks()
        self._build_check_rows()
        self._render_rows()
        self._update_zone_look()
        self._select_in_list(recipient_no)

        if self.canvas_window and self.canvas_window.winfo_exists():
            self._load_into_canvas(case)
        self.prefetcher.warm(case.primary_path, pages=3)
        self._prefetch_next(recipient_no)

    def _select_in_list(self, recipient_no: str) -> None:
        for index, case in enumerate(self.cases):
            if case.recipient_no == recipient_no:
                self.case_list.selection_clear(0, "end")
                self.case_list.selection_set(index)
                self.case_list.see(index)
                return

    def _prefetch_next(self, recipient_no: str) -> None:
        """次の案件を先読みする。OK 案件を 30 秒で流すための肝."""
        following = [c for c in self.cases if c.recipient_no > recipient_no]
        for case in following[:2]:
            self.prefetcher.warm(case.primary_path, pages=2)

    # ---------- ① 書類選択 ----------

    def _build_doc_checks(self) -> None:
        t = self.theme
        for child in self.doc_area.winfo_children():
            child.destroy()
        self.doc_vars.clear()

        docs = sorted(self.rules.doc_types.values(), key=lambda r: int(r.get("表示順") or 999))
        self.doc_order = [d["書類ID"] for d in docs]
        for index, doc in enumerate(docs):
            var = tk.BooleanVar(value=doc["書類ID"] in (self.session.documents if self.session else set()))
            self.doc_vars[doc["書類ID"]] = var
            key = "" if index >= 10 else f"[{(index + 1) % 10}] "
            suffix = "（仮登録）" if self.rules.is_provisional(doc["書類ID"]) else ""
            tk.Checkbutton(
                self.doc_area, text=f"{key}{doc['表示名']}{suffix}", variable=var,
                command=self._on_documents_changed, font=self.fonts.base,
                bg=t.bg, fg=t.fg, anchor="w", activebackground=t.bg, selectcolor=t.surface,
            ).grid(row=index // 3, column=index % 3, sticky="w", padx=(0, 14))

        tk.Button(self.doc_area, text="＋ 一覧にない書類を追加", command=self._add_provisional,
                  font=self.fonts.small).grid(row=len(docs) // 3 + 1, column=0, sticky="w",
                                              pady=(4, 0))
        polish(self.doc_area, self.theme)

    def _render_documents(self) -> None:
        if self.session:
            for doc_id, var in self.doc_vars.items():
                var.set(doc_id in self.session.documents)

    def _on_documents_changed(self) -> None:
        if self.session:
            self.session.set_documents({d for d, v in self.doc_vars.items() if v.get()})
            self._render_rows()

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
        if self.session:
            self.session.toggle_document(name)
        self._build_doc_checks()
        self._render_documents()
        self._render_rows()

    # ---------- ② チェックリスト ----------

    def _defect_codes(self) -> list[str]:
        return sorted(self.rules.defect_codes,
                      key=lambda c: int(self.rules.defect_codes[c].get("表示順") or 99))

    def _build_check_rows(self) -> None:
        t = self.theme
        for child in self.check_area.winfo_children():
            child.destroy()
        self.row_widgets.clear()
        self.item_ids = []

        defect_options = [""] + self._defect_codes()

        # 列の見出し。何を選ぶ欄なのかを示す（入力欄にラベルを付ける）
        header = tk.Frame(self.check_area, bg=t.bg, padx=2)
        header.grid(row=0, column=0, sticky="w")
        # 幅は本文と同じ書体で数える。見出しだけ小さい書体にすると列がずれる。
        tk.Label(header, text="設問", font=self.fonts.small, bg=t.bg, fg=t.muted,
                 width=7, anchor="w").pack(side="left")
        tk.Label(header, text="確認内容", font=self.fonts.base, bg=t.bg, fg=t.muted,
                 width=70, anchor="w").pack(side="left")
        for _key, _state, label in STATE_CELLS:
            tk.Label(header, text=label, font=self.fonts.small, bg=t.bg,
                     fg=t.muted, width=8, padx=2).pack(side="left", padx=1)
        tk.Label(header, text="不備理由 / 判定表の候補", font=self.fonts.small, bg=t.bg,
                 fg=t.muted, anchor="w").pack(side="left", padx=(6, 0))

        row_index = 1
        previous_group = None
        for item in self.rules.tool_items():
            item_id = item["設問ID"]
            group = item.get("確認書類", "")
            # 設問文が同じ行がある（通常提出分と追加提出分）。現物の様式どおり
            # 確認書類ごとの見出しを付けて区別できるようにする。
            if group != previous_group:
                tk.Label(
                    self.check_area,
                    text=f"■ {item.get('大項目N', '')}　{group}".replace("\n", " "),
                    font=self.fonts.heading, bg=t.bg, fg=t.fg, anchor="w",
                ).grid(row=row_index, column=0, sticky="w", pady=(6, 0))
                previous_group = group
                row_index += 1

            row = tk.Frame(self.check_area, bg=t.bg, highlightthickness=2,
                           highlightbackground=t.bg, padx=2)
            row.grid(row=row_index, column=0, sticky="w")
            row_index += 1
            self.item_ids.append(item_id)

            tk.Label(row, text=item_id, font=self.fonts.small, bg=t.bg, fg=t.muted,
                     width=7, anchor="w").pack(side="left")
            tk.Label(row, text=item["設問文"].replace("\n", " "), font=self.fonts.base,
                     bg=t.bg, fg=t.fg, width=70, anchor="w").pack(side="left")

            cells = {}
            for _key, state, label in STATE_CELLS:
                # 押せる場所だと分かるように、カーソルを変え、触れたら色を変える。
                # ただの文字に見えると、クリックできることに気づかれない。
                cell = tk.Label(row, text=label, font=self.fonts.base, width=8,
                                padx=2, bg=t.bg, fg=t.muted, cursor="hand2")
                cell.pack(side="left", padx=1)
                cell.bind("<Button-1>", lambda _e, i=item_id, s=state: self._click_state(i, s))
                cell.bind("<Enter>", lambda _e, c=cell, i=item_id, v=state: self._hover(c, i, v, True))
                cell.bind("<Leave>", lambda _e, c=cell, i=item_id, v=state: self._hover(c, i, v, False))
                cells[state] = cell

            defect = tk.StringVar()
            combo = ttk.Combobox(row, textvariable=defect, values=defect_options,
                                 width=9, state="readonly", font=self.fonts.small)
            combo.pack(side="left", padx=(6, 0))
            combo.bind("<<ComboboxSelected>>", lambda _e, i=item_id: self._on_defect_changed(i))

            hint = tk.Label(row, text="", font=self.fonts.small, bg=t.bg, fg=t.muted,
                            width=26, anchor="w")
            hint.pack(side="left", padx=(6, 0))

            self.row_widgets[item_id] = {
                "row": row, "cells": cells, "combo": combo, "defect": defect, "hint": hint,
            }

        polish(self.check_area, self.theme)

    def _hover(self, cell: tk.Label, item_id: str, state: str, entering: bool) -> None:
        """触れている間だけ薄く色を付ける（選択済みの見た目は変えない）."""
        if not self.session:
            return
        row = self.session.rows.get(item_id)
        if row is None or row.result == state or not row.editable:
            return
        cell.config(bg=self.theme.select_bg if entering else self.theme.bg)

    def _click_state(self, item_id: str, state: str) -> None:
        if not self.session:
            return
        self.zone = ZONE_CHECKS
        self.cursor = self.item_ids.index(item_id)
        self.session.set_check(item_id, state, self.session.rows[item_id].defect_code)
        self._update_zone_look()
        self._render_rows()

    def _on_defect_changed(self, item_id: str) -> None:
        if not self.session:
            return
        widgets = self.row_widgets[item_id]
        self.session.set_check(item_id, self.session.rows[item_id].result,
                               widgets["defect"].get())
        self._render_rows()

    def _render_rows(self) -> None:
        """セッションの状態を画面に映す."""
        if not self.session:
            return
        t = self.theme
        colors = {CHECK_OK: (t.ok_fg, t.ok_bg), CHECK_NG: (t.ng_fg, t.ng_bg),
                  CHECK_ASK: (t.ask_fg, t.ask_bg)}
        cursor_item = self._cursor_item()

        for item_id, state in self.session.rows.items():
            widgets = self.row_widgets.get(item_id)
            if not widgets:
                continue
            widgets["row"].config(
                highlightbackground=t.focus if item_id == cursor_item else t.bg
            )
            for value, cell in widgets["cells"].items():
                selected = state.result == value
                fg, bg = colors[value]
                cell.config(
                    bg=bg if selected else t.bg,
                    fg=fg if selected else t.muted,
                    font=self.fonts.heading if selected else self.fonts.base,
                    relief="solid" if selected else "flat",
                    borderwidth=1 if selected else 0,
                )
            widgets["defect"].set(state.defect_code)
            widgets["combo"].config(state="readonly" if state.editable else "disabled")
            # 不備理由は NG のときだけ出す。OK 行に空欄が並ぶと視線が散る
            if state.result == CHECK_NG:
                widgets["combo"].pack(side="left", padx=(6, 0), before=widgets["hint"])
            else:
                widgets["combo"].pack_forget()
            widgets["hint"].config(
                text=(f"{CHECK_SYMBOLS[CHECK_NA]} 判定不能（前提が NG）"
                      if state.result == CHECK_NA else state.hint)
            )

    def _all_ok(self) -> None:
        if self.session:
            self.session.all_ok()
            self._render_rows()

    def _undo(self) -> None:
        if self.session and self.session.undo():
            self._render_documents()
            self._render_rows()

    def _clear_inputs(self) -> None:
        """この案件の入力を消す（Esc）.

        Esc は押し間違えやすいので、入力があるときは確認する。
        消しても Ctrl+Z 一度で元に戻せる。
        """
        if not self.session:
            return
        if self.session.has_input and not messagebox.askyesno(
            WINDOW_TITLE,
            "この案件の入力をすべて消します。よろしいですか？\n\n"
            "（消しても Ctrl+Z で元に戻せます）",
        ):
            return
        self.session.clear()
        self._render_documents()
        self._render_rows()

    # ---------- 作業窓 ----------

    def _open_canvas(self) -> None:
        if not self.current:
            messagebox.showinfo(WINDOW_TITLE, "先に案件を選んでください。")
            return
        if self.canvas_window is None or not self.canvas_window.winfo_exists():
            self.canvas_window = CanvasWindow(
                self, self.fonts, self.theme, self.prefetcher, self._on_markup_saved,
                comparison_options=self._comparison_options(),
                defect_options=self._defect_codes(),
            )
        self.canvas_window.deiconify()
        self.canvas_window.lift()
        self.canvas_window.focus_set()
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
            path = export_comparison(left, right, comparison, out_dir, prefix="cmp",
                                     left_title=left_title, right_title=right_title)
        except (OSError, ValueError) as exc:
            messagebox.showerror(WINDOW_TITLE, f"書き出せませんでした。\n\n{exc}")
            return

        self.store.add_markup(self.current, str(path), comparison=comparison.comparison,
                              defect_code=comparison.defect_code, note=note,
                              mask_status=mask_status)
        self.canvas_window.reset()
        self._refresh_mask_label()
        messagebox.showinfo(
            WINDOW_TITLE,
            f"記録しました。\n\n{path.name}"
            + ("\n\nマスキングは「未」です。持ち出す前に必ず処理してください。"
               if mask_status == MASK_TODO else ""),
        )

    # ---------- 保存・完了 ----------

    def _send_consultation(self) -> None:
        if not self.session:
            return
        reason = simpledialog.askstring(WINDOW_TITLE, "何に迷っているかを書いてください。",
                                        parent=self)
        if not reason:
            return
        self.session.send_to_consultation(reason)
        self._refresh_list()
        messagebox.showinfo(WINDOW_TITLE, "相談へ送りました。管理者の回答を待ちます。")

    def _complete(self) -> None:
        if not self.session:
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

    def _save_and_close(self) -> None:
        """入力は打つそばから保存されているが、明示的に閉じる口も用意しておく."""
        if self.session:
            self.session.save()
        if messagebox.askyesno(
            WINDOW_TITLE,
            "ここまでの入力を保存しました。\n\n"
            "ツールを閉じますか？（次に開くとこの案件から再開します）",
        ):
            self._on_close()

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
        self.store.set_primary(self.current, new_primary,
                               [p for p in choices if p != new_primary])
        self._load_case(self.current)
        self._refresh_list()

    def _on_close(self) -> None:
        if self.session:
            self.session.save()
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
