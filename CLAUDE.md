# このリポジトリで作業する AI へ

**まず [`docs/AI_引き継ぎ.md`](docs/AI_引き継ぎ.md) を読んでください。**
経緯・制約・過去に踏んだ地雷・残っている作業がまとまっています。

## 要点だけ

- 指定難病受給者証の一斉更新における**書類審査の見直しツール**（Windows・完全オフライン・DVD 配布）
- 作業ブランチ: `claude/rare-disease-cert-review-wl8n70`
- **残っている作業は exe のビルドだけ**: Windows 側で `build\配布物を作る.bat`
  （PyInstaller はクロスコンパイル不可。Linux/WSL では作れません）

## 守ること

- **依存ライブラリを増やさない**（オフライン配布・exe 肥大化のため）。
  ttkbootstrap / CustomTkinter は検討済みで**不採用**（理由は引き継ぎ文書 §5）
- **判定表は外部 CSV**（`data/`、BOM 付き UTF-8）。exe に埋め込まない
- **判断ロジックは GUI から分離**したまま保つ（tkinter 無しで検証できること）
- **実データは使わない。** `python 見本データを作る.py` で見本 PDF を作って検証する
- 配色は **WCAG コントラスト比（本文 4.5:1 / 枠線 3.0:1）** を `tests/test_theme.py` で担保
- `python -m pip` / `python -m PyInstaller` を使う（`pip` は実機で認識されない）

## 検証

```bash
python -m pytest tests/ -q     # 288 件
```
