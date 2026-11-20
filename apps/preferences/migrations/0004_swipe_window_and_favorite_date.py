from django.db import migrations, models
from django.db.models import F


def backfill_favorite_dates(apps, schema_editor):
    states = apps.get_model("preferences", "UserRecipeState").objects.using(
        schema_editor.connection.alias
    )
    # Past bookmark-only additions have no recorded time. Leave them unknown.
    states.filter(is_favorite=True, liked_at__isnull=False).update(favorited_at=F("liked_at"))


class Migration(migrations.Migration):
    dependencies = [("preferences", "0003_lastswipe")]

    operations = [
        migrations.AddField(
            model_name="userrecipestate",
            name="favorited_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="lastswipe",
            name="favorited_at",
            field=models.DateTimeField(null=True),
        ),
        migrations.AddField(
            model_name="lastswipe",
            name="swiped_at",
            field=models.DateTimeField(null=True),
        ),
        migrations.RunPython(backfill_favorite_dates, migrations.RunPython.noop),
    ]
