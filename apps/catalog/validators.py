from io import BytesIO
from pathlib import Path

from django.core.exceptions import ValidationError
from PIL import Image

MEAL_TYPES = ("breakfast", "lunch", "snack", "dinner")
RECIPE_PHOTO_FORMATS = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP"}
MAX_RECIPE_PHOTO_BYTES = 10 * 1024 * 1024
MAX_RECIPE_PHOTO_PIXELS = 24_000_000


def validate_meal_types(value):
    if not isinstance(value, list) or not value:
        raise ValidationError("Meal types must be a nonempty array.")
    if any(not isinstance(item, str) or item not in MEAL_TYPES for item in value):
        raise ValidationError("Meal types contain an unsupported value.")
    if len(value) != len(set(value)):
        raise ValidationError("Meal types must not repeat.")


def validate_steps(value):
    if not isinstance(value, list) or not value:
        raise ValidationError("Steps must be a nonempty array.")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise ValidationError("Each step must be a nonempty string.")


def validate_recipe_photo(value):
    if getattr(value, "_committed", False):
        return

    expected_format = RECIPE_PHOTO_FORMATS.get(Path(value.name).suffix.lower())
    if not expected_format:
        raise ValidationError("Choose a JPEG, PNG, or WebP image.")

    value.seek(0)
    try:
        content = value.read(MAX_RECIPE_PHOTO_BYTES + 1)
    finally:
        value.seek(0)
    if len(content) > MAX_RECIPE_PHOTO_BYTES:
        raise ValidationError("The recipe photo must be 10 MB or smaller.")

    try:
        with Image.open(BytesIO(content), formats=[expected_format]) as image:
            if image.width * image.height > MAX_RECIPE_PHOTO_PIXELS:
                raise ValidationError("The recipe photo must be 24 megapixels or smaller.")
            if getattr(image, "is_animated", False):
                raise ValidationError("Choose a still image for the recipe photo.")
            image.load()
    except Image.DecompressionBombError as exc:
        raise ValidationError("The recipe photo must be 24 megapixels or smaller.") from exc
    except (OSError, SyntaxError, ValueError) as exc:
        raise ValidationError("The image is damaged or does not match its extension.") from exc
