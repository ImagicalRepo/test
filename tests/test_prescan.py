"""事前バッチと先読みの検証.

要点は「メモ欄に書き込みのある案件が本当に先に来るか」。
ここが外れると、論点の早期把握という狙いが崩れる。
"""
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from PIL import Image, ImageDraw  # noqa: E402

try:
    import pymupdf as fitz
except ImportError:  # pragma: no cover
    import fitz

from shinsa import prescan  # noqa: E402
from shinsa.caselist import build_cases, scan_folder  # noqa: E402
from shinsa.prefetch import PageCache, Prefetcher  # noqa: E402
from shinsa.store import Store  # noqa: E402


def check(label, actual, expected):
    ok = actual == expected
    print(f"{'PASS' if ok else 'FAIL'}  {label}: {actual!r} (期待 {expected!r})")
    return ok


def checklist_page(memo_lines: int, check_marks: int = 0) -> Image.Image:
    """チェックリストを模した定型ページ.

    memo_lines でメモ欄の書き込み量、check_marks で書類確認欄のチェック数を変える。
    チェックは署名を取る範囲（罫線部）の中に入るため、ここも耐性を確かめる必要がある。
    """
    img = Image.new("RGB", (1240, 1754), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle((60, 60, 600, 120), outline=(0, 0, 0), width=3)
    for y in range(220, 1200, 52):                       # 左：書類確認欄
        draw.line((60, y, 600, y), fill=(0, 0, 0), width=2)
    for x in (60, 300, 470, 600):
        draw.line((x, 220, x, 1200), fill=(0, 0, 0), width=2)
    for y in range(220, 1200, 52):                       # 右：システム入力欄
        draw.line((660, y, 1180, y), fill=(0, 0, 0), width=2)
    draw.rectangle((60, 1560, 600, 1700), outline=(0, 0, 0), width=2)  # メモ欄の枠
    for i in range(memo_lines):                          # メモ欄への書き込み
        y = 1575 + i * 12
        draw.line((70, y, 590, y), fill=(0, 0, 0), width=6)
    for i in range(check_marks):                         # 書類確認欄へのチェック（罫線部の中）
        y = 240 + i * 52
        draw.line((480, y, 500, y + 20), fill=(0, 0, 0), width=5)
        draw.line((500, y + 20, 530, y - 10), fill=(0, 0, 0), width=5)
    return img


def other_page(seed: int) -> Image.Image:
    img = Image.new("RGB", (1240, 1754), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    for y in range(200, 1400, 30):
        draw.line((100, y, 1100 - (y * seed) % 400, y), fill=(40, 40, 40))
    return img


def make_pdf(path: Path, pages: list[Image.Image], tmp: Path) -> None:
    doc = fitz.open()
    for i, image in enumerate(pages):
        png = tmp / f"_p{i}.png"
        image.save(png)
        page = doc.new_page(width=595, height=842)
        page.insert_image(page.rect, filename=str(png))
    doc.save(path)
    doc.close()


def main() -> int:
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        pdf_dir = root / "pdf"
        pdf_dir.mkdir()

        # 3 件。うち 1 件だけメモ欄にたっぷり書き込みがある
        memo_lines = {1: 0, 3: 9, 5: 0}
        check_marks = {1: 6, 3: 14, 5: 3}
        positions = {1: 2, 3: 0, 5: 4}
        for serial, lines in memo_lines.items():
            pages = [other_page(i + serial) for i in range(5)]
            pages[positions[serial]] = checklist_page(lines, check_marks[serial])
            make_pdf(pdf_dir / f"01A000000{serial}A001_2026060{serial}_{serial}.pdf", pages, root)

        parsed, _ = scan_folder(pdf_dir)
        cases = build_cases(parsed)
        results.append(check("作業リスト3件", len(cases), 3))

        print("\n=== 署名は記入内容に影響されないこと ===")
        from shinsa import detect
        template_img = checklist_page(0, 0)
        base = detect.signature(template_img)
        worst = min(
            detect.similarity(detect.signature(checklist_page(m, c)), base)
            for m, c in [(0, 5), (9, 14), (15, 17)]
        )
        unrelated = detect.similarity(detect.signature(other_page(3)), base)
        print(f"      記入ありの最低スコア {worst:.3f} / 無関係なページ {unrelated:.3f}")
        results.append(check("記入があっても検出できる", worst >= detect.DEFAULT_THRESHOLD, True))
        results.append(check("無関係なページは下回る", unrelated < detect.DEFAULT_THRESHOLD, True))
        results.append(check("十分に離れている", worst - unrelated > 0.3, True))

        print("\n=== 黒画素率 ===")
        blank = prescan.ink_ratio(Image.new("RGB", (200, 100), (255, 255, 255)))
        filled = prescan.ink_ratio(Image.new("RGB", (200, 100), (0, 0, 0)))
        results.append(check("白紙は0", round(blank, 3), 0.0))
        results.append(check("真っ黒は1", round(filled, 3), 1.0))

        print("\n=== 事前バッチ ===")
        db = root / "作業.db"
        with Store(db, worker="ペアA") as store:
            store.sync_cases(cases)
            template = prescan.make_template(cases[0].primary.path, positions[1])
            scanned = prescan.run(store, template, ink_threshold=prescan.DEFAULT_INK_THRESHOLD)

            found = [r for r in scanned if r.found]
            results.append(check("チェックリストを全件検出", len(found), 3))

            inks = {r.recipient_no: r.memo_ink for r in scanned}
            written = inks["0000003"]
            empty = [inks["0000001"], inks["0000005"]]
            print(f"      書き込みあり: {written:.4f} / 書き込みなし: "
                  f"{empty[0]:.4f}, {empty[1]:.4f}")
            results.append(check("書き込みありの方が黒い", written > max(empty), True))

            print("\n=== 優先順位 ===")
            order = [c.recipient_no for c in store.list_cases()]
            results.append(check("書き込みのある案件が先頭", order[0], "0000003"))
            results.append(
                check("優先度が付いている", store.get_case("0000003").priority, prescan.PRIORITY_HIGH)
            )
            results.append(
                check("それ以外は通常", store.get_case("0000001").priority, prescan.PRIORITY_NORMAL)
            )

            print("\n=== 分布（しきい値の調整用）===")
            dist = prescan.distribution(scanned, buckets=4)
            results.append(check("分布が出る", len(dist) > 0, True))
            for low, high, count in dist:
                if count:
                    print(f"      {low:.4f}〜{high:.4f}: {count} 件")

        print("\n=== 先読み ===")
        cache = PageCache(max_items=3)
        fetcher = Prefetcher(cache)
        target = cases[0].primary.path

        started = time.perf_counter()
        first = fetcher.load(target, 0)
        cold = time.perf_counter() - started

        started = time.perf_counter()
        second = fetcher.load(target, 0)
        warm = time.perf_counter() - started

        results.append(check("同じ画像が返る", first is second, True))
        results.append(check("2回目は速い", warm < cold, True))
        print(f"      初回 {cold * 1000:.1f}ms → 2回目 {warm * 1000:.1f}ms")

        fetcher.warm(target, pages=3)
        deadline = time.time() + 5
        while len(cache) < 3 and time.time() < deadline:
            time.sleep(0.05)
        results.append(check("先読みで温まる", len(cache) >= 3, True))

        cache.put(target, 99, 110, Image.new("RGB", (2, 2)))
        results.append(check("上限を超えない", len(cache) <= 3, True))
        fetcher.stop()

    passed, total = sum(results), len(results)
    print(f"\n結果: {passed}/{total} 件 合格")
    return 0 if passed == total and test_concurrent_render() == 0 else 1



def test_concurrent_render() -> int:
    """前景と先読みが同時に PDF を開いても壊れないこと."""
    import tempfile
    import threading
    from pathlib import Path as P

    from shinsa import pdfio
    from shinsa.prefetch import PageCache, Prefetcher

    print("\n=== 同時描画 ===")
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        root = P(tmp)
        pdf = root / "t.pdf"
        make_pdf(pdf, [other_page(i) for i in range(6)], root)

        fetcher = Prefetcher(PageCache(max_items=32))
        failures: list[str] = []

        def hammer() -> None:
            try:
                for i in range(6):
                    img = pdfio.render_page(pdf, i, dpi=pdfio.DPI_THUMBNAIL)
                    if img.width == 0:
                        failures.append("空の画像")
            except Exception as exc:  # noqa: BLE001
                failures.append(str(exc))

        for _ in range(3):
            fetcher.warm(pdf, pages=6)
        threads = [threading.Thread(target=hammer) for _ in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        results.append(check("前景の描画が全て成功", failures, []))
        results.append(check("先読みでエラーが出ない", fetcher.errors, []))
        fetcher.stop()

    passed, total = sum(results), len(results)
    print(f"同時描画: {passed}/{total} 件 合格")
    return 0 if passed == total else 1

if __name__ == "__main__":
    raise SystemExit(main())
