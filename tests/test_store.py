"""作業状態の永続化の検証.

要点は「強制終了しても続きから作業できること」と
「マスキング未が残っている限り持ち出しを止められること」。
"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from shinsa.caselist import build_cases, scan_folder  # noqa: E402
from shinsa.config import (  # noqa: E402
    CASE_DONE, CASE_PENDING, CASE_WORKING, CHECK_NA, CHECK_NG, CHECK_OK,
    MASK_DONE, MASK_NOT_NEEDED, MASK_TODO,
)
from shinsa.store import Store  # noqa: E402


def check(label, actual, expected):
    ok = actual == expected
    print(f"{'PASS' if ok else 'FAIL'}  {label}: {actual!r} (期待 {expected!r})")
    return ok


def make_cases(root: Path):
    for name in [
        "01A1111111A001_20260601_1.pdf",
        "01A1111111A001_20260601_2.pdf",
        "01A2222222A001_20260602_1.pdf",
        "01A2222222A001_20260620_3.pdf",
        "01A3333333A001_20260603_1.pdf",
    ]:
        (root / name).write_bytes(b"%PDF-1.4\n")
    parsed, _ = scan_folder(root)
    return build_cases(parsed)


def main() -> int:
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        cases = make_cases(root)
        db = root / "work" / "作業.db"

        print("=== 取込 ===")
        with Store(db, worker="ペアA") as store:
            added, updated = store.sync_cases(cases)
            results.append(check("新規取込", added, 3))
            results.append(check("更新", updated, 0))
            results.append(check("進捗の合計", store.progress()["合計"], 3))
            results.append(check("未着手", store.progress()[CASE_PENDING], 3))

            print("\n=== 再取込でも作業状態を壊さない ===")
            first = store.next_pending()
            store.start_case(first.recipient_no)
            store.set_check(first.recipient_no, "書3-1", CHECK_NG, "無効書類")
            added2, updated2 = store.sync_cases(cases)
            results.append(check("再取込は新規0", added2, 0))
            results.append(check("再取込は更新3", updated2, 3))
            results.append(check("作業中のまま", store.get_case(first.recipient_no).status, CASE_WORKING))
            results.append(
                check("入力も残る", store.get_checks(first.recipient_no)["書3-1"]["result"], CHECK_NG)
            )

        print("\n=== 強制終了からの再開 ===")
        with Store(db, worker="ペアA") as store:
            case = store.get_case("1111111")
            results.append(check("状態が残っている", case.status, CASE_WORKING))
            results.append(check("次の未着手は別案件", store.next_pending().recipient_no, "2222222"))

            print("\n=== 何が届いているか ===")
            store.set_documents("1111111", ["資格確認書", "高齢受給者証"])
            results.append(
                check("保存できる", store.get_documents("1111111"), ["資格確認書", "高齢受給者証"])
            )
            store.set_documents("1111111", ["資格確認書"])
            results.append(check("上書きされる", store.get_documents("1111111"), ["資格確認書"])) 

            print("\n=== チェックリスト（判定不能を含む）===")
            store.set_check("1111111", "書3-2", CHECK_NA)
            store.set_check("1111111", "書3-3", CHECK_NA)
            store.set_check("1111111", "書1-1", CHECK_OK)
            checks = store.get_checks("1111111")
            results.append(check("判定不能が保存される", checks["書3-2"]["result"], CHECK_NA))
            results.append(check("件数", len(checks), 4))
            try:
                store.set_check("1111111", "書1-2", "でたらめ")
                results.append(check("不正な状態を拒否", False, True))
            except ValueError:
                results.append(check("不正な状態を拒否", True, True))

            print("\n=== マスキング状態 ===")
            m1 = store.add_markup("1111111", "/out/img_0001.png", "書3-1", mask_status=MASK_TODO)
            m2 = store.add_markup("1111111", "/out/img_0002.png", "書3-1", mask_status=MASK_NOT_NEEDED)
            results.append(check("未の件数", store.count_mask_todo(), 1))
            store.set_mask_status(m1, MASK_DONE)
            results.append(check("済にすると0件", store.count_mask_todo(), 0))
            results.append(check("案件のマークアップ数", len(store.list_markups("1111111")), 2))
            results.append(
                check("不要で絞れる", len(store.list_markups(mask_status=MASK_NOT_NEEDED)), 1)
            )
            _ = m2

            print("\n=== 相談キュー ===")
            cid = store.add_consultation("1111111", "書3-2", ["資格確認書"], "枝番だけ違う", m1)
            results.append(check("未回答が1件", len(store.list_consultations()), 1))
            store.answer_consultation(cid, "枝番のみの相違は NG とする", "管理者")
            results.append(check("回答後は0件", len(store.list_consultations()), 0))
            results.append(check("回答済で引ける", len(store.list_consultations("回答済")), 1))

            print("\n=== 仮登録の書類 ===")
            store.add_provisional_doc("見たことない通知書")
            store.add_provisional_doc("見たことない通知書")  # 重複しても増えない
            results.append(check("仮登録は1件", len(store.list_provisional_docs()), 1))
            store.resolve_provisional_doc("見たことない通知書", "資格情報のお知らせ")
            results.append(check("確定すると未解決0件", len(store.list_provisional_docs()), 0))

            print("\n=== 完了と頻度分布 ===")
            store.set_case_status("1111111", CASE_DONE)
            results.append(check("完了件数", store.progress()[CASE_DONE], 1))
            store.set_check("2222222", "書3-1", CHECK_NG, "無効書類")
            store.set_check("3333333", "書3-1", CHECK_NG, "未提出")
            dist = store.defect_counts()
            results.append(check("頻度分布の最上位", dist[0], ("書3-1", "無効書類", 2)))

            print("\n=== 監査ログ ===")
            results.append(check("記録されている", len(store.recent_log()) > 0, True))

    passed, total = sum(results), len(results)
    print(f"\n結果: {passed}/{total} 件 合格")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
