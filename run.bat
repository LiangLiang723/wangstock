@echo off
setlocal
cd /d "%~dp0"

set "EXE=%~dp0wangstock.exe"
if not exist "%EXE%" set "EXE=%~dp0src-tauri\target\release\wangstock.exe"
if not exist "%EXE%" (
  echo 未找到已编译的程序，正在构建...
  call "%~dp0build.bat"
  exit /b
)

start "" "%EXE%"
