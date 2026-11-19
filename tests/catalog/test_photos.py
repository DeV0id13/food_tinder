import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.catalog.validators import MAX_RECIPE_PHOTO_BYTES

pytestmark = pytest.mark.django_db


def test_uploaded_photo_is_same_origin_in_all_recipe_responses(
    client, recipe_line, recipe_media, photo_upload
):
    recipe = recipe_line.recipe
    recipe.image_url = "https://example.test/legacy.jpg"
    recipe.save()
    detail = f"/api/v1/recipes/{recipe.pk}/"
    assert client.get(detail).json()["image_url"] == recipe.image_url

    recipe.photo = photo_upload("recipe.webp", "WEBP")
    recipe.save()
    photo_url = recipe.photo.url
    assert photo_url.startswith("/media/recipes/")
    assert (recipe_media / recipe.photo.name).is_file()
    assert client.get(detail).json()["image_url"] == photo_url

    user = get_user_model().objects.create_user("photo-viewer@example.test", "RecipePhoto_1")
    client.force_login(user)
    favorite = client.put(
        f"/api/v1/preferences/favorites/{recipe.pk}/",
        {"is_favorite": True},
        content_type="application/json",
    )
    assert favorite.status_code == 200
    for endpoint in ("recipes/", "preferences/feed/", "preferences/favorites/"):
        response = client.get(f"/api/v1/{endpoint}")
        assert response.status_code == 200
        assert response.json()["results"][0]["image_url"] == photo_url


def test_model_rejects_oversized_photo(recipe, recipe_media, photo_upload):
    valid_content = photo_upload().read()
    oversized = valid_content.ljust(MAX_RECIPE_PHOTO_BYTES + 1, b"0")
    recipe.photo = SimpleUploadedFile("large.png", oversized)
    with pytest.raises(ValidationError, match="10 MB or smaller"):
        recipe.save()
    assert not list(recipe_media.glob("recipes/*"))
