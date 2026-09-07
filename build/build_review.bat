@echo off
rem 審査データ見直しツール（2名1組で使う本体）を exe にする
rem pyinstaller 単体ではなく python -m PyInstaller を使う。
rem 単体コマンドはパスが通っていないことがある（pip と同じ理由）。
rem --onedir を使う理由:
rem   1) 起動が速い（--onefile は毎回展開するため数秒かかる）
rem   2) セキュリティソフトの誤検知が少ない
cd /d "%~dp0\.."

python -m PyInstaller ^
  --noconfirm ^
  --onedir ^
  --windowed ^
  --name "審査データ見直しツール" ^
  --distpath "build\dist" ^
  --workpath "build\work" ^
  --specpath "build" ^
  --paths "src" ^
  tool_review.py

echo.
echo 出力先: build\dist\審査データ見直しツール\
pause
