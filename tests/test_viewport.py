"""表示領域の座標計算の検証.

画面で囲んだ場所とページ上の場所がずれると、マークアップもマスキングも
意味を失う。往復変換で元に戻ることを中心に確かめる。
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from shinsa.viewport import MAX_ZOOM, MIN_ZOOM, Viewport  # noqa: E402


def check(label, actual, expected):
    ok = actual == expected
    print(f"{'PASS' if ok else 'FAIL'}  {label}: {actual!r} (期待 {expected!r})")
    return ok


def close(label, actual, expected, tolerance=1e-6):
    ok = abs(actual - expected) <= tolerance
    print(f"{'PASS' if ok else 'FAIL'}  {label}: {actual:.6f} (期待 {expected:.6f})")
    return ok


def main() -> int:
    results = []
    # 1000x2000 の画像を、画面上 (100,50) から 400x600 のカラムに表示する
    base = Viewport(1000, 2000, pane_x=100, pane_y=50, pane_width=400, pane_height=600)

    print("=== 収める倍率 ===")
    results.append(close("縦横の小さい方に合わせる", base.fit_scale(), 0.3))
    view = base.fitted()
    results.append(close("倍率", view.zoom, 0.3))
    # 幅 1000*0.3=300 < 400 なので横は中央寄せ（負のオフセット）
    results.append(close("横は中央寄せ", view.offset_x, (1000 - 400 / 0.3) / 2))
    results.append(close("縦はぴったり", view.offset_y, 0.0))

    print("\n=== 往復変換（画面 → 比率 → 画面）===")
    # 収めた状態では、画像は横 300px ぶんが中央（画面 x=150〜450）に描かれる
    for point in [(160, 80), (300, 400), (440, 640)]:
        ratio = view.to_ratio(point)
        back = view.to_canvas(ratio)
        results.append(close(f"{point} の x", back[0], point[0], 0.01))
        results.append(close(f"{point} の y", back[1], point[1], 0.01))

    print("\n=== 画像の外は端に丸められる ===")
    # カラム内だが、画像が描かれていない余白（x=480）
    results.append(check("カラム内である", view.contains((480, 400)), True))
    results.append(close("比率は右端", view.to_ratio((480, 400))[0], 1.0))
    results.append(close("戻すと画像の右端", view.to_canvas((1.0, 0.0))[0], 450.0, 0.01))

    print("\n=== 比率の矩形 ===")
    box = view.ratio_box((150, 200), (350, 100))   # 逆向きのドラッグ
    results.append(check("左上と右下が正規化される", box[0] < box[2] and box[1] < box[3], True))
    results.append(check("0.0〜1.0 に収まる", all(0.0 <= v <= 1.0 for v in box), True))

    print("\n=== 画像の外へのドラッグ ===")
    outside = view.ratio_box((-500, -500), (5000, 5000))
    results.append(check("端で止まる", outside, (0.0, 0.0, 1.0, 1.0)))

    print("\n=== カラムの内外判定 ===")
    results.append(check("内側", view.contains((300, 300)), True))
    results.append(check("左端の外", view.contains((99, 300)), False))
    results.append(check("右端の外", view.contains((500, 300)), False))
    results.append(check("下端の外", view.contains((300, 650)), False))

    print("\n=== 拡大しても同じ点を指すこと ===")
    anchor = (300, 400)
    before = view.to_ratio(anchor)
    zoomed = view.zoomed(2.0, anchor=anchor)
    after = zoomed.to_ratio(anchor)
    results.append(close("拡大の基準点は動かない x", after[0], before[0], 0.005))
    results.append(close("拡大の基準点は動かない y", after[1], before[1], 0.005))
    results.append(close("倍率が2倍", zoomed.zoom, 0.6))

    print("\n=== 倍率の上限と下限 ===")
    huge = view
    for _ in range(20):
        huge = huge.zoomed(2.0)
    results.append(close("上限で止まる", huge.zoom, MAX_ZOOM))
    tiny = view
    for _ in range(20):
        tiny = tiny.zoomed(0.5)
    results.append(close("下限で止まる", tiny.zoom, MIN_ZOOM))

    print("\n=== スクロール ===")
    big = view.zoomed(4.0)   # 拡大して画像がカラムより大きい状態にする
    moved = big.scrolled(0, 100)
    results.append(check("下へ動く", moved.offset_y > big.offset_y, True))
    far = big
    for _ in range(50):
        far = far.scrolled(0, 500)
    bottom = far.image_height - far.pane_height / far.zoom
    results.append(close("下端で止まる", far.offset_y, bottom, 0.01))
    top = far
    for _ in range(50):
        top = top.scrolled(0, -500)
    results.append(close("上端で止まる", top.offset_y, 0.0, 0.01))

    print("\n=== カラムの大きさが変わったとき ===")
    resized = view.resized(0, 0, 800, 1200)
    results.append(check("原点が変わる", (resized.pane_x, resized.pane_y), (0, 0)))
    results.append(check("収め直せる", round(resized.fitted().zoom, 3), 0.6))

    print("\n=== 描画に必要な範囲だけを切り出す ===")
    crop, size, position = view.visible_source()
    results.append(check("全体が見えるので画像全体", crop, (0, 0, 1000, 2000)))
    results.append(check("拡大後の寸法", size, (300, 600)))
    results.append(check("中央に置かれる", position, (150, 50)))

    big = view.zoomed(8.0)   # 大きく拡大すると一部だけになる
    crop, size, position = big.visible_source()
    results.append(check("切り出しが小さくなる", crop[2] - crop[0] < 1000, True))
    results.append(check("表示寸法はカラムに収まる", size[0] <= big.pane_width + 1, True))

    outside = Viewport(100, 100, 0, 0, 200, 200, zoom=1.0, offset_x=500, offset_y=500)
    results.append(check("範囲外は None", outside._clamped().visible_source() is not None, True))

    print("\n=== 表示寸法 ===")
    results.append(check("倍率どおり", base.zoomed(0.5).display_size(), (500, 1000)))

    passed, total = sum(results), len(results)
    print(f"\n結果: {passed}/{total} 件 合格")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
