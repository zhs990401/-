"""Public WSGI entrypoint for hosted deployments; no login required."""
import json
import threading
from urllib.parse import urlsplit
from zipfile import BadZipFile

import openpyxl
import xlrd
from reconcile import reconcile, reconcile_projects, reconcile_account
from cashflow import calculate_cashflow, export_cashflow
from project_import import project_template
from server import ROOT, export_report, parse_file, validate_dataset

MAX_REQUEST = 40 * 1024 * 1024


class OnlineApp:
    def __init__(self):
        # Limit expensive financial processing across public requests.
        self.processing = threading.BoundedSemaphore(1)

    def __call__(self, environ, start_response):
        def respond(status, body, content_type='application/json; charset=utf-8', extra=()):
            if isinstance(body, (dict, list)):
                body = json.dumps(body, ensure_ascii=False).encode('utf-8')
            elif isinstance(body, str):
                body = body.encode('utf-8')
            headers = [('Content-Type', content_type), ('Content-Length', str(len(body))),
                       ('Cache-Control', 'no-store'), ('X-Content-Type-Options', 'nosniff'),
                       ('Referrer-Policy', 'no-referrer'),
                       ('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'")]
            start_response(status, headers + list(extra))
            return [body]

        path, method = environ.get('PATH_INFO', '/'), environ.get('REQUEST_METHOD', 'GET')
        if path == '/api/health' and method == 'GET':
            return respond('200 OK', {'status': 'ok'})
        if method == 'GET':
            if path == '/api/project-template':
                return respond('200 OK', project_template(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            files = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8'), '/cashflow.js': ('cashflow.js', 'text/javascript; charset=utf-8')}
            if path not in files:
                return respond('404 Not Found', {'error': '页面不存在'})
            filename, mime = files[path]
            return respond('200 OK', (ROOT / filename).read_bytes(), mime)
        if method != 'POST':
            return respond('405 Method Not Allowed', {'error': '请求方法不支持'}, extra=[('Allow', 'GET, POST')])
        # Reject processing requests from a foreign website.
        origin = environ.get('HTTP_ORIGIN')
        if origin:
            parsed_origin = urlsplit(origin)
            if parsed_origin.netloc != environ.get('HTTP_HOST') or parsed_origin.scheme not in ('http', 'https'):
                return respond('403 Forbidden', {'error': '不允许跨站请求'})
        if environ.get('CONTENT_TYPE', '').split(';')[0] != 'application/json':
            return respond('415 Unsupported Media Type', {'error': '请求格式必须为 JSON'})
        if path not in ('/api/parse', '/api/reconcile', '/api/projects', '/api/export', '/api/cashflow', '/api/cashflow/export'):
            return respond('404 Not Found', {'error': '接口不存在'})
        try:
            length = int(environ.get('CONTENT_LENGTH') or 0)
        except ValueError:
            return respond('400 Bad Request', {'error': '请求长度无效'})
        if not 0 < length <= MAX_REQUEST:
            return respond('413 Content Too Large', {'error': '请求为空或超过大小限制'})
        if not self.processing.acquire(blocking=False):
            return respond('429 Too Many Requests', {'error': '正在处理另一份明细，请稍后重试'}, extra=[('Retry-After', '3')])
        try:
            content = environ['wsgi.input'].read(length)
            if len(content) != length:
                return respond('400 Bad Request', {'error': '上传未完成，请重试'})
            payload = json.loads(content)
            if not isinstance(payload, dict):
                raise ValueError('请求内容必须为对象')
            if path == '/api/parse':
                result = parse_file(payload)
            elif path == '/api/reconcile':
                for side in ('left', 'right'):
                    validate_dataset(payload[side])
                result = reconcile_account(payload)
            elif path == '/api/cashflow':
                datasets = payload.get('datasets')
                if not isinstance(datasets, list) or not 1 <= len(datasets) <= 20:
                    raise ValueError('现金流统计支持 1 至 20 份流水')
                for dataset in datasets:
                    validate_dataset(dataset)
                result = calculate_cashflow(payload)
            elif path == '/api/cashflow/export':
                return respond('200 OK', export_cashflow(payload), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            elif path == '/api/projects':
                datasets = payload.get('datasets')
                if not isinstance(datasets, list) or not 1 <= len(datasets) <= 20:
                    raise ValueError('项目往来账支持 1 至 20 份文件')
                for dataset in datasets:
                    validate_dataset(dataset)
                if sum(len(d['rows']) for d in datasets) > 60000:
                    raise ValueError('本次项目往来明细合计不能超过 60,000 行，请缩小期间')
                result = reconcile_projects(payload)
            else:
                return respond('200 OK', export_report(payload), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            return respond('200 OK', result)
        except (ValueError, KeyError, TypeError, BadZipFile, xlrd.XLRDError, openpyxl.utils.exceptions.InvalidFileException, OverflowError, IndexError) as error:
            message = str(error)[:240] if isinstance(error, ValueError) else '文件或数据格式无效，请检查文件、字段映射及核对规则'
            return respond('400 Bad Request', {'error': message})
        except Exception:
            return respond('500 Internal Server Error', {'error': '处理失败，请缩小文件后重试'})
        finally:
            self.processing.release()


def create_app():
    return OnlineApp()
