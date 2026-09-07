"""定数と既定パス.

exe 化後は sys.executable のあるフォルダを基準にする。
開発時（.py 実行）はリポジトリのルートを基準にする。
"""
from __future__ import annotations

import sys
from pathlib import Path

# CSV は Excel で開く前提のため BOM 付き UTF-8 で統一する。
# BOM がないと日本語が文字化けする。
CSV_ENCODING = "utf-8-sig"

# 判定結果。優先順位は 相談 > NG > OK。
# 未登録の組み合わせは必ず相談に倒す（安全側）。
RESULT_OK = "OK"
RESULT_NG = "NG"
RESULT_ASK = "相談"

RESULT_PRIORITY = {RESULT_OK: 0, RESULT_NG: 1, RESULT_ASK: 2}

RESULT_LABEL = {
    RESULT_OK: "OK（不備としない）",
    RESULT_NG: "NG（不備とする）",
    RESULT_ASK: "管理者に相談",
}

# 突合で各書類に付ける状態
MATCH_SAME = "一致"
MATCH_DIFF = "不一致"
MATCH_NA = "確認不可"

# チェックリストの入力状態。判定エンジンの「判定結果」とは別物なので分けて持つ。
CHECK_OK = "OK"
CHECK_NG = "NG"
CHECK_NA = "判定不能"   # 前提の設問が NG で、論理的に判定できない（空欄の正体）
CHECK_ASK = "要相談"
CHECK_BLANK = ""        # 未入力

CHECK_STATES = (CHECK_OK, CHECK_NG, CHECK_NA, CHECK_ASK, CHECK_BLANK)

# マスキングの状態。既定は「不要」（端末内に置くだけなら加工は要らない）。
MASK_NOT_NEEDED = "不要"
MASK_TODO = "未"
MASK_DONE = "済"

MASK_STATES = (MASK_NOT_NEEDED, MASK_TODO, MASK_DONE)

# 案件の作業状態
CASE_PENDING = "未着手"
CASE_WORKING = "作業中"
CASE_CONSULT = "相談中"
CASE_DONE = "完了"

CASE_STATES = (CASE_PENDING, CASE_WORKING, CASE_CONSULT, CASE_DONE)


def app_dir() -> Path:
    """exe 実行時は exe の隣、開発時はリポジトリルートを返す."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    return app_dir() / "data"
