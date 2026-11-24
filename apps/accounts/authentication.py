from rest_framework.exceptions import NotAuthenticated
from rest_framework.request import Request

from .models import User


def authenticated_user(request: Request) -> User:
    user = request.user
    if not isinstance(user, User):
        raise NotAuthenticated()
    return user
