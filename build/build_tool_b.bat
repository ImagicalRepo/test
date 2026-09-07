@echo off
rem ツールB（審査判断支援ツール）を exe にする
rem 判定表は exe に埋め込まず、data フォルダの CSV を読む。
rem そのため判定内容の修正に再ビルドは要らない。
cd /d "%~dp0\.."

pyinstaller ^
  --noconfirm ^
  --onedir ^
  --windowed ^
  --name "書類審査 判断支援ツール" ^
  --distpath "build\dist" ^
  --workpath "build\work" ^
  --specpath "build" ^
  --paths "src" ^
  --exclude-module numpy ^
  --exclude-module fitz ^
  --exclude-module pymupdf ^
  tool_b.py

echo.
echo 出力先: build\dist\書類審査 判断支援ツール\
echo data フォルダをこのフォルダの中にコピーしてください。
pause
