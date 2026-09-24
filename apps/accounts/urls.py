from django.urls import path

from .views import login, logout, profile, register, session

app_name = "accounts"
urlpatterns = [
    path("session/", session, name="session"),
    path("register/", register, name="register"),
    path("login/", login, name="login"),
    path("logout/", logout, name="logout"),
    path("profile/", profile, name="profile"),
]
