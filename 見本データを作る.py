"""動作確認用の見本データを作る.

実データは端末の外に出せないため、開発機では中身のない見本 PDF で動作を確かめる。
実行すると `見本データ` フォルダに、申請書一式に見立てた PDF を作る。

    python 見本データを作る.py

作られるもの（実物の構成に合わせてある）:
  ・申請書（オモテ・ウラ）
  ・資格確認書 / 高齢受給者証 などの医療保険資料
  ・自己負担上限額管理票
  ・チェックリスト（メモ欄に書き込みのあるもの・ないもの）
  ・申請者からの手紙（審査に関係ない提出物）
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from PIL import Image, ImageDraw  # noqa: E402

try:
    import pymupdf
except ImportError:  # pragma: no cover
    import fitz as pymupdf

from shinsa.markup import _font  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent / "見本データ"
WIDTH, HEIGHT = 1240, 1754


def _page(title: str, lines: list[str]) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle((60, 60, 760, 140), outline=(0, 0, 0), width=3)
    draw.text((85, 88), title, fill=(0, 0, 0), font=_font(34))
    y = 240
    for line in lines:
        draw.line((60, y + 52, 1180, y + 52), fill=(150, 150, 150), width=2)
        draw.text((85, y + 14), line, fill=(0, 0, 0), font=_font(26))
        y += 84
    draw.text((85, HEIGHT - 90), "※ 動作確認用の見本です。実在の情報ではありません。",
              fill=(150, 150, 150), font=_font(22))
    return img


def _checklist(memo_lines: int, check_marks: int) -> Image.Image:
    """チェックリストに見立てた定型ページ."""
    img = Image.new("RGB", (WIDTH, HEIGHT), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle((60, 60, 700, 130), outline=(0, 0, 0), width=3)
    draw.text((80, 78), "【一斉更新用】申請書チェックリスト（見本）",
              fill=(0, 0, 0), font=_font(26))

    for y in range(220, 1200, 52):          # 左：書類確認欄／右：システム入力欄
        draw.line((60, y, 600, y), fill=(0, 0, 0), width=2)
        draw.line((660, y, 1180, y), fill=(0, 0, 0), width=2)
    for x in (60, 300, 470, 600):
        draw.line((x, 220, x, 1200), fill=(0, 0, 0), width=2)

    for i in range(check_marks):            # チェック（手書き相当）
        y = 250 + i * 52
        draw.line((500, y, 518, y + 18), fill=(0, 0, 0), width=5)
        draw.line((518, y + 18, 545, y - 12), fill=(0, 0, 0), width=5)

    draw.rectangle((60, 1560, 600, 1700), outline=(0, 0, 0), width=2)
    draw.text((70, 1530), "メモ欄", fill=(0, 0, 0), font=_font(22))
    for i in range(memo_lines):             # メモ欄への書き込み
        draw.line((78, 1585 + i * 16, 585, 1585 + i * 16), fill=(0, 0, 0), width=6)
    return img


def _write_pdf(path: Path, pages: list[Image.Image]) -> None:
    doc = pymupdf.open()
    temp = path.parent / "_一時.png"
    for image in pages:
        image.save(temp)
        page = doc.new_page(width=595, height=842)
        page.insert_image(page.rect, filename=str(temp))
    doc.save(path)
    doc.close()
    temp.unlink(missing_ok=True)


APPLICATION_FRONT = ["氏名　　　　難病　太郎", "住所　　　　仙台市青葉区○○ 1-2-3",
                     "保険者番号　06123456", "記号・番号　1234・5678", "枝番　　　　01"]
APPLICATION_BACK = ["裏面　同意事項", "署名　　　　難病　太郎"]


def build() -> list[Path]:
    OUT_DIR.mkdir(exist_ok=True)
    created: list[Path] = []

    def add(name: str, pages: list[Image.Image]) -> None:
        path = OUT_DIR / name
        _write_pdf(path, pages)
        created.append(path)

    # 1) 素直な案件（有効な書類がそろっている）
    add("01A1000001A001_20260601_1.pdf", [
        _page("申請書（更新）　オモテ", APPLICATION_FRONT),
        _page("申請書（更新）　ウラ", APPLICATION_BACK),
        _page("資格確認書", ["氏名　　　　難病　太郎", "保険者番号　06123456",
                             "記号・番号　1234・5678", "枝番　　　　01"]),
        _page("自己負担上限額管理票", ["4月　　2,500円", "5月　　2,500円", "6月　　2,500円"]),
        _checklist(memo_lines=0, check_marks=6),
        _page("申請者からの手紙", ["いつもお世話になっております。", "よろしくお願いいたします。"]),
    ])

    # 2) 枝番だけ違う（★毎年ブレている論点。作業窓で見比べる練習用）
    add("01A1000002A001_20260602_1.pdf", [
        _page("申請書（更新）　オモテ", APPLICATION_FRONT),
        _page("申請書（更新）　ウラ", APPLICATION_BACK),
        _page("資格確認書", ["氏名　　　　難病　太郎", "保険者番号　06123456",
                             "記号・番号　1234・5678", "枝番　　　　05  ← 申請書と違う"]),
        _page("自己負担上限額管理票", ["4月　　2,500円", "5月　　2,500円"]),
        _checklist(memo_lines=6, check_marks=9),
    ])

    # 3) 無効な書類しか出ていない（保険証を出してきたパターン）
    add("01A1000003A001_20260603_1.pdf", [
        _page("申請書（更新）　オモテ", APPLICATION_FRONT),
        _page("申請書（更新）　ウラ", APPLICATION_BACK),
        _page("健康保険被保険者証（旧）", ["氏名　　　　難病　太郎", "※ 廃止済みの様式"]),
        _page("高齢受給者証", ["氏名　　　　難病　太郎", "負担割合　　2割"]),
        _checklist(memo_lines=3, check_marks=11),
    ])

    # 4) 追加書類が後から届いた案件（同じ受給者番号・別の日付）
    add("01A1000004A001_20260604_1.pdf", [
        _page("申請書（更新）　オモテ", APPLICATION_FRONT),
        _page("申請書（更新）　ウラ", APPLICATION_BACK),
        _checklist(memo_lines=2, check_marks=4),
    ])
    add("01A1000004A001_20260620_3.pdf", [
        _page("不備解消（追加提出）", ["資格確認書を追送します。"]),
        _page("資格確認書", ["氏名　　　　難病　太郎", "記号・番号　1234・5678", "枝番　　　　01"]),
    ])

    # 5) 臨床調査個人票（通し番号が偶数。作業対象外になることの確認用）
    add("01A1000001A001_20260601_2.pdf", [_page("臨床調査個人票", ["病名　　　　○○病"])])

    # 6) ファイル名の規則に合わないもの（作業リストに入らないことの確認用）
    add("作業メモ.pdf", [_page("作業メモ", ["規則に合わない名前のファイルです。"])])

    return created


def main() -> int:
    print("見本データを作っています…")
    created = build()
    print(f"\n{OUT_DIR} に {len(created)} 件を作りました。\n")
    for path in created:
        print(f"  {path.name}")
    print(
        "\n次に、見直しツールを起動してください。\n"
        "    python tool_review.py\n\n"
        "起動したら「フォルダを取り込む」で、いま作った 見本データ フォルダを指定します。\n"
        "作業リストに 4 件（受給者番号 1000001〜1000004）が並べば成功です。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
