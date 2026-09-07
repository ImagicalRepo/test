"""見直し作業の流れの検証（画面なし）.

この道具の核心は 2 つ。
  ・書類を選ぶと判定表から候補が入り、手で直したものは上書きされない
  ・前提が NG の設問は「判定不能」になり、入力を求められない
"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from shinsa.caselist import build_cases, scan_folder  # noqa: E402
from shinsa.config import (  # noqa: E402
    CASE_CONSULT, CASE_DONE, CHECK_ASK, CHECK_BLANK, CHECK_NA, CHECK_NG, CHECK_OK,
)
from shinsa.rules import RuleSet  # noqa: E402
from shinsa.session import ReviewSession  # noqa: E402
from shinsa.store import Store  # noqa: E402


def check(label, actual, expected):
    ok = actual == expected
    print(f"{'PASS' if ok else 'FAIL'}  {label}: {actual!r} (期待 {expected!r})")
    return ok


def main() -> int:
    results = []
    rules = RuleSet.load(ROOT / "data")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for name in ["01A1111111A001_20260601_1.pdf", "01A2222222A001_20260602_1.pdf"]:
            (root / name).write_bytes(b"%PDF-1.4\n")
        parsed, _ = scan_folder(root)
        store = Store(root / "作業.db", worker="ペアA")
        store.sync_cases(build_cases(parsed))

        print("=== 有効な書類を選ぶ ===")
        session = ReviewSession.open(rules, store, "1111111")
        results.append(check("入力対象は14問", len(session.rows), 14))
        session.set_documents({"資格確認書"})
        results.append(check("書3-1 は OK", session.rows["書3-1"].result, CHECK_OK))
        results.append(check("書3-2 は入力できる", session.rows["書3-2"].editable, True))
        results.append(check("判定表の候補が出る", "判定表: OK" in session.rows["書3-1"].hint, True))

        print("\n=== 無効な書類だけを選ぶ（保険証などのパターン）===")
        session.set_documents({"高齢受給者証"})
        results.append(check("書3-1 は NG", session.rows["書3-1"].result, CHECK_NG))
        results.append(check("不備理由が入る", session.rows["書3-1"].defect_code, "無効書類"))
        results.append(check("書3-2 は判定不能", session.rows["書3-2"].result, CHECK_NA))
        results.append(check("書3-3 も判定不能", session.rows["書3-3"].result, CHECK_NA))
        results.append(check("判定不能は入力させない", session.rows["書3-2"].editable, False))
        results.append(
            check("理由が示される", session.rows["書3-2"].hint, "判定不能（前提の設問が NG）")
        )

        print("\n=== 未提出と無効書類を区別する ===")
        session.set_documents({"未提出"})
        results.append(check("不備理由が変わる", session.rows["書3-1"].defect_code, "未提出"))

        print("\n=== 判定不能の設問は手で変えられない ===")
        session.set_documents({"高齢受給者証"})
        session.set_check("書3-2", CHECK_OK)
        results.append(check("変更が拒否される", session.rows["書3-2"].result, CHECK_NA))

        print("\n=== 前提を直すと判定不能が解ける ===")
        session.set_documents({"資格確認書"})
        results.append(check("書3-2 が空欄に戻る", session.rows["書3-2"].result, CHECK_BLANK))
        results.append(check("入力できる", session.rows["書3-2"].editable, True))

        print("\n=== 設問ごとに関係する書類だけで判定する ===")
        session.set_documents({"資格確認書"})
        results.append(check("書3-1 は OK", session.rows["書3-1"].result, CHECK_OK))
        results.append(
            check("管理票の設問は巻き込まれない", session.rows["書4-1"].result != CHECK_ASK, True)
        )
        results.append(check("管理票は未提出とみなす", session.rows["書4-1"].defect_code, "未提出"))

        session.set_documents({"資格確認書", "管理票"})
        results.append(check("管理票を選べば OK", session.rows["書4-1"].result, CHECK_OK))
        results.append(check("医療保険側は変わらない", session.rows["書3-1"].result, CHECK_OK))

        print("\n=== すべて OK（速度の要）===")
        session.all_ok()
        judged = {i for i in session.rows if session.judge(i) is not None}
        others = {r.result for i, r in session.rows.items() if i not in judged}
        results.append(check("判定表の無い設問は OK になる", others, {CHECK_OK}))
        results.append(check("判定表の設問はそのまま", session.rows["書3-1"].result, CHECK_OK))
        results.append(check("未入力なし", session.blank_items, []))

        print("\n=== すべて OK は判定表を塗り潰さない ===")
        session.set_documents({"高齢受給者証", "管理票"})
        session.all_ok()
        results.append(check("NG は NG のまま", session.rows["書3-1"].result, CHECK_NG))
        results.append(check("判定不能も守られる", session.rows["書3-2"].result, CHECK_NA))

        print("\n=== 手で直した設問は自動判定で上書きしない ===")
        session.set_check("書1-1", CHECK_NG, "確認不可")
        session.set_documents({"資格確認書"})   # 再判定が走る
        results.append(check("手入力が残る", session.rows["書1-1"].result, CHECK_NG))
        results.append(check("不備理由も残る", session.rows["書1-1"].defect_code, "確認不可"))
        results.append(check("判定表の設問は更新される", session.rows["書3-1"].result, CHECK_OK))

        print("\n=== 仮登録の書類は相談になる ===")
        rules.doc_types["見たことない通知書"] = {
            "書類ID": "見たことない通知書", "表示名": "見たことない通知書", "仮登録": "○",
        }
        rules.single[("書3-1", "見たことない通知書")] = {
            "設問ID": "書3-1", "書類ID": "見たことない通知書", "区分": "有効",
            "理由": "（仮）", "記入方法": "", "不備理由": "",
        }
        session.touched.discard("書3-1")
        session.set_documents({"見たことない通知書"})
        results.append(check("書3-1 は要相談", session.rows["書3-1"].result, CHECK_ASK))
        results.append(check("相談が必要と分かる", session.needs_consultation, True))

        print("\n=== 保存と再開 ===")
        session.set_documents({"高齢受給者証"})
        session.save()
        reopened = ReviewSession.open(rules, store, "1111111")
        results.append(check("書類が復元される", reopened.documents, {"高齢受給者証"}))
        results.append(check("入力が復元される", reopened.rows["書3-1"].result, CHECK_NG))
        results.append(check("判定不能も復元される", reopened.rows["書3-2"].result, CHECK_NA))
        results.append(check("手入力も復元される", reopened.rows["書1-1"].result, CHECK_NG))

        print("\n=== 完了 ===")
        reopened.complete()
        results.append(check("完了になる", store.get_case("1111111").status, CASE_DONE))
        results.append(check("次の未着手が出る", store.next_pending().recipient_no, "2222222"))

        print("\n=== 相談へ送る ===")
        other = ReviewSession.open(rules, store, "2222222")
        other.set_documents({"見たことない通知書"})
        other.send_to_consultation("見たことのない書類が出てきた")
        results.append(check("相談中になる", store.get_case("2222222").status, CASE_CONSULT))
        pending = store.list_consultations()
        results.append(check("相談が1件", len(pending), 1))
        results.append(check("設問が記録される", pending[0]["item_id"], "書3-1"))

        store.close()

    passed, total = sum(results), len(results)
    print(f"\n結果: {passed}/{total} 件 合格")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
