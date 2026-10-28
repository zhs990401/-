import base64
from io import BytesIO
import json
import unittest
from unittest.mock import patch

from webapp import MAX_REQUEST, OnlineApp, create_app


class HostingTests(unittest.TestCase):
    def setUp(self):
        # Test-only credentials, never used by an actual deployed instance.
        self.app = OnlineApp('test-user', 'only-for-unit-tests-123456')
        self.auth = 'Basic ' + base64.b64encode(b'test-user:only-for-unit-tests-123456').decode()

    def call(self, path='/', method='GET', payload=None, **overrides):
        data = json.dumps(payload).encode() if payload is not None else b''
        environ = {'PATH_INFO': path, 'REQUEST_METHOD': method, 'HTTP_HOST': 'example.test',
                   'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': str(len(data)),
                   'wsgi.input': BytesIO(data), **overrides}
        result = {}
        def start(status, headers):
            result.update(status=status, headers=dict(headers))
        result['body'] = b''.join(self.app(environ, start))
        return result

    def test_public_entrypoint_requires_configured_credentials(self):
        for username, password in [('', 'long-enough-unit-test-password'), ('a:b', 'long-enough-unit-test-password'), ('user', 'short')]:
            with self.assertRaises(RuntimeError):
                OnlineApp(username, password)
        with patch.dict('os.environ', {}, clear=True):
            with self.assertRaises(RuntimeError):
                create_app()

    def test_unauthenticated_and_bad_password_cannot_read_app_or_apis(self):
        for path, method in [('/', 'GET'), ('/app.js', 'GET'), ('/api/reconcile', 'POST'), ('/api/projects', 'POST'), ('/api/export', 'POST'), ('/api/cashflow', 'POST'), ('/api/cashflow/export', 'POST'), ('/cashflow.js', 'GET')]:
            result = self.call(path, method, {})
            self.assertTrue(result['status'].startswith('401'))
            self.assertIn('WWW-Authenticate', result['headers'])
        for auth in ['Basic ???', 'Bearer not-accepted', 'Basic ' + base64.b64encode(b'test-user:wrong').decode()]:
            self.assertTrue(self.call(HTTP_AUTHORIZATION=auth)['status'].startswith('401'))

    def test_health_is_public_but_has_no_ledger_details(self):
        result = self.call('/api/health')
        self.assertEqual(json.loads(result['body']), {'status': 'ok'})

    def test_correct_login_and_cross_site_protection(self):
        result = self.call(HTTP_AUTHORIZATION=self.auth)
        self.assertTrue(result['status'].startswith('200'))
        self.assertIn(b'<!doctype html>', result['body'])
        result = self.call('/api/parse', 'POST', {}, HTTP_AUTHORIZATION=self.auth, HTTP_ORIGIN='https://foreign.test')
        self.assertTrue(result['status'].startswith('403'))

    def test_invalid_input_and_busy_requests_fail_cleanly(self):
        result = self.call('/api/parse', 'POST', {}, HTTP_AUTHORIZATION=self.auth, CONTENT_LENGTH=str(MAX_REQUEST + 1))
        self.assertTrue(result['status'].startswith('413'))
        self.app.processing.acquire()
        try:
            result = self.call('/api/parse', 'POST', {}, HTTP_AUTHORIZATION=self.auth)
            self.assertTrue(result['status'].startswith('429'))
        finally:
            self.app.processing.release()
        result = self.call('/api/parse', 'POST', {}, HTTP_AUTHORIZATION=self.auth)
        self.assertTrue(result['status'].startswith('400'))

    def test_authenticated_reconciliation_runs_real_financial_engine(self):
        dataset = {'headers': ['日期', '借方', '贷方'], 'rows': [['2026-01-01', '100', '']],
                   'accountName': '测试银行001',
                   'mapping': {'mode': 'split', 'date': '日期', 'debit': '借方', 'credit': '贷方'}}
        result = self.call('/api/reconcile', 'POST', {'left': dataset, 'right': dataset, 'options': {'accountScope': '测试银行001'}}, HTTP_AUTHORIZATION=self.auth, HTTP_ORIGIN='https://example.test')
        self.assertTrue(result['status'].startswith('200'))
        self.assertEqual(len(json.loads(result['body'])['matched']), 1)
        self.assertEqual(result['headers']['Cache-Control'], 'no-store')


if __name__ == '__main__':
    unittest.main()
