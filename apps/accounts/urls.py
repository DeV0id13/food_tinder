from django.urls import path

from .views import account, change_email, login, logout, profile, register, session

app_name = "accounts"
urlpatterns = [
    path("session/", session, name="session"),
    path("register/", register, name="register"),
    path("login/", login, name="login"),
    path("logout/", logout, name="logout"),
    path("profile/", profile, name="profile"),
    path("account/", account, name="account"),
    path("account/email/", change_email, name="change-email"),
]
