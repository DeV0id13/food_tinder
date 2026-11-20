from django.apps import AppConfig


class ShoppingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.shopping"

    def ready(self):
        from apps.planning.signals import plan_slots_changed

        from .services import invalidate_purchases

        plan_slots_changed.connect(invalidate_purchases)
