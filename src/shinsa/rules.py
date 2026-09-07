"""判定ロジック.

判定の中身は exe に埋め込まず、すべて CSV に持つ。理由は 3 つ。

1. 管理者が Excel で直接編集でき、再ビルドが要らない（配布が DVD のため重要）
2. 可読形式で残るので、exe が動かなくなっても内容が読める（契約終了後の資産）
3. 「決定を記録すること」自体が本プロジェクトの成果物であり、CSV がその器になる

登録のない組み合わせは必ず「管理者に相談」を返す。黙って OK を返してはならない。
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path

from .config import (
    CSV_ENCODING,
    RESULT_ASK,
    RESULT_NG,
    RESULT_OK,
    RESULT_PRIORITY,
)

VALID_RESULTS = {RESULT_OK, RESULT_NG, RESULT_ASK}

# 単独判定表の「区分」列に書ける値
KIND_VALID = "有効"
KIND_INVALID = "無効"
KIND_ASK = "要相談"
VALID_KINDS = {KIND_VALID, KIND_INVALID, KIND_ASK}

# 突合表の「不一致書類」列に書けるワイルドカード
ANY_MISMATCH = "*"

SEP = "|"

FILE_DOC_TYPES = "書類種別.csv"
FILE_SINGLE = "判定_単独.csv"
FILE_COMBO = "判定_組合せ.csv"
FILE_MATCH = "判定_突合.csv"
FILE_ITEMS = "チェックリスト設問.csv"


@dataclass(frozen=True)
class Judgement:
    """1 回の判定結果。理由と記入方法を必ず伴う."""

    result: str
    reason: str
    entry_method: str
    source: str  # どの行が効いたか（追跡用）

    @property
    def is_ask(self) -> bool:
        return self.result == RESULT_ASK


@dataclass
class RuleSet:
    doc_types: dict[str, dict] = field(default_factory=dict)
    checklist_items: dict[str, dict] = field(default_factory=dict)
    single: dict[tuple[str, str], dict] = field(default_factory=dict)
    combo: list[dict] = field(default_factory=list)
    match: dict[tuple[str, str, str], dict] = field(default_factory=dict)

    # ---------- 読み込み ----------

    @classmethod
    def load(cls, data_dir: Path) -> "RuleSet":
        rs = cls()
        for row in _read_csv(data_dir / FILE_DOC_TYPES):
            rs.doc_types[row["書類ID"]] = row
        for row in _read_csv(data_dir / FILE_ITEMS):
            rs.checklist_items[row["設問ID"]] = row
        for row in _read_csv(data_dir / FILE_SINGLE):
            rs.single[(row["設問ID"], row["書類ID"])] = row
        rs.combo = sorted(
            _read_csv(data_dir / FILE_COMBO),
            key=lambda r: _as_int(r.get("優先度"), 999),
        )
        for row in _read_csv(data_dir / FILE_MATCH):
            key = (row["設問ID"], row["比較項目"], _normalize_set(row["不一致書類"]))
            rs.match[key] = row
        return rs

    # ---------- 検証 ----------

    def validate(self) -> list[str]:
        """管理者が手で編集する前提のため、起動時に必ず点検する."""
        problems: list[str] = []

        for (item, doc), row in self.single.items():
            if row["区分"] not in VALID_KINDS:
                problems.append(
                    f"{FILE_SINGLE}: 設問 {item} / 書類 {doc} の区分 '{row['区分']}' が不正です"
                    f"（{'／'.join(sorted(VALID_KINDS))} のいずれか）"
                )
            if doc not in self.doc_types:
                problems.append(f"{FILE_SINGLE}: 未登録の書類ID '{doc}' が使われています")
            if item not in self.checklist_items:
                problems.append(f"{FILE_SINGLE}: 未登録の設問ID '{item}' が使われています")
            if not row.get("理由", "").strip():
                problems.append(f"{FILE_SINGLE}: 設問 {item} / 書類 {doc} の理由が空です")

        for row in self.combo:
            if row["判定"] not in VALID_RESULTS:
                problems.append(f"{FILE_COMBO}: 判定 '{row['判定']}' が不正です（{row.get('規則ID')}）")
            for doc in _split(row.get("必要書類")) + _split(row.get("除外書類")):
                if doc not in self.doc_types:
                    problems.append(f"{FILE_COMBO}: 未登録の書類ID '{doc}'（{row.get('規則ID')}）")

        for (item, field_name, _), row in self.match.items():
            if row["判定"] not in VALID_RESULTS:
                problems.append(
                    f"{FILE_MATCH}: 設問 {item} / 項目 {field_name} の判定 '{row['判定']}' が不正です"
                )

        return problems

    # ---------- 判定 ----------

    def judge_single(self, item_id: str, doc_ids: list[str]) -> Judgement:
        """提出書類の種別から判定する.

        組合せ規則を先に見る。該当がなければ既定の集合ロジックに落とす。
        既定の集合ロジック:
          - 未登録の書類が 1 つでも含まれる → 相談
          - 「要相談」の書類が含まれる       → 相談
          - 「有効」が 1 つ以上ある          → OK
          - すべて「無効」                   → NG
        """
        selected = set(doc_ids)

        combo = self._match_combo(item_id, selected)
        if combo is not None:
            return combo

        if not selected:
            return Judgement(
                RESULT_ASK,
                "提出書類が 1 つも選択されていません。",
                "",
                "（入力なし）",
            )

        unknown = sorted(d for d in selected if (item_id, d) not in self.single)
        if unknown:
            return Judgement(
                RESULT_ASK,
                f"判定表に登録のない書類です: {', '.join(self._label(d) for d in unknown)}。"
                "管理者に相談し、決定を判定表へ追加してください。",
                "",
                f"{FILE_SINGLE}（該当行なし）",
            )

        rows = [self.single[(item_id, d)] for d in sorted(selected)]

        ask_rows = [r for r in rows if r["区分"] == KIND_ASK]
        if ask_rows:
            return self._from_row(ask_rows[0], RESULT_ASK, FILE_SINGLE)

        valid_rows = [r for r in rows if r["区分"] == KIND_VALID]
        if valid_rows:
            return self._from_row(valid_rows[0], RESULT_OK, FILE_SINGLE)

        return self._from_row(rows[0], RESULT_NG, FILE_SINGLE)

    def judge_match(
        self, item_id: str, field_name: str, mismatched_docs: list[str]
    ) -> Judgement:
        """突合の結果から判定する.

        基準書類方式。パターンを全列挙せず、「基準に対してどの書類が不一致か」
        の集合で引く。完全一致の行がなければワイルドカード行、それも無ければ相談。
        """
        key_exact = (item_id, field_name, _normalize_set(SEP.join(mismatched_docs)))
        if key_exact in self.match:
            row = self.match[key_exact]
            return self._from_row(row, row["判定"], FILE_MATCH)

        if mismatched_docs:
            key_any = (item_id, field_name, ANY_MISMATCH)
            if key_any in self.match:
                row = self.match[key_any]
                return self._from_row(row, row["判定"], FILE_MATCH)

        return Judgement(
            RESULT_ASK,
            f"「{field_name}」のこの不一致パターンは判定表に登録がありません。"
            "管理者に相談し、決定を判定表へ追加してください。",
            "",
            f"{FILE_MATCH}（該当行なし）",
        )

    # ---------- 補助 ----------

    def _match_combo(self, item_id: str, selected: set[str]) -> Judgement | None:
        for row in self.combo:
            if row["設問ID"] != item_id:
                continue
            required = set(_split(row.get("必要書類")))
            excluded = set(_split(row.get("除外書類")))
            if required <= selected and not (excluded & selected):
                return self._from_row(row, row["判定"], FILE_COMBO)
        return None

    def _from_row(self, row: dict, result: str, source_file: str) -> Judgement:
        return Judgement(
            result=result,
            reason=row.get("理由", "").strip(),
            entry_method=row.get("記入方法", "").strip(),
            source=f"{source_file} / {row.get('規則ID') or row.get('書類ID') or ''}",
        )

    def _label(self, doc_id: str) -> str:
        row = self.doc_types.get(doc_id)
        return row["表示名"] if row else doc_id

    def docs_for_item(self, item_id: str) -> list[dict]:
        """ある設問で選択肢に出す書類の一覧（画面の並び順）."""
        ids = [doc for (item, doc) in self.single if item == item_id]
        rows = [self.doc_types[d] for d in ids if d in self.doc_types]
        return sorted(rows, key=lambda r: _as_int(r.get("表示順"), 999))

    def match_fields(self, item_id: str) -> list[str]:
        """ある設問で突合する比較項目の一覧."""
        seen = []
        for item, field_name, _ in self.match:
            if item == item_id and field_name not in seen:
                seen.append(field_name)
        return seen

    def match_docs(self, item_id: str) -> list[str]:
        """突合マトリクスの列（基準書類と比べる相手）.

        判定表の「対象書類」列から集める。未記入なら空を返し、
        画面は比較項目ごとの 一致／不一致 だけの簡易表示に落ちる。
        """
        docs: list[str] = []
        for (item, _, _), row in self.match.items():
            if item != item_id:
                continue
            for doc in _split(row.get("対象書類")):
                if doc not in docs:
                    docs.append(doc)
        return docs

    def match_base_doc(self, item_id: str) -> str:
        """突合の基準書類（正とみなすもの）."""
        for (item, _, _), row in self.match.items():
            if item == item_id and row.get("基準書類"):
                return row["基準書類"]
        return ""


def combine(judgements: list[Judgement]) -> Judgement:
    """複数の判定を束ねる。相談 > NG > OK の順で強い方を採る.

    「相談」を最優先にするのは、未解決のものを黙って NG に倒さないため。
    """
    if not judgements:
        return Judgement(RESULT_ASK, "判定結果がありません。", "", "")
    return max(judgements, key=lambda j: RESULT_PRIORITY[j.result])


def _read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding=CSV_ENCODING, newline="") as f:
        return [
            {(k or "").strip(): (v or "").strip() for k, v in row.items()}
            for row in csv.DictReader(f)
            # 空行と、先頭が # のコメント行を読み飛ばす
            if any((v or "").strip() for v in row.values())
            and not (list(row.values())[0] or "").startswith("#")
        ]


def _split(value: str | None) -> list[str]:
    return [v.strip() for v in (value or "").split(SEP) if v.strip()]


def _normalize_set(value: str | None) -> str:
    """不一致書類の集合を、順序に依存しない比較用の文字列にする."""
    if (value or "").strip() == ANY_MISMATCH:
        return ANY_MISMATCH
    return SEP.join(sorted(_split(value)))


def _as_int(value, default: int) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default
