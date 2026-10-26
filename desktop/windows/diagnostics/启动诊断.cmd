@echo off
setlocal
chcp 65001 >nul
set "H2F_DIAG_EXE=%~1"
if not defined H2F_DIAG_EXE if exist "%~dp0HTML to Figma Capture.exe" set "H2F_DIAG_EXE=%~dp0HTML to Figma Capture.exe"
if not defined H2F_DIAG_EXE if exist "%LOCALAPPDATA%\Programs\HTML to Figma Capture\HTML to Figma Capture.exe" set "H2F_DIAG_EXE=%LOCALAPPDATA%\Programs\HTML to Figma Capture\HTML to Figma Capture.exe"
if not defined H2F_DIAG_EXE if exist "%ProgramFiles%\HTML to Figma Capture\HTML to Figma Capture.exe" set "H2F_DIAG_EXE=%ProgramFiles%\HTML to Figma Capture\HTML to Figma Capture.exe"
if not defined H2F_DIAG_EXE (
  echo 未找到助手。请把本工具的两个文件复制到助手 EXE 所在目录，再双击运行。
  echo 也可将 HTML to Figma Capture.exe 拖到本 CMD 文件上。
  pause
  exit /b 1
)
if not exist "%H2F_DIAG_EXE%" (
  echo 指定的 EXE 文件不存在。
  pause
  exit /b 1
)
echo 请先从助手托盘菜单退出应用，诊断会短暂启动后台服务并自动关闭。
echo 本工具不会捕获网页，不会删除配对或捕获数据。
pause
set "ELECTRON_RUN_AS_NODE=1"
set "NODE_OPTIONS="
set "NODE_PATH="
"%H2F_DIAG_EXE%" "%~dp0diagnose.cjs" "%H2F_DIAG_EXE%" "%~dp0."
echo.
echo 完成后请发送同目录的 H2F-Windows-startup-*.json 报告。
pause
endlocal
