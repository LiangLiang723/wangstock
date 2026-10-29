@echo off
setlocal
cd /d "%~dp0"

set "CARGO=%USERPROFILE%\.cargo\bin\cargo.exe"
if not exist "%CARGO%" (
  echo.
  echo  [!] 未检测到 Rust 工具链。
  echo      请先安装：https://rustup.rs  或运行以下命令
  echo      winget install Rustlang.Rustup
  echo.
  pause
  exit /b 1
)

echo 正在编译 wangstock（首次编译约 3-8 分钟）...
"%CARGO%" build --release --manifest-path "%~dp0src-tauri\Cargo.toml"
if errorlevel 1 (
  echo.
  echo  [!] 编译失败，请查看上方错误信息。
  pause
  exit /b 1
)

copy /Y "%~dp0src-tauri\target\release\wangstock.exe" "%~dp0wangstock.exe" >nul

echo.
echo  [OK] 编译完成：%~dp0wangstock.exe
echo       直接双击该 exe 即可运行，无需安装。
echo.
pause
