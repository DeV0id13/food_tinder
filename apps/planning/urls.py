from django.urls import path

from .views import meal_plan_detail, meal_plan_slot, meal_plans

app_name = "planning"

urlpatterns = [
    path("", meal_plans, name="meal-plans"),
    path("<int:plan_id>/", meal_plan_detail, name="meal-plan-detail"),
    path(
        "<int:plan_id>/slots/<int:day_index>/<str:meal_type>/",
        meal_plan_slot,
        name="meal-plan-slot",
    ),
]
