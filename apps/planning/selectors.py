from rest_framework.exceptions import NotFound

from .models import MealPlan


def get_plan_for_user(*, user, plan_id: int) -> MealPlan:
    """Return the plan only when it belongs to ``user``; otherwise raise 404."""
    try:
        return MealPlan.objects.prefetch_related("slots__recipe").get(pk=plan_id, user=user)
    except MealPlan.DoesNotExist as exc:
        raise NotFound from exc


def get_locked_plan_for_user(*, user, plan_id: int) -> MealPlan:
    """Return the owned plan row locked with ``SELECT FOR UPDATE``; else 404.

    Must be called inside ``transaction.atomic()``. It mirrors
    :func:`get_plan_for_user` but keeps the row lock, so plan deletion and
    slot operations always acquire the ``MealPlan`` row first and in the same
    order. A plan deleted concurrently surfaces as ``NotFound`` (404),
    never as an unhandled ``DoesNotExist`` (500).
    """
    try:
        return MealPlan.objects.select_for_update().get(pk=plan_id, user=user)
    except MealPlan.DoesNotExist as exc:
        raise NotFound from exc
