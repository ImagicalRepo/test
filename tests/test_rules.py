"""判定エンジンの検証.

実データ（data/*.csv）に対して、業務上ありうる入力で期待どおりの
判定が出るかを確認する。未決定論点が黙って OK / NG に倒れないことが要点。
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from shinsa.config import RESULT_ASK, RESULT_NG, RESULT_OK  # noqa: E402
from shinsa.rules import RuleSet, combine  # noqa: E402

RULES = RuleSet.load(ROOT / "data")


def check(label, actual, expected):
    ok = actual == expected
    print(f"{'PASS' if ok else 'FAIL'}  {label}: {actual} (期待 {expected})")
    return ok


def main() -> int:
    problems = RULES.validate()
    print("=== CSV 検証 ===")
    for p in problems:
        print("  問題:", p)
    print(f"  問題 {len(problems)} 件\n")

    results = []

    print("=== 単独判定（書3-1 医療保険資料）===")
    for docs, expected, label in [
        (["資格確認書"], RESULT_OK, "資格確認書のみ"),
        (["資格情報のお知らせ"], RESULT_OK, "資格情報のお知らせのみ"),
        (["マイナポータル保険PDF"], RESULT_OK, "マイナポータル保険PDFのみ"),
        (["旧被保険者証"], RESULT_NG, "旧被保険者証のみ"),
        (["高齢受給者証"], RESULT_NG, "高齢受給者証のみ"),
        (["保険者医療費一覧"], RESULT_NG, "保険者医療費一覧のみ"),
        (["高齢受給者証", "旧被保険者証"], RESULT_NG, "NG書類を2点提出"),
        (["資格確認書", "高齢受給者証"], RESULT_OK, "有効書類が1点でもあれば OK"),
        (["未提出"], RESULT_NG, "未提出"),
        ([], RESULT_ASK, "未入力"),
        (["システム画面"], RESULT_ASK, "代用条件が未決定のもの"),
        (["管理票"], RESULT_ASK, "この設問に未登録の書類"),
    ]:
        j = RULES.judge_single("書3-1", docs)
        results.append(check(label, j.result, expected))

    print("\n=== 単独・組合せ判定（書4-1 上限額管理票）===")
    for docs, expected, label in [
        (["管理票"], RESULT_OK, "管理票"),
        (["領収書"], RESULT_OK, "領収書"),
        (["マイナポータル医療費"], RESULT_NG, "マイナポータル医療費のみ（組合せ規則 C001）"),
        (["マイナポータル医療費", "管理票"], RESULT_OK, "医療費データ＋管理票"),
    ]:
        j = RULES.judge_single("書4-1", docs)
        results.append(check(label, j.result, expected))

    print("\n=== 突合判定（書3-2）===")
    for field, mismatched, expected, label in [
        ("記号番号", [], RESULT_OK, "記号番号すべて一致"),
        ("記号番号", ["資格確認書"], RESULT_ASK, "記号番号が不一致"),
        ("枝番", [], RESULT_OK, "枝番すべて一致"),
        ("枝番", ["資格確認書"], RESULT_ASK, "枝番のみ相違（★未決定論点）"),
        ("枝番", ["資格確認書", "中サバ照会"], RESULT_ASK, "枝番が2点不一致"),
        ("保険者番号", ["資格確認書"], RESULT_ASK, "判定表に未登録の比較項目"),
    ]:
        j = RULES.judge_match("書3-2", field, mismatched)
        results.append(check(label, j.result, expected))

    print("\n=== 複数判定の統合（相談 > NG > OK）===")
    j_ok = RULES.judge_match("書3-2", "記号番号", [])
    j_ask = RULES.judge_match("書3-2", "枝番", ["資格確認書"])
    j_ng = RULES.judge_single("書3-1", ["高齢受給者証"])
    results.append(check("OK と 相談 → 相談", combine([j_ok, j_ask]).result, RESULT_ASK))
    results.append(check("OK と NG → NG", combine([j_ok, j_ng]).result, RESULT_NG))
    results.append(check("NG と 相談 → 相談", combine([j_ng, j_ask]).result, RESULT_ASK))

    print("\n=== 理由と記入方法が必ず付くこと ===")
    j = RULES.judge_single("書3-1", ["高齢受給者証"])
    results.append(check("NG に理由がある", bool(j.reason), True))
    results.append(check("NG に記入方法がある", bool(j.entry_method), True))
    print(f"  理由    : {j.reason}")
    print(f"  記入方法: {j.entry_method}")
    print(f"  出典    : {j.source}")

    passed, total = sum(results), len(results)
    print(f"\n結果: {passed}/{total} 件 合格")
    base_ok = passed == total and not problems
    return 0 if base_ok and test_extensions() == 0 else 1



def simulate_matrix(rules, item_id, cells: dict[tuple[str, str], str]):
    """app_b の突合マトリクス集約を GUI 無しで再現する（検証用）."""
    from shinsa.config import MATCH_DIFF, MATCH_NA

    mismatched: dict[str, list[str]] = {}
    touched: set[str] = set()
    for (field_name, doc_id), state in cells.items():
        if not state or state == MATCH_NA:
            continue
        touched.add(field_name)
        if state == MATCH_DIFF:
            mismatched.setdefault(field_name, []).append(doc_id or "不一致あり")
    judgements = [
        rules.judge_match(item_id, f, sorted(mismatched.get(f, []))) for f in sorted(touched)
    ]
    return combine(judgements) if judgements else None


def test_extensions() -> int:
    """依存関係・不備理由・仮登録の検証（後から追加した機能）."""
    from shinsa.config import RESULT_NG

    print("\n=== ツール対象の設問 ===")
    results = []
    items = [r["設問ID"] for r in RULES.tool_items()]
    results.append(check("入力対象は14問", len(items), 14))
    results.append(check("臨個票の欄は除外", [i for i in items if i.startswith("書2")], []))
    results.append(check("表示順の先頭", items[0], "書1-1"))

    print("\n=== 設問の依存関係 ===")
    results.append(check("書3-1 の従属", sorted(RULES.dependents("書3-1")), ["書3-2", "書3-3"]))
    results.append(
        check("書4-1 の従属", sorted(RULES.dependents("書4-1")), ["書4-2", "書4-3", "書4d-2", "書4d-3"])
    )
    results.append(check("従属の無い設問", RULES.dependents("書1-1"), []))
    results.append(
        check("書3-1 が NG → 判定不能", sorted(RULES.unanswerable({"書3-1"})), ["書3-2", "書3-3"])
    )
    results.append(
        check(
            "複数 NG をまとめて解決",
            sorted(RULES.unanswerable({"書3-1", "書4-1"})),
            ["書3-2", "書3-3", "書4-2", "書4-3", "書4d-2", "書4d-3"],
        )
    )
    results.append(check("NG が無ければ空", RULES.unanswerable(set()), set()))

    print("\n=== 不備理由コード ===")
    for docs, expected_code, label in [
        (["未提出"], "未提出", "未提出"),
        (["高齢受給者証"], "無効書類", "無効書類（保険証などを出してきた場合）"),
        (["旧被保険者証"], "無効書類", "旧被保険者証"),
    ]:
        j = RULES.judge_single("書3-1", docs)
        results.append(check(label, (j.result, j.defect_code), (RESULT_NG, expected_code)))
    j_ok = RULES.judge_single("書3-1", ["資格確認書"])
    results.append(check("OK には不備理由が付かない", j_ok.defect_code, ""))

    print("\n=== 仮登録の書類は必ず相談 ===")
    RULES.doc_types["見たことない通知書"] = {
        "書類ID": "見たことない通知書", "表示名": "見たことない通知書", "仮登録": "○",
    }
    RULES.single[("書3-1", "見たことない通知書")] = {
        "設問ID": "書3-1", "書類ID": "見たことない通知書", "区分": "有効",
        "理由": "（仮）", "記入方法": "", "不備理由": "",
    }
    j = RULES.judge_single("書3-1", ["見たことない通知書"])
    results.append(check("有効と書いてあっても相談", j.result, RESULT_ASK))
    j = RULES.judge_single("書3-1", ["資格確認書", "見たことない通知書"])
    results.append(check("正規の書類と混在でも相談", j.result, RESULT_ASK))

    passed, total = sum(results), len(results)
    print(f"\n追加分の結果: {passed}/{total} 件 合格")
    return 0 if passed == total else 1

if __name__ == "__main__":
    raise SystemExit(main())
