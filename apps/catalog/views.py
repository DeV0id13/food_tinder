from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import generics
from rest_framework.permissions import AllowAny

from common.pagination import StandardPagination
from common.schema import NOT_FOUND, PAGE_PARAMETERS, RECIPE_ID

from .models import Recipe
from .serializers import RecipeDetailSerializer, RecipeSummarySerializer


@extend_schema_view(
    get=extend_schema(parameters=PAGE_PARAMETERS, responses=RecipeSummarySerializer(many=True))
)
class RecipeListView(generics.ListAPIView):
    permission_classes = (AllowAny,)
    serializer_class = RecipeSummarySerializer
    pagination_class = StandardPagination
    queryset = Recipe.objects.filter(is_active=True).order_by("id")


@extend_schema_view(
    get=extend_schema(
        parameters=[RECIPE_ID], responses={200: RecipeDetailSerializer, 404: NOT_FOUND}
    )
)
class RecipeDetailView(generics.RetrieveAPIView):
    permission_classes = (AllowAny,)
    serializer_class = RecipeDetailSerializer
    lookup_url_kwarg = "recipe_id"
    queryset = Recipe.objects.filter(is_active=True).prefetch_related(
        "ingredient_lines__ingredient"
    )
