from django.urls import path, register_converter

from .views import meal_plan_detail, meal_plan_slot, meal_plans

app_name = "planning"

class SignedIntConverter:
    
    regex = r"-?\d+"

    def to_python(self, value):
        return int(value)

    def to_url(self, value):
        return str(value)


register_converter(SignedIntConverter, "sint")

urlpatterns = [
    path("", meal_plans, name="meal-plans"),
    path("<int:plan_id>/", meal_plan_detail, name="meal-plan-detail"),
    path(
        "<int:plan_id>/slots/<sint:day_index>/<str:meal_type>/",
        meal_plan_slot,
        name="meal-plan-slot",
    ),
]
