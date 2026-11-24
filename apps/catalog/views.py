from rest_framework import generics
from rest_framework.permissions import AllowAny

from common.pagination import StandardPagination

from .models import Recipe
from .serializers import RecipeDetailSerializer, RecipeSummarySerializer


class RecipeListView(generics.ListAPIView):
    permission_classes = (AllowAny,)
    serializer_class = RecipeSummarySerializer
    pagination_class = StandardPagination
    queryset = Recipe.objects.filter(is_active=True).order_by("id")


class RecipeDetailView(generics.RetrieveAPIView):
    permission_classes = (AllowAny,)
    serializer_class = RecipeDetailSerializer
    lookup_url_kwarg = "recipe_id"
    queryset = Recipe.objects.filter(is_active=True).prefetch_related(
        "ingredient_lines__ingredient"
    )
