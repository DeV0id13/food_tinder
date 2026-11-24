# Gunicorn loads this file from its existing working directory, /app.
# Skip URL, query string, IP, referrer, cookies and request headers.
access_log_format = '{"event":"gunicorn_access","status":%(s)s,"duration_us":%(D)s}'
