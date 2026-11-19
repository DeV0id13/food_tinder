import apps.catalog.models
import apps.catalog.validators
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="recipe",
            name="photo",
            field=models.ImageField(
                blank=True,
                help_text="JPEG, PNG, or WebP. Up to 10 MB and 24 megapixels.",
                upload_to=apps.catalog.models.recipe_photo_path,
                validators=[apps.catalog.validators.validate_recipe_photo],
            ),
        ),
    ]
