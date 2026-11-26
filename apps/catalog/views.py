from django.db.models import QuerySet
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import generics
from rest_framework.permissions import AllowAny

from common.pagination import StandardPagination
from common.schema import NOT_FOUND, RECIPE_ID, VALIDATION_ERROR

from .filters import CatalogFilters
from .models import Recipe
from .serializers import RecipeDetailSerializer, RecipeSummarySerializer


@extend_schema_view(
    get=extend_schema(
        parameters=[CatalogFilters],
        responses={200: RecipeSummarySerializer(many=True), 400: VALIDATION_ERROR},
    )
)
class RecipeListView(generics.ListAPIView):
    permission_classes = (AllowAny,)
    serializer_class = RecipeSummarySerializer
    pagination_class = StandardPagination
    queryset = Recipe.objects.filter(is_active=True)

    def get_queryset(self) -> QuerySet[Recipe]:
        # QueryDict's HTML form handling can omit explicit empty values.
        filters = CatalogFilters(data=self.request.query_params.dict())
        filters.is_valid(raise_exception=True)
        user_id = self.request.user.pk if self.request.user.is_authenticated else None
        return filters.apply(self.queryset, user_id)


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
