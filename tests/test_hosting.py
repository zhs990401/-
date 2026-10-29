from io import BytesIO
import json
import unittest
from unittest.mock import patch

from webapp import MAX_REQUEST, OnlineApp, create_app


class HostingTests(unittest.TestCase):
    def setUp(self):
        self.app = OnlineApp()

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

    def test_public_entrypoint_needs_no_credentials_and_ignores_old_settings(self):
        for settings in ({}, {'APP_USERNAME': 'old-user', 'APP_PASSWORD': 'old-password'}):
            with patch.dict('os.environ', settings, clear=True):
                self.app = create_app()
                self.assertTrue(self.call()['status'].startswith('200'))

    def test_public_pages_and_template_do_not_challenge_for_login(self):
        for path in ('/', '/app.js', '/cashflow.js', '/style.css', '/api/project-template'):
            for auth in ('', 'Basic stale-browser-credentials'):
                result = self.call(path, HTTP_AUTHORIZATION=auth)
                self.assertTrue(result['status'].startswith('200'))
                self.assertNotIn('WWW-Authenticate', result['headers'])

    def test_health_is_public_but_has_no_ledger_details(self):
        result = self.call('/api/health')
        self.assertEqual(json.loads(result['body']), {'status': 'ok'})

    def test_public_homepage_and_cross_site_protection(self):
        result = self.call()
        self.assertTrue(result['status'].startswith('200'))
        self.assertIn(b'<!doctype html>', result['body'])
        result = self.call('/api/parse', 'POST', {}, HTTP_ORIGIN='https://foreign.test')
        self.assertTrue(result['status'].startswith('403'))

    def test_invalid_input_and_busy_requests_fail_cleanly(self):
        result = self.call('/api/parse', 'POST', {}, CONTENT_LENGTH=str(MAX_REQUEST + 1))
        self.assertTrue(result['status'].startswith('413'))
        self.app.processing.acquire()
        try:
            result = self.call('/api/parse', 'POST', {})
            self.assertTrue(result['status'].startswith('429'))
        finally:
            self.app.processing.release()
        result = self.call('/api/parse', 'POST', {})
        self.assertTrue(result['status'].startswith('400'))

    def test_public_reconciliation_runs_real_financial_engine(self):
        dataset = {'headers': ['日期', '借方', '贷方'], 'rows': [['2026-01-01', '100', '']],
                   'accountName': '测试银行001',
                   'mapping': {'mode': 'split', 'date': '日期', 'debit': '借方', 'credit': '贷方'}}
        result = self.call('/api/reconcile', 'POST', {'left': dataset, 'right': dataset, 'options': {'accountScope': '测试银行001'}}, HTTP_ORIGIN='https://example.test')
        self.assertTrue(result['status'].startswith('200'))
        self.assertEqual(len(json.loads(result['body'])['matched']), 1)
        self.assertEqual(result['headers']['Cache-Control'], 'no-store')


if __name__ == '__main__':
    unittest.main()
