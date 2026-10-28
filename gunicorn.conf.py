"""Production entrypoint; the hosting platform terminates HTTPS."""
import os

bind = '0.0.0.0:' + str(int(os.environ.get('PORT', '8000')))
workers = 1
worker_class = 'gthread'
threads = 2
timeout = 120
graceful_timeout = 30
max_requests = 1000
max_requests_jitter = 50
accesslog = '-'
errorlog = '-'
# Do not log query strings, headers, credentials or uploaded records.
access_log_format = '%(h)s %(m)s %(U)s %(s)s %(L)s'
