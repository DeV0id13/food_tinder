from django.db import migrations


def favorite_existing_likes(apps, schema_editor):
    state = apps.get_model("preferences", "UserRecipeState")
    state.objects.using(schema_editor.connection.alias).filter(
        liked_at__isnull=False,
        is_favorite=False,
    ).update(is_favorite=True)


class Migration(migrations.Migration):
    dependencies = [
        ("preferences", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(favorite_existing_likes, migrations.RunPython.noop),
    ]
