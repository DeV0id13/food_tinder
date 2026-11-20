from django.dispatch import Signal

# Sent while the plan is locked, after its slots have been changed.
plan_slots_changed = Signal()
