@echo off
rem 持ち込む一式を組み立てる
cd /d "%~dp0\.."

call build\build_review.bat
call build\build_tool_b.bat

set OUT=build\配布物
if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%"

xcopy /e /i /y "build\dist\審査データ見直しツール" "%OUT%\審査データ見直しツール"
xcopy /e /i /y "build\dist\書類審査 判断支援ツール" "%OUT%\書類審査 判断支援ツール"
xcopy /e /i /y "data" "%OUT%\審査データ見直しツール\data"
xcopy /e /i /y "data" "%OUT%\書類審査 判断支援ツール\data"
xcopy /e /i /y "docs" "%OUT%\手引き"

echo.
echo 配布物: %OUT%
echo.
echo 見直しツールは、作業状態を exe と同じ場所の 作業\ に、
echo 書き出した画像を 出力\ に作ります。書き込みできる場所に置いてください。
pause
