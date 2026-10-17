import pytest


@pytest.fixture(autouse=True)
def planning_urls(settings):
    settings.ROOT_URLCONF = "tests.planning.urls"
