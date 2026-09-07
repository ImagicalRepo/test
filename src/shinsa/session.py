"""1 件の見直し作業の状態と判断.

画面から切り離してあるので、tkinter なしで検証できる。
チェックリストの自動判定と依存関係の解決という、この道具の核心がここにある。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .config import (
    CASE_CONSULT, CASE_DONE, CHECK_ASK, CHECK_BLANK, CHECK_NA, CHECK_NG, CHECK_OK,
    RESULT_ASK, RESULT_NG, RESULT_OK,
)
from .rules import Judgement, RuleSet
from .store import Store

# 判定エンジンの結果を、チェックリストの入力状態に読み替える
RESULT_TO_CHECK = {RESULT_OK: CHECK_OK, RESULT_NG: CHECK_NG, RESULT_ASK: CHECK_ASK}


@dataclass
class RowState:
    """チェックリスト 1 行の状態."""

    item_id: str
    result: str = CHECK_BLANK
    defect_code: str = ""
    hint: str = ""          # 判定表が示した候補
    editable: bool = True   # 判定不能のときは入力させない


@dataclass
class ReviewSession:
    """開いている 1 件."""

    rules: RuleSet
    store: Store
    recipient_no: str
    documents: set[str] = field(default_factory=set)
    rows: dict[str, RowState] = field(default_factory=dict)
    touched: set[str] = field(default_factory=set)  # 人が手で変えた設問

    @classmethod
    def open(cls, rules: RuleSet, store: Store, recipient_no: str) -> "ReviewSession":
        store.start_case(recipient_no)
        session = cls(rules=rules, store=store, recipient_no=recipient_no)
        session.documents = set(store.get_documents(recipient_no))

        saved = store.get_checks(recipient_no)
        for item in rules.tool_items():
            item_id = item["設問ID"]
            row = saved.get(item_id)
            session.rows[item_id] = RowState(
                item_id=item_id,
                result=row["result"] if row else CHECK_BLANK,
                defect_code=row["defect_code"] if row else "",
            )
            if row and row["result"] != CHECK_BLANK:
                session.touched.add(item_id)  # 保存済みの入力を自動判定で消さない
        session.refresh()
        return session

    # ---------- 入力 ----------

    def set_documents(self, doc_ids: set[str]) -> None:
        self.documents = set(doc_ids)
        self.refresh()

    def set_check(self, item_id: str, result: str, defect_code: str = "") -> None:
        row = self.rows.get(item_id)
        if row is None or not row.editable:
            return
        row.result = result
        row.defect_code = defect_code
        self.touched.add(item_id)
        self._apply_dependencies()

    def all_ok(self) -> None:
        """判定表が答えを持たない設問を、まとめて OK にする.

        大半の案件はこれ 1 回で終わる。速度の要。

        **判定表が決める設問には手を出さない。** 書類から機械的に決まるものを
        人の一括操作で塗り潰すと、判定表と食い違ったまま完了できてしまう。
        """
        for item_id, row in self.rows.items():
            if self.judge(item_id) is not None:
                continue
            row.result = CHECK_OK
            row.defect_code = ""
            self.touched.add(item_id)
        self._apply_dependencies()

    # ---------- 判定 ----------

    def refresh(self) -> None:
        self._apply_judgements()
        self._apply_dependencies()

    def judge(self, item_id: str) -> Judgement | None:
        """その設問に判定表があるなら、いまの書類での判定を返す.

        **その設問に関係する書類だけを渡す。** 医療保険資料の設問に管理票の有無は
        関係しないので、全部渡すと「登録のない書類」と見なされて相談に倒れてしまう。
        関係する書類が 1 つも選ばれていなければ、その設問については未提出とみなす。
        """
        if not self.rules.docs_for_item(item_id):
            return None

        # 仮登録が混ざっているときは、どの設問も判定できない
        if any(self.rules.is_provisional(d) for d in self.documents):
            return self.rules.judge_single(item_id, sorted(self.documents))

        relevant = self.documents & self.rules.relevant_docs(item_id)
        if not relevant:
            if (item_id, "未提出") not in self.rules.single:
                return None
            relevant = {"未提出"}
        return self.rules.judge_single(item_id, sorted(relevant))

    def _apply_judgements(self) -> None:
        """選ばれた書類から候補を出し、人が触っていない設問に反映する."""
        for item_id, row in self.rows.items():
            judgement = self.judge(item_id)
            if judgement is None:
                row.hint = ""
                continue
            row.hint = f"判定表: {judgement.result}" + (
                f"（{judgement.defect_code}）" if judgement.defect_code else ""
            )
            if item_id in self.touched:
                continue
            row.result = RESULT_TO_CHECK.get(judgement.result, CHECK_BLANK)
            row.defect_code = judgement.defect_code

    def _apply_dependencies(self) -> None:
        """前提が NG の設問を「判定不能」にして、入力を求めない.

        空欄の正体はこれ。未確認とは意味が違う。
        """
        ng_items = {i for i, r in self.rows.items() if r.result == CHECK_NG}
        blocked = self.rules.unanswerable(ng_items)
        for item_id, row in self.rows.items():
            if item_id in blocked:
                row.result = CHECK_NA
                row.defect_code = ""
                row.editable = False
                row.hint = "判定不能（前提の設問が NG）"
            else:
                row.editable = True
                if row.result == CHECK_NA:
                    row.result = CHECK_BLANK

    # ---------- 状態の問い合わせ ----------

    @property
    def blank_items(self) -> list[str]:
        return [i for i, r in self.rows.items() if r.result == CHECK_BLANK]

    @property
    def ask_items(self) -> list[str]:
        return [i for i, r in self.rows.items() if r.result == CHECK_ASK]

    @property
    def needs_consultation(self) -> bool:
        return bool(self.ask_items)

    # ---------- 保存 ----------

    def save(self) -> None:
        self.store.set_documents(
            self.recipient_no,
            sorted(self.documents),
            provisional={d for d in self.documents if self.rules.is_provisional(d)},
        )
        for item_id, row in self.rows.items():
            self.store.set_check(self.recipient_no, item_id, row.result, row.defect_code)

    def complete(self) -> None:
        self.save()
        self.store.set_case_status(self.recipient_no, CASE_DONE)

    def send_to_consultation(self, reason: str) -> int:
        self.save()
        asked = self.ask_items
        consultation_id = self.store.add_consultation(
            self.recipient_no, asked[0] if asked else "", sorted(self.documents), reason
        )
        self.store.set_case_status(self.recipient_no, CASE_CONSULT)
        return consultation_id
