"""作業状態の永続化（SQLite）.

1 万件を数か月かけて見直すため、中断と再開ができることが必須。
アプリを強制終了しても、次回起動時に同じ位置から続けられるようにする。

判定表（data/*.csv）とは役割が違う。
  判定表   … 管理者が決めた「基準」。可読形式で残す資産
  この DB … 作業の「実績」。誰がいつ何を見て、どう記録したか
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .caselist import Case
from .config import (
    CASE_DONE,
    CASE_PENDING,
    CASE_STATES,
    CASE_WORKING,
    CHECK_STATES,
    MASK_NOT_NEEDED,
    MASK_STATES,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS cases (
    recipient_no    TEXT PRIMARY KEY,
    primary_path    TEXT NOT NULL,
    received_on     TEXT NOT NULL,
    additional_json TEXT NOT NULL DEFAULT '[]',
    clinical_json   TEXT NOT NULL DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT '未着手',
    priority        INTEGER NOT NULL DEFAULT 0,
    memo_ink        REAL,
    worker          TEXT,
    started_at      TEXT,
    completed_at    TEXT
);

CREATE TABLE IF NOT EXISTS case_documents (
    recipient_no TEXT NOT NULL,
    doc_id       TEXT NOT NULL,
    provisional  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (recipient_no, doc_id)
);

CREATE TABLE IF NOT EXISTS check_results (
    recipient_no TEXT NOT NULL,
    item_id      TEXT NOT NULL,
    result       TEXT NOT NULL,
    defect_code  TEXT NOT NULL DEFAULT '',
    note         TEXT NOT NULL DEFAULT '',
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (recipient_no, item_id)
);

CREATE TABLE IF NOT EXISTS markups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_no TEXT NOT NULL,
    item_id      TEXT NOT NULL DEFAULT '',
    image_path   TEXT NOT NULL,
    mask_status  TEXT NOT NULL DEFAULT '不要',
    comparison   TEXT NOT NULL DEFAULT '',
    defect_code  TEXT NOT NULL DEFAULT '',
    note         TEXT NOT NULL DEFAULT '',
    worker       TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consultations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_no TEXT NOT NULL,
    item_id      TEXT NOT NULL DEFAULT '',
    docs_json    TEXT NOT NULL DEFAULT '[]',
    markup_id    INTEGER,
    reason       TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT '未回答',
    answer       TEXT NOT NULL DEFAULT '',
    answered_by  TEXT NOT NULL DEFAULT '',
    answered_at  TEXT,
    worker       TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provisional_docs (
    name            TEXT PRIMARY KEY,
    resolved_doc_id TEXT NOT NULL DEFAULT '',
    worker          TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ts     TEXT NOT NULL,
    worker TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_cases_order   ON cases (priority DESC, received_on, recipient_no);
CREATE INDEX IF NOT EXISTS idx_markups_case  ON markups (recipient_no);
CREATE INDEX IF NOT EXISTS idx_markups_mask  ON markups (mask_status);
CREATE INDEX IF NOT EXISTS idx_consult_state ON consultations (status);
"""

STATUS_UNANSWERED = "未回答"
STATUS_ANSWERED = "回答済"


@dataclass(frozen=True)
class CaseRow:
    recipient_no: str
    primary_path: Path
    received_on: str
    additional: list[str]
    clinical: list[str]
    status: str
    priority: int
    memo_ink: float | None
    worker: str
    started_at: str | None
    completed_at: str | None


