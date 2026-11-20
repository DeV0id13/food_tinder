import pytest


@pytest.fixture(autouse=True)
def test_http_settings(settings):
    settings.ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
    settings.SECURE_SSL_REDIRECT = False
    # Fast hashing is confined to pytest; production's strong hashers are unchanged.
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
