from rest_framework import generics
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.permissions import AllowAny

from .models import Recipe
from .serializers import RecipeDetailSerializer, RecipeSummarySerializer


class RecipePagination(LimitOffsetPagination):
    default_limit = 30
    max_limit = 100


class RecipeListView(generics.ListAPIView):
    permission_classes = (AllowAny,)
    serializer_class = RecipeSummarySerializer
    pagination_class = RecipePagination
    queryset = Recipe.objects.filter(is_active=True).order_by("id")


class RecipeDetailView(generics.RetrieveAPIView):
    permission_classes = (AllowAny,)
    serializer_class = RecipeDetailSerializer
    lookup_url_kwarg = "recipe_id"
    queryset = Recipe.objects.filter(is_active=True).prefetch_related(
        "ingredient_lines__ingredient"
    )
