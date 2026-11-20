export function normalizeSearch(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
}

export function filterRecipes(recipes, query) {
  const search = normalizeSearch(query);
  return search ? recipes.filter(({title}) => normalizeSearch(title).includes(search)) : recipes;
}


export function matchesRecipeFilters(recipes, {query, meal, maxTime}) {
  return filterRecipes(recipes, query).filter((recipe) =>
    (!meal || recipe.meal_types?.includes(meal))
    && (!maxTime || recipe.cooking_time_minutes <= maxTime));
}
