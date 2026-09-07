@echo off
rem DVD に焼く配布物一式を組み立てる
cd /d "%~dp0\.."

call build\build_tool_a.bat
call build\build_tool_b.bat

set OUT=build\配布物
if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%"

xcopy /e /i /y "build\dist\資料作成支援ツール" "%OUT%\資料作成支援ツール"
xcopy /e /i /y "build\dist\書類審査 判断支援ツール" "%OUT%\書類審査 判断支援ツール"
xcopy /e /i /y "data" "%OUT%\資料作成支援ツール\data"
xcopy /e /i /y "data" "%OUT%\書類審査 判断支援ツール\data"
xcopy /e /i /y "docs" "%OUT%\手引き"

echo.
echo 配布物: %OUT%
echo DVD に焼く前に、docs\03_DVD作成前チェックリスト.md を必ず確認してください。
pause
