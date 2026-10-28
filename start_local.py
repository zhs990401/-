"""Beginner-friendly local launcher: install into .venv and open the browser."""
import http.client
from pathlib import Path
import runpy
import socket
import subprocess
import sys
import threading
import time
import traceback
import webbrowser

ROOT = Path(__file__).resolve().parent


def find_port():
    for port in range(8000, 8011):
        with socket.socket() as probe:
            try:
                probe.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    raise RuntimeError('8000 至 8010 端口均被占用，请关闭先前启动的窗口后重试。')


def open_when_ready(port):
    for _ in range(80):
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=1)
        try:
            connection.request('GET', '/api/health')
            response = connection.getresponse()
            if response.status == 200 and b'"ok"' in response.read():
                webbrowser.open(f'http://127.0.0.1:{port}')
                return
        except OSError:
            pass
        finally:
            connection.close()
        time.sleep(0.25)
    print('未能自动打开浏览器，请检查上方错误信息。', flush=True)


def main():
    if sys.version_info < (3, 10):
        raise RuntimeError('需要 Python 3.10 或更新版本，请升级 Python 后重试。')
    python = ROOT / '.venv' / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
    if not python.is_file():
        print('首次启动：正在创建项目运行环境…', flush=True)
        subprocess.run([sys.executable, '-m', 'venv', str(ROOT / '.venv')], check=True, cwd=ROOT)
    check = ('from importlib.metadata import version; '
             "assert version('openpyxl') == '3.1.5'; "
             "assert version('xlrd') == '2.0.1'; "
             "assert version('et-xmlfile') == '2.0.0'; "
             "assert version('defusedxml') == '0.7.1'")
    installed = subprocess.run([str(python), '-c', check], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if installed.returncode:
        print('正在安装运行依赖，首次启动需要联网，请稍候…', flush=True)
        subprocess.run([str(python), '-m', 'pip', '--disable-pip-version-check', 'install', '-r', str(ROOT / 'requirements.txt')], check=True, cwd=ROOT)
    if Path(sys.prefix).resolve() != (ROOT / '.venv').resolve():
        return subprocess.call([str(python), str(Path(__file__).resolve())], cwd=ROOT)
    port = find_port()
    print('网页即将自动打开。请保持本窗口打开；关闭窗口会停止服务。', flush=True)
    print(f'如果浏览器没有打开，可在本机浏览器地址栏输入 127.0.0.1:{port}', flush=True)
    threading.Thread(target=open_when_ready, args=(port,), daemon=True).start()
    sys.argv = [str(ROOT / 'server.py'), '--port', str(port)]
    runpy.run_path(str(ROOT / 'server.py'), run_name='__main__')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print('\n服务已停止。')
    except Exception:
        print('\n启动失败。请保留下面的错误信息，截图时遮住个人信息。', flush=True)
        traceback.print_exc()
        raise SystemExit(1)
