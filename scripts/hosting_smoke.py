"""Check the actual production command with ephemeral, unprinted credentials."""
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
runtime = ROOT / '.venv/bin/gunicorn'
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
base_url = f'http://127.0.0.1:{port}'
settings = {**os.environ, 'PORT': str(port), 'APP_USERNAME': 'deployment-smoke',
            'APP_PASSWORD': secrets.token_urlsafe(32)}
# Check fail-closed startup using the same production entrypoint.
missing = {k: v for k, v in settings.items() if k not in ('APP_USERNAME', 'APP_PASSWORD')}
result = subprocess.run([str(runtime), '--check-config', '--config', 'gunicorn.conf.py', 'webapp:create_app()'], cwd=ROOT, env=missing, capture_output=True, timeout=20)
assert result.returncode != 0, 'Production entrypoint must refuse missing credentials'
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
    try:
        urlopen(base_url + '/', timeout=3)
        raise AssertionError('Homepage was accessible without login')
    except HTTPError as error:
        assert error.code == 401
    browser_settings = {**settings, 'TEST_BASE_URL': base_url,
                        'TEST_APP_USERNAME': settings['APP_USERNAME'], 'TEST_APP_PASSWORD': settings['APP_PASSWORD']}
    subprocess.run([sys.executable, 'scripts/browser_smoke.py'], cwd=ROOT, env=browser_settings, check=True, timeout=90)
    print('Production startup, fail-closed credentials, public health check, unauthorized-access rejection and full authenticated browser workflow passed. Test credentials were ephemeral and not saved.')
finally:
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
