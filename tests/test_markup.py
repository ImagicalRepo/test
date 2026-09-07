"""比較マークアップの検証.

見た目の確認だけでは、囲みが本当に狙った場所に乗っているか分からない。
画素を直接調べて、座標のマッピングとマスクの焼き込みを確かめる。
"""
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from PIL import Image  # noqa: E402

from shinsa.markup import (  # noqa: E402
    BOX_COLOR, GAP, HEADER, MARGIN, SIDE_LEFT, SIDE_RIGHT,
    ComparisonSet, MarkupRegion, MaskRegion, build_comparison, export_comparison,
)
from shinsa.masking import audit_output_dir  # noqa: E402


def check(label, actual, expected):
    ok = actual == expected
    print(f"{'PASS' if ok else 'FAIL'}  {label}: {actual!r} (期待 {expected!r})")
    return ok


def near(pixel, color, tolerance=60):
    return all(abs(a - b) <= tolerance for a, b in zip(pixel, color))


def find_color(img, color, region):
    """指定範囲に、その色の画素があるか."""
    x0, y0, x1, y1 = region
    for y in range(max(0, y0), min(img.height, y1), 2):
        for x in range(max(0, x0), min(img.width, x1), 2):
            if near(img.getpixel((x, y)), color):
                return True
    return False


def main() -> int:
    results = []
    W = H = 400
    left = Image.new("RGB", (W, H), (255, 255, 255))
    right = Image.new("RGB", (W, H), (255, 255, 255))

    print("=== 左右がそろっているかの判定 ===")
    one_side = ComparisonSet(regions=[MarkupRegion(SIDE_LEFT, 0, (0.1, 0.1, 0.5, 0.2))])
    results.append(check("片側だけでは不成立", one_side.is_complete, False))

    both = ComparisonSet(
        regions=[
            MarkupRegion(SIDE_LEFT, 0, (0.10, 0.20, 0.50, 0.30), "申請書"),
            MarkupRegion(SIDE_RIGHT, 1, (0.50, 0.60, 0.90, 0.70), "資格確認書"),
        ],
        comparison="枝番",
    )
    results.append(check("左右そろえば成立", both.is_complete, True))

    print("\n=== 合成画像の寸法 ===")
    canvas = build_comparison(left, right, both)
    results.append(check("幅", canvas.width, MARGIN * 2 + W + GAP + W))
    results.append(check("高さ", canvas.height, MARGIN * 2 + HEADER + H))

    print("\n=== 囲みが狙った場所に乗るか（画素で確認）===")
    top = MARGIN + HEADER
    # 左：比率 (0.10,0.20)-(0.50,0.30) → 画素 (40,80)-(200,120) ＋ 原点
    left_box = (MARGIN + 40, top + 80, MARGIN + 200, top + 120)
    results.append(check("左の囲みがある", find_color(canvas, BOX_COLOR, left_box), True))
    # 右：原点は MARGIN + W + GAP。比率 (0.50,0.60)-(0.90,0.70) → 画素 (200,240)-(360,280)
    right_x = MARGIN + W + GAP
    right_box = (right_x + 200, top + 240, right_x + 360, top + 280)
    results.append(check("右の囲みがある", find_color(canvas, BOX_COLOR, right_box), True))
    # 囲んでいない場所には線が無い
    results.append(
        check("無関係な場所は白い", find_color(canvas, BOX_COLOR, (MARGIN, top, MARGIN + 30, top + 30)), False)
    )

    print("\n=== 左右を結ぶ線 ===")
    # 左の囲みの右辺(中央) と 右の囲みの左辺(中央) の間に線が通る
    middle_x = (MARGIN + 200 + right_x + 200) // 2
    results.append(
        check(
            "結線がある",
            find_color(canvas, BOX_COLOR, (middle_x - 4, top + 90, middle_x + 4, top + 280)),
            True,
        )
    )

    print("\n=== 片側だけでも合成できる ===")
    only_left = build_comparison(left, None, one_side)
    results.append(check("右が無くても落ちない", only_left.width > 0, True))
    try:
        build_comparison(None, None, one_side)
        results.append(check("両方無しは拒否", False, True))
    except ValueError:
        results.append(check("両方無しは拒否", True, True))

    print("\n=== マスクが焼き込まれるか ===")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "出力"
        shutil.rmtree(out, ignore_errors=True)
        # 左ページの上部を隠す。指定はページ側の比率で行う
        both.masks = [MaskRegion(SIDE_LEFT, (0.10, 0.05, 0.90, 0.15))]
        path = export_comparison(left, right, both, out, prefix="cmp")
        results.append(check("連番で書き出される", path.name, "cmp_0001.png"))

        saved = Image.open(path)
        # 左ページ上部の中央。原点は (MARGIN, MARGIN+HEADER)
        mx = MARGIN + int(W * 0.5)
        my = MARGIN + HEADER + int(H * 0.10)
        results.append(check("指定した場所が黒い", saved.getpixel((mx, my)), (0, 0, 0)))
        results.append(
            check("同じ高さの右ページは黒くない",
                  saved.getpixel((MARGIN + W + GAP + int(W * 0.5), my)) != (0, 0, 0), True)
        )
        results.append(
            check("マスク外は黒くない", saved.getpixel((mx, saved.height - 10)) != (0, 0, 0), True)
        )
        results.append(check("持ち出し前点検で問題なし", audit_output_dir(out), []))

    passed, total = sum(results), len(results)
    print(f"\n結果: {passed}/{total} 件 合格")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
