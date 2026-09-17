import pytest


@pytest.fixture(autouse=True)
def test_http_settings(settings):
    settings.ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
    settings.SECURE_SSL_REDIRECT = False
