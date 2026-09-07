"""配色の検証.

「見やすいと思う」ではなく、コントラスト比を計算して確かめる。
1 日 8 時間見る画面なので、ここは数値で担保する。

基準は WCAG の 4.5:1（本文）。パステル系は薄い地に薄い文字を置きがちで、
ここが一番崩れやすい。
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from shinsa.config import CHECK_ASK, CHECK_NA, CHECK_NG, CHECK_OK  # noqa: E402
from shinsa.theme import (  # noqa: E402
    CHECK_SYMBOLS, DEFAULT_THEME, THEMES, contrast_ratio,
)

MIN_RATIO = 4.5      # 本文
MIN_LARGE = 3.0      # 大きな文字・枠線


def main() -> int:
    failures: list[str] = []
    checked = 0

    print(f"=== テーマ {len(THEMES)} 色のコントラスト比 ===")
    print(f"（本文 {MIN_RATIO}:1 以上、枠線 {MIN_LARGE}:1 以上）\n")

    for name, theme in THEMES.items():
        # 文字と背景の組み合わせ。ここを外すと読めない画面になる
        pairs = [
            ("本文/地", theme.fg, theme.bg, MIN_RATIO),
            ("本文/面", theme.fg, theme.surface, MIN_RATIO),
            ("補足/地", theme.muted, theme.bg, MIN_RATIO),
            ("補足/面", theme.muted, theme.surface, MIN_RATIO),
            ("現在行", theme.select_fg, theme.select_bg, MIN_RATIO),
            ("OK", theme.ok_fg, theme.ok_bg, MIN_RATIO),
            ("NG", theme.ng_fg, theme.ng_bg, MIN_RATIO),
            ("相談", theme.ask_fg, theme.ask_bg, MIN_RATIO),
            ("罫線/地", theme.line, theme.bg, MIN_LARGE),
            ("フォーカス枠/地", theme.focus, theme.bg, MIN_LARGE),
            # 枠線・強調にだけ使う色。文字には使わないので 3.0:1 で判定する。
            # ここを甘くすると #D1D5DB のような「ほぼ見えない枠線」が紛れ込む。
            ("強調枠/地", theme.accent, theme.bg, MIN_LARGE),
            ("警告枠/地", theme.danger, theme.bg, MIN_LARGE),
        ]
        results = []
        for label, front, back, minimum in pairs:
            ratio = contrast_ratio(front, back)
            checked += 1
            ok = ratio >= minimum
            if not ok:
                failures.append(f"{name} / {label}: {ratio:.2f} (必要 {minimum})")
            results.append(f"{label} {ratio:4.1f}{'' if ok else ' ✗'}")
        print(f"  {name:<8} {' | '.join(results)}")

    print("\n=== 強調色を本文に使っていないこと ===")
    # #3B82F6 や #EF4444 は彩度を落とした分だけコントラストも落ちる。
    # 枠線には使えるが、本文に使うと 4.5:1 を割る。用途の取り違えを防ぐ。
    misuse = []
    for name, theme in THEMES.items():
        for label, color in [("強調", theme.accent), ("警告", theme.danger)]:
            if contrast_ratio(color, theme.bg) < MIN_RATIO and color in (
                theme.fg, theme.muted, theme.ok_fg, theme.ng_fg, theme.ask_fg
            ):
                misuse.append(f"{name}: {label}色 {color} を文字色に使っている")
    print(f"  {'PASS' if not misuse else 'FAIL'}  文字色に転用していない")
    failures.extend(misuse)

    print("\n=== 状態が色以外でも判別できること ===")
    symbol_ok = True
    for state in (CHECK_OK, CHECK_NG, CHECK_ASK, CHECK_NA):
        symbol = CHECK_SYMBOLS.get(state, "")
        good = bool(symbol.strip())
        symbol_ok &= good
        print(f"  {'PASS' if good else 'FAIL'}  {state}: 記号 '{symbol}'")
    if len(set(CHECK_SYMBOLS[s] for s in (CHECK_OK, CHECK_NG, CHECK_ASK, CHECK_NA))) != 4:
        failures.append("状態の記号が重複している")
        symbol_ok = False
    if not symbol_ok:
        failures.append("状態を色以外で判別できない")

    print("\n=== 既定テーマ ===")
    print(f"  {'PASS' if DEFAULT_THEME in THEMES else 'FAIL'}  {DEFAULT_THEME}")
    if DEFAULT_THEME not in THEMES:
        failures.append("既定テーマが存在しない")

    print(f"\n{checked} 組を検査、{len(failures)} 件が基準未満")
    for failure in failures:
        print(f"  ✗ {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
