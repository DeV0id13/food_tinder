import runpy
from pathlib import Path

import pytest

SETTINGS_PATH = Path(__file__).resolve().parent.parent / "config" / "settings.py"


@pytest.mark.parametrize("debug", ["true", "false"])
def test_hsts_defaults_are_disabled_without_weakening_https(monkeypatch, debug):
    monkeypatch.setenv("DJANGO_DEBUG", debug)
    for name in (
        "DJANGO_SECURE_HSTS_SECONDS",
        "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS",
        "DJANGO_SECURE_HSTS_PRELOAD",
        "SESSION_COOKIE_SECURE",
        "CSRF_COOKIE_SECURE",
        "SECURE_SSL_REDIRECT",
    ):
        monkeypatch.delenv(name, raising=False)

    config = runpy.run_path(str(SETTINGS_PATH))

    assert config["SECURE_HSTS_SECONDS"] == 0
    assert config["SECURE_HSTS_INCLUDE_SUBDOMAINS"] is False
    assert config["SECURE_HSTS_PRELOAD"] is False
    assert config["SESSION_COOKIE_SECURE"] is (debug == "false")
    assert config["CSRF_COOKIE_SECURE"] is (debug == "false")
    assert config["SECURE_SSL_REDIRECT"] is (debug == "false")


def test_hsts_can_be_enabled_explicitly(monkeypatch):
    monkeypatch.setenv("DJANGO_DEBUG", "false")
    monkeypatch.setenv("DJANGO_SECURE_HSTS_SECONDS", "31536000")
    monkeypatch.setenv("DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS", "true")
    monkeypatch.setenv("DJANGO_SECURE_HSTS_PRELOAD", "true")

    config = runpy.run_path(str(SETTINGS_PATH))

    assert config["SECURE_HSTS_SECONDS"] == 31536000
    assert config["SECURE_HSTS_INCLUDE_SUBDOMAINS"] is True
    assert config["SECURE_HSTS_PRELOAD"] is True
