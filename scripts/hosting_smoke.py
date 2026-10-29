"""Check the public production command and browser workflows without login."""
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
runtime = ROOT / '.venv/bin/gunicorn'
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
base_url = f'http://127.0.0.1:{port}'
settings = {k: v for k, v in os.environ.items() if k not in ('APP_USERNAME', 'APP_PASSWORD', 'TEST_APP_USERNAME', 'TEST_APP_PASSWORD')}
settings['PORT'] = str(port)
result = subprocess.run([str(runtime), '--check-config', '--config', 'gunicorn.conf.py', 'webapp:create_app()'], cwd=ROOT, env=settings, capture_output=True, timeout=20)
assert result.returncode == 0, 'Production entrypoint must start without credentials'
process = subprocess.Popen([str(runtime), '--config', 'gunicorn.conf.py', 'webapp:create_app()'], cwd=ROOT, env=settings, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(40):
        if process.poll() is not None:
            raise RuntimeError('Production process did not start')
        try:
            with urlopen(base_url + '/api/health', timeout=1) as response:
                assert response.status == 200
                break
        except (URLError, TimeoutError, ConnectionResetError):
            time.sleep(0.2)
    else:
        raise RuntimeError('Production health check did not become ready')
    with urlopen(base_url + '/', timeout=3) as response:
        assert response.status == 200
        assert response.headers.get('WWW-Authenticate') is None
        assert '中国港湾账目核对平台' in response.read().decode('utf-8')
    browser_settings = {**settings, 'TEST_BASE_URL': base_url}
    subprocess.run([sys.executable, 'scripts/browser_smoke.py'], cwd=ROOT, env=browser_settings, check=True, timeout=90)
    print('Public production startup without credentials, health check, homepage without login and full browser workflow passed.')
finally:
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
