#!/usr/bin/env python
"""离屏界面检查：不弹窗、不抢焦点、不模拟鼠标。

用途：在本机有人使用电脑时，也能验证界面是否正常渲染。

做法：
1. 以 SW_HIDE 启动 wangstock，主窗口不进入任务栏/前台；
2. 找到主窗口后立即隐藏并移出可视区域（双保险）；
3. 等待数据加载，用 PrintWindow 直接读取窗口内容，无需窗口可见；
4. 检查截图是否为空白，然后结束进程。

用法：
    python tools/offscreen-shot.py [输出路径] [等待秒数] [选项]
默认输出 %TEMP%/wangstock-offscreen.png，等待 12 秒。

选项（可组合，均不需要显示窗口或模拟鼠标）：
    --detail=代码    直接打开个股详情页，检查分时 / K 线渲染
    --palette        打开搜索添加面板，检查分组多选 chips
    --groups=代码    打开该标的的「管理分组」弹窗

注意：只做渲染检查，不做点击/拖拽类交互验证；这类验证需要在用户同意时
用短时的前台窗口完成，或改为对纯函数与命令层做自动化测试。
"""
import ctypes
import os
import subprocess
import sys
import time
from ctypes import wintypes

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE = os.path.join(ROOT, "wangstock.exe")
_args = sys.argv[1:]
_pos = []
_pass = []
_i = 0
while _i < len(_args):
    _a = _args[_i]
    if _a.startswith("--"):
        if _a == "--detail" and _i + 1 < len(_args):
            _i += 1
            _pass.append("--detail=" + _args[_i])
        else:
            _pass.append(_a)
    else:
        _pos.append(_a)
    _i += 1
OUT = _pos[0] if _pos else os.path.join(os.environ.get("TEMP", "."), "wangstock-offscreen.png")
WAIT = float(_pos[1]) if len(_pos) > 1 else 12.0

u = ctypes.windll.user32
g = ctypes.windll.gdi32
SW_HIDE = 0
SWP_NOSIZE, SWP_NOZORDER, SWP_NOACTIVATE = 0x0001, 0x0004, 0x0010


class BIH(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
        ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG), ("biYPelsPerMeter", wintypes.LONG),
        ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD),
    ]


u.GetWindowDC.restype = wintypes.HDC
g.CreateCompatibleDC.restype = wintypes.HDC
g.CreateCompatibleBitmap.restype = wintypes.HBITMAP
g.SelectObject.restype = wintypes.HGDIOBJ
g.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
g.CreateCompatibleDC.argtypes = [wintypes.HDC]
g.CreateCompatibleBitmap.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int]
g.GetDIBits.argtypes = [wintypes.HDC, wintypes.HBITMAP, ctypes.c_uint, ctypes.c_uint,
                        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint]
g.DeleteObject.argtypes = [wintypes.HGDIOBJ]
g.DeleteDC.argtypes = [wintypes.HDC]
u.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
u.PrintWindow.argtypes = [wintypes.HWND, wintypes.HDC, ctypes.c_uint]
u.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
u.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
u.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                           ctypes.c_int, ctypes.c_int, ctypes.c_uint]
EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
u.EnumWindows.argtypes = [EnumProc, wintypes.LPARAM]


def find_main_window(pid):
    found = []

    def cb(hwnd, _):
        owner = wintypes.DWORD(0)
        u.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid:
            r = wintypes.RECT()
            u.GetWindowRect(hwnd, ctypes.byref(r))
            if r.right - r.left > 600 and r.bottom - r.top > 400:
                found.append((hwnd, r.right - r.left, r.bottom - r.top))
        return True

    u.EnumWindows(EnumProc(cb), 0)
    return found[0] if found else None


def capture(hwnd, width, height):
    src = u.GetWindowDC(hwnd)
    mem = g.CreateCompatibleDC(src)
    bmp = g.CreateCompatibleBitmap(src, width, height)
    g.SelectObject(mem, bmp)
    u.PrintWindow(hwnd, mem, 2)
    bi = BIH()
    bi.biSize = ctypes.sizeof(BIH)
    bi.biWidth, bi.biHeight, bi.biPlanes, bi.biBitCount = width, -height, 1, 32
    buf = ctypes.create_string_buffer(width * height * 4)
    g.GetDIBits(mem, bmp, 0, height, buf, ctypes.byref(bi), 0)
    from PIL import Image
    img = Image.frombuffer("RGBA", (width, height), buf, "raw", "BGRA", 0, 1).convert("RGB")
    g.DeleteObject(bmp)
    g.DeleteDC(mem)
    u.ReleaseDC(hwnd, src)
    return img


def main():
    if not os.path.exists(EXE):
        print("missing", EXE)
        return 2

    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = SW_HIDE
    cmd = [EXE] + _pass
    proc = subprocess.Popen(cmd, cwd=ROOT, startupinfo=startup)

    win = None
    for _ in range(250):
        win = find_main_window(proc.pid)
        if win:
            break
        time.sleep(0.02)
    if not win:
        print("window not found")
        proc.terminate()
        return 1

    hwnd, width, height = win
    # 先移出可视区域，再以「可见但不激活」状态保持渲染。
    # 直接 SW_HIDE 会让 WebView2 停止绘制，PrintWindow 只能拿到空白。
    u.SetWindowPos(hwnd, 0, -32000, -32000, 0, 0,
                   SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)
    u.ShowWindow(hwnd, 4)
    print("offscreen: hwnd=%s size=%dx%d" % (hwnd, width, height))

    time.sleep(WAIT)
    img = capture(hwnd, width, height)
    img.save(OUT)

    small = img.resize((80, 50))
    colors = small.getcolors(80 * 50) or []
    distinct = len(colors)
    print("saved", OUT, "| distinct colors:", distinct,
          "| blank:", distinct < 8, "| alive:", proc.poll() is None)

    proc.terminate()
    time.sleep(0.3)
    try:
        proc.kill()
    except Exception:
        pass
    return 0 if distinct >= 8 else 1


if __name__ == "__main__":
    raise SystemExit(main())
