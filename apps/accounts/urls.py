from django.urls import path

from .views import session

app_name = "accounts"
urlpatterns = [path("session/", session, name="session")]