class Store:
    """作業 DB。`with Store(path) as store:` で使う."""

    def __init__(self, db_path: Path, worker: str = "") -> None:
        self.db_path = db_path
        self.worker = worker
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        # 強制終了に強くする。1 万件を数か月かけるので、壊れないことを優先する。
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def close(self) -> None:
        self.conn.close()

    @contextmanager
    def _write(self):
        try:
            yield self.conn
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    # ---------- 作業リスト ----------

    def sync_cases(self, cases: list[Case]) -> tuple[int, int]:
        """作業リストを取り込む.

        既にある案件の作業状態は壊さない（再スキャンしても続きから作業できる）。
        戻り値は (新規, 更新)。
        """
        added = updated = 0
        with self._write() as conn:
            for case in cases:
                row = conn.execute(
                    "SELECT recipient_no FROM cases WHERE recipient_no = ?",
                    (case.recipient_no,),
                ).fetchone()
                values = (
                    str(case.primary.path),
                    case.received_on.isoformat(),
                    json.dumps([str(f.path) for f in case.additional], ensure_ascii=False),
                    json.dumps([str(f.path) for f in case.clinical], ensure_ascii=False),
                    case.recipient_no,
                )
                if row:
                    conn.execute(
                        "UPDATE cases SET primary_path=?, received_on=?, "
                        "additional_json=?, clinical_json=? WHERE recipient_no=?",
                        values,
                    )
                    updated += 1
                else:
                    conn.execute(
                        "INSERT INTO cases (primary_path, received_on, additional_json, "
                        "clinical_json, recipient_no) VALUES (?,?,?,?,?)",
                        values,
                    )
                    added += 1
        self.log("作業リスト取込", detail=f"新規 {added} 件 / 更新 {updated} 件")
        return added, updated

    def list_cases(self, status: str | None = None, limit: int | None = None) -> list[CaseRow]:
        """優先度の高い順、次に日付の古い順で返す."""
        sql = "SELECT * FROM cases"
        params: list = []
        if status:
            sql += " WHERE status = ?"
            params.append(status)
        sql += " ORDER BY priority DESC, received_on, recipient_no"
        if limit:
            sql += f" LIMIT {int(limit)}"
        return [_to_case_row(r) for r in self.conn.execute(sql, params)]

    def get_case(self, recipient_no: str) -> CaseRow | None:
        row = self.conn.execute(
            "SELECT * FROM cases WHERE recipient_no = ?", (recipient_no,)
        ).fetchone()
        return _to_case_row(row) if row else None

    def next_pending(self) -> CaseRow | None:
        """次に着手すべき案件（未着手のうち最優先）."""
        rows = self.list_cases(status=CASE_PENDING, limit=1)
        return rows[0] if rows else None

    def set_primary(self, recipient_no: str, primary_path: str, additional: list[str]) -> None:
        """本体を入れ替える（最古が本体とは限らないため）."""
        with self._write() as conn:
            conn.execute(
                "UPDATE cases SET primary_path=?, additional_json=? WHERE recipient_no=?",
                (primary_path, json.dumps(additional, ensure_ascii=False), recipient_no),
            )
        self.log("本体の入替", recipient_no, primary_path)

    def start_case(self, recipient_no: str) -> None:
        with self._write() as conn:
            conn.execute(
                "UPDATE cases SET status=?, worker=?, started_at=COALESCE(started_at, ?) "
                "WHERE recipient_no=?",
                (CASE_WORKING, self.worker, _now(), recipient_no),
            )

    def set_case_status(self, recipient_no: str, status: str) -> None:
        if status not in CASE_STATES:
            raise ValueError(f"作業状態が不正です: {status}")
        completed = _now() if status == CASE_DONE else None
        with self._write() as conn:
            conn.execute(
                "UPDATE cases SET status=?, completed_at=? WHERE recipient_no=?",
                (status, completed, recipient_no),
            )
        self.log(f"状態変更→{status}", recipient_no)

    def set_priority(self, recipient_no: str, priority: int, memo_ink: float | None) -> None:
        with self._write() as conn:
            conn.execute(
                "UPDATE cases SET priority=?, memo_ink=? WHERE recipient_no=?",
                (priority, memo_ink, recipient_no),
            )

    def progress(self) -> dict[str, int]:
        rows = self.conn.execute(
            "SELECT status, COUNT(*) AS n FROM cases GROUP BY status"
        ).fetchall()
        counts = {state: 0 for state in CASE_STATES}
        for row in rows:
            counts[row["status"]] = row["n"]
        counts["合計"] = sum(counts[s] for s in CASE_STATES)
        return counts

    # ---------- 何が届いているか ----------

    def set_documents(self, recipient_no: str, doc_ids: list[str], provisional: set[str] | None = None) -> None:
        provisional = provisional or set()
        with self._write() as conn:
            conn.execute("DELETE FROM case_documents WHERE recipient_no=?", (recipient_no,))
            conn.executemany(
                "INSERT INTO case_documents (recipient_no, doc_id, provisional) VALUES (?,?,?)",
                [(recipient_no, d, int(d in provisional)) for d in doc_ids],
            )

    def get_documents(self, recipient_no: str) -> list[str]:
        return [
            r["doc_id"]
            for r in self.conn.execute(
                "SELECT doc_id FROM case_documents WHERE recipient_no=? ORDER BY doc_id",
                (recipient_no,),
            )
        ]

    # ---------- チェックリスト ----------

    def set_check(
        self, recipient_no: str, item_id: str, result: str,
        defect_code: str = "", note: str = "",
    ) -> None:
        if result not in CHECK_STATES:
            raise ValueError(f"入力状態が不正です: {result}")
        with self._write() as conn:
            conn.execute(
                "INSERT INTO check_results (recipient_no, item_id, result, defect_code, note, updated_at) "
                "VALUES (?,?,?,?,?,?) "
                "ON CONFLICT(recipient_no, item_id) DO UPDATE SET "
                "result=excluded.result, defect_code=excluded.defect_code, "
                "note=excluded.note, updated_at=excluded.updated_at",
                (recipient_no, item_id, result, defect_code, note, _now()),
            )

    def get_checks(self, recipient_no: str) -> dict[str, sqlite3.Row]:
        return {
            r["item_id"]: r
            for r in self.conn.execute(
                "SELECT * FROM check_results WHERE recipient_no=?", (recipient_no,)
            )
        }

    def defect_counts(self) -> list[tuple[str, str, int]]:
        """設問ID × 不備理由コード の件数。論点の頻度分布になる."""
        return [
            (r["item_id"], r["defect_code"], r["n"])
            for r in self.conn.execute(
                "SELECT item_id, defect_code, COUNT(*) AS n FROM check_results "
                "WHERE result = 'NG' GROUP BY item_id, defect_code "
                "ORDER BY n DESC, item_id"
            )
        ]

    # ---------- マークアップとマスキング ----------

    def add_markup(
        self, recipient_no: str, image_path: str, item_id: str = "",
        comparison: str = "", defect_code: str = "", note: str = "",
        mask_status: str = MASK_NOT_NEEDED,
    ) -> int:
        if mask_status not in MASK_STATES:
            raise ValueError(f"マスキング状態が不正です: {mask_status}")
        with self._write() as conn:
            cur = conn.execute(
                "INSERT INTO markups (recipient_no, item_id, image_path, mask_status, "
                "comparison, defect_code, note, worker, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (recipient_no, item_id, image_path, mask_status, comparison,
                 defect_code, note, self.worker, _now()),
            )
        return int(cur.lastrowid)

    def set_mask_status(self, markup_id: int, status: str) -> None:
        if status not in MASK_STATES:
            raise ValueError(f"マスキング状態が不正です: {status}")
        with self._write() as conn:
            conn.execute("UPDATE markups SET mask_status=? WHERE id=?", (status, markup_id))
        self.log(f"マスキング状態→{status}", f"markup:{markup_id}")

    def list_markups(self, recipient_no: str | None = None, mask_status: str | None = None) -> list[sqlite3.Row]:
        sql, params = "SELECT * FROM markups", []
        where = []
        if recipient_no:
            where.append("recipient_no=?")
            params.append(recipient_no)
        if mask_status:
            where.append("mask_status=?")
            params.append(mask_status)
        if where:
            sql += " WHERE " + " AND ".join(where)
        return list(self.conn.execute(sql + " ORDER BY id", params))

    def count_mask_todo(self) -> int:
        """マスキング「未」の件数.

        **1 件でも残っていたら持ち出してはならない。** 画面に常時表示する。
        """
        row = self.conn.execute(
            "SELECT COUNT(*) AS n FROM markups WHERE mask_status='未'"
        ).fetchone()
        return int(row["n"])

    # ---------- 相談キュー ----------

    def add_consultation(
        self, recipient_no: str, item_id: str, doc_ids: list[str],
        reason: str, markup_id: int | None = None,
    ) -> int:
        with self._write() as conn:
            cur = conn.execute(
                "INSERT INTO consultations (recipient_no, item_id, docs_json, markup_id, "
                "reason, worker, created_at) VALUES (?,?,?,?,?,?,?)",
                (recipient_no, item_id, json.dumps(doc_ids, ensure_ascii=False),
                 markup_id, reason, self.worker, _now()),
            )
        self.log("相談へ送付", recipient_no, f"{item_id}: {reason}")
        return int(cur.lastrowid)

    def list_consultations(self, status: str | None = STATUS_UNANSWERED) -> list[sqlite3.Row]:
        sql = "SELECT * FROM consultations"
        params: list = []
        if status:
            sql += " WHERE status=?"
            params.append(status)
        return list(self.conn.execute(sql + " ORDER BY id", params))

    def answer_consultation(self, consultation_id: int, answer: str, answered_by: str) -> None:
        with self._write() as conn:
            conn.execute(
                "UPDATE consultations SET status=?, answer=?, answered_by=?, answered_at=? WHERE id=?",
                (STATUS_ANSWERED, answer, answered_by, _now(), consultation_id),
            )
        self.log("相談に回答", f"consultation:{consultation_id}", answer)

    # ---------- 仮登録の書類 ----------

    def add_provisional_doc(self, name: str) -> None:
        """一覧に無い書類。**確定するまで判定に使わない。**"""
        with self._write() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO provisional_docs (name, worker, created_at) VALUES (?,?,?)",
                (name, self.worker, _now()),
            )
        self.log("書類を仮登録", name)

    def list_provisional_docs(self, unresolved_only: bool = True) -> list[sqlite3.Row]:
        sql = "SELECT * FROM provisional_docs"
        if unresolved_only:
            sql += " WHERE resolved_doc_id = ''"
        return list(self.conn.execute(sql + " ORDER BY created_at"))

    def resolve_provisional_doc(self, name: str, doc_id: str) -> None:
        with self._write() as conn:
            conn.execute(
                "UPDATE provisional_docs SET resolved_doc_id=? WHERE name=?", (doc_id, name)
            )
        self.log("仮登録を確定", name, doc_id)

    # ---------- 監査 ----------

    def log(self, action: str, target: str = "", detail: str = "") -> None:
        with self._write() as conn:
            conn.execute(
                "INSERT INTO audit_log (ts, worker, action, target, detail) VALUES (?,?,?,?,?)",
                (_now(), self.worker, action, target, detail),
            )

    def recent_log(self, limit: int = 50) -> list[sqlite3.Row]:
        return list(
            self.conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,))
        )


def _to_case_row(row: sqlite3.Row) -> CaseRow:
    return CaseRow(
        recipient_no=row["recipient_no"],
        primary_path=Path(row["primary_path"]),
        received_on=row["received_on"],
        additional=json.loads(row["additional_json"]),
        clinical=json.loads(row["clinical_json"]),
        status=row["status"],
        priority=row["priority"],
        memo_ink=row["memo_ink"],
        worker=row["worker"] or "",
        started_at=row["started_at"],
        completed_at=row["completed_at"],
    )


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")
