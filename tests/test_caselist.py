"""作業リスト作成の検証."""
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from shinsa.caselist import (  # noqa: E402
    build_cases,
    orphan_clinical,
    parse_filename,
    scan_folder,
)


def check(label, actual, expected):
    ok = actual == expected
    print(f"{'PASS' if ok else 'FAIL'}  {label}: {actual!r} (期待 {expected!r})")
    return ok


def main() -> int:
    results = []

    print("=== ファイル名の解析 ===")
    scan = parse_filename(Path("/x/01A1234567A001_20260601_1.pdf"))
    results.append(check("受給者番号", scan.recipient_no, "1234567"))
    results.append(check("先頭2桁", scan.prefix, "01"))
    results.append(check("末尾3桁", scan.branch, "001"))
    results.append(check("日付", scan.received_on, date(2026, 6, 1)))
    results.append(check("通し番号", scan.serial, 1))
    results.append(check("奇数＝申請書一式", scan.is_application, True))
    results.append(
        check(
            "偶数＝臨個票",
            parse_filename(Path("/x/01A1234567A001_20260601_2.pdf")).is_application,
            False,
        )
    )
    for bad in ["メモ", "01A123A001_20260601_1", "01A1234567A001_20261301_1"]:
        results.append(check(f"規則外は None: {bad}", parse_filename(Path(f"/x/{bad}.pdf")), None))

    print("\n=== フォルダ走査（サブフォルダ含む）===")
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "sub" / "深い").mkdir(parents=True)
        names = [
            "01A1234567A001_20260601_1.pdf",   # 本体
            "01A1234567A001_20260615_3.pdf",   # 追加書類
            "01A1234567A001_20260601_2.pdf",   # 臨個票
            "sub/01A7654321A001_20260602_1.pdf",
            "sub/深い/01A7654321A001_20260610_5.pdf",
            "sub/深い/01A9999999A001_20260603_2.pdf",  # 臨個票のみ
            "作業メモ.pdf",                     # 規則外
        ]
        for name in names:
            (root / name).write_bytes(b"%PDF-1.4\n")

        parsed, unparsed = scan_folder(root)
        results.append(check("解析できた件数", len(parsed), 6))
        results.append(check("規則外の件数", len(unparsed), 1))
        results.append(check("規則外の名前", unparsed[0].name, "作業メモ.pdf"))

        cases = build_cases(parsed)
        results.append(check("作業リストの件数", len(cases), 2))
        results.append(check("日付順の先頭", cases[0].recipient_no, "1234567"))

        first = cases[0]
        results.append(check("本体は最古", first.primary.received_on, date(2026, 6, 1)))
        results.append(check("追加書類の件数", len(first.additional), 1))
        results.append(check("追加書類の日付", first.additional[0].received_on, date(2026, 6, 15)))
        results.append(check("臨個票の件数", first.clinical.__len__(), 1))

        print("\n=== 本体の入れ替え ===")
        old = first.primary
        first.swap_primary(first.additional[0])
        results.append(check("本体が入れ替わる", first.primary.received_on, date(2026, 6, 15)))
        results.append(check("元の本体が追加書類へ", first.additional[0], old))

        print("\n=== 臨個票だけの受給者番号 ===")
        orphans = orphan_clinical(parsed)
        results.append(check("拾えること", len(orphans), 1))
        results.append(check("受給者番号", orphans[0].recipient_no, "9999999"))

    passed, total = sum(results), len(results)
    print(f"\n結果: {passed}/{total} 件 合格")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
