"""Create or remove one run's synthetic users in the isolated demo Compose database."""

# The application registry must be initialized before importing Django models.
# ruff: noqa: E402

import json
import os
import random
import re
import secrets
import sys
from datetime import date

import django
from django.conf import settings

if (
    os.environ.get("FOODTINDER_DEMO") != "1"
    or os.environ.get("POSTGRES_DB") != "foodtinder_demo"
    or os.environ.get("POSTGRES_HOST") != "postgres"
):
    raise SystemExit("The benchmark fixture requires the isolated make demo database.")

os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"
django.setup()

from django.contrib.auth import BACKEND_SESSION_KEY, HASH_SESSION_KEY, SESSION_KEY, get_user_model
from django.contrib.auth.hashers import make_password
from django.contrib.sessions.backends.db import SessionStore
from django.contrib.sessions.models import Session
from django.db import transaction
from django.utils import timezone

from apps.catalog.models import Recipe
from apps.planning.models import MealPlan, MealPlanSlot
from apps.preferences.models import UserRecipeState

User = get_user_model()
MEALS = ("breakfast", "lunch", "snack", "dinner")


def seed(token, count):
    if User.objects.filter(email__startswith=f"ftbench-{token}-").exists():
        raise SystemExit("Run ID already exists")
    recipes = list(Recipe.objects.filter(is_active=True).values_list("id", "meal_types"))
    compatible = {meal: [pk for pk, meals in recipes if meal in meals] for meal in MEALS}
    if min(map(len, compatible.values())) < 4:
        raise SystemExit("Each meal requires at least four published recipes")
    password = secrets.token_urlsafe(27)
    password_hash = make_password(password)
    rng = random.Random(token)
    users = User.objects.bulk_create(
        User(
            email=f"ftbench-{token}-vu-{i}@example.test",
            first_name="Тест FoodTinder",
            password=password_hash,
        )
        for i in range(count)
    )
    sessions = []
    now = timezone.now()
    for user in users:
        favorites = {pk for meal in MEALS for pk in rng.sample(compatible[meal], 4)}
        UserRecipeState.objects.bulk_create(
            UserRecipeState(user=user, recipe_id=pk, is_favorite=True, favorited_at=now)
            for pk in favorites
        )
        duration = rng.choice((1, 3, 7))
        plan = MealPlan.objects.create(
            user=user,
            start_date=date.today(),
            duration_days=duration,
            enabled_meals=list(MEALS),
            title="Тест FoodTinder",
        )
        MealPlanSlot.objects.bulk_create(
            MealPlanSlot(
                plan=plan,
                day_index=day,
                meal_type=meal,
                recipe_id=rng.choice(sorted(favorites.intersection(compatible[meal]))),
                servings=rng.randint(1, 4),
            )
            for day in range(duration)
            for meal in MEALS
        )
        session = SessionStore()
        session[SESSION_KEY] = str(user.pk)
        session[BACKEND_SESSION_KEY] = settings.AUTHENTICATION_BACKENDS[0]
        session[HASH_SESSION_KEY] = user.get_session_auth_hash()
        session.create()
        sessions.append({"id": user.pk, "key": session.session_key, "plan": plan.pk})
    return {"run": token, "password": password, "sessions": sessions}


def cleanup(token):
    matching = User.objects.filter(
        email__regex=rf"^ftbench-{token}-(vu|auth)-[a-z0-9-]+@example\.test$",
        is_staff=False,
        is_superuser=False,
    )
    ids = {str(pk) for pk in matching.values_list("pk", flat=True)}
    sessions = [
        session.session_key
        for session in Session.objects.iterator()
        if session.get_decoded().get(SESSION_KEY) in ids
    ]
    Session.objects.filter(session_key__in=sessions).delete()
    _, counts = matching.delete()
    if matching.exists():
        raise RuntimeError("Synthetic users remain")
    return {"deleted": counts, "sessions_deleted": len(sessions)}


if __name__ == "__main__":
    operation, token = sys.argv[1:3]
    if not re.fullmatch(r"[a-f0-9]{16}", token) or operation not in {"seed", "cleanup"}:
        raise SystemExit("Usage: fixtures.py seed|cleanup <16 hex run ID>")
    with transaction.atomic():
        if operation == "seed":
            count = int(sys.argv[3])
            if not 6 <= count <= 256:
                raise SystemExit("Use between 6 and 256 virtual users")
            output = seed(token, count)
        else:
            output = cleanup(token)
    print(json.dumps(output))
