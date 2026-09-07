@echo off
rem ツールA（資料作成支援ツール）を exe にする
rem --onedir を使う理由:
rem   1) 起動が速い（--onefile は毎回展開するため数秒かかる）
rem   2) セキュリティソフトの誤検知が少ない
cd /d "%~dp0\.."

pyinstaller ^
  --noconfirm ^
  --onedir ^
  --windowed ^
  --name "資料作成支援ツール" ^
  --distpath "build\dist" ^
  --workpath "build\work" ^
  --specpath "build" ^
  --paths "src" ^
  tool_a.py

echo.
echo 出力先: build\dist\資料作成支援ツール\
echo data フォルダをこのフォルダの中にコピーしてください。
pause
