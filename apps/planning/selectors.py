from rest_framework.exceptions import NotFound

from .models import MealPlan


def get_plan_for_user(*, user, plan_id: int) -> MealPlan:
    """Возвращает план только в том случае, если он принадлежит пользователю, в противном случае выдает ошибку 404."""
    try:
        return MealPlan.objects.prefetch_related("slots__recipe").get(pk=plan_id, user=user)
    except MealPlan.DoesNotExist as exc:
        raise NotFound from exc


def get_locked_plan_for_user(*, user, plan_id: int) -> MealPlan:
    """Возвращает строку с планом, заблокированную с помощью ``SELECT FOR UPDATE``, в противном случае — 404."""
    try:
        return MealPlan.objects.select_for_update().get(pk=plan_id, user=user)
    except MealPlan.DoesNotExist as exc:
        raise NotFound from exc
