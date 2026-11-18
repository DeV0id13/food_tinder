import {ApiError} from './errors.js';

const DEMO_USER = {id: 1, email: 'demo@foodtinder.local', password: 'DemoPass_1'};

const DEMO_RECIPES = [
  {
    id: 1,
    title: 'Овсянка с ягодами',
    image_url: '/assets/berries.jpg',
    cooking_time_minutes: 10,
    difficulty: 1,
    base_servings: 2,
    meal_types: ['breakfast', 'snack'],
    kcal_per_serving: '350.00',
    protein_g_per_serving: '12.00',
    fat_g_per_serving: '9.00',
    carbs_g_per_serving: '54.00',
    estimated_price_rub_per_serving: '145.00',
    description: 'Тёплая овсянка на молоке с ягодами и мёдом.',
    steps: ['Сварите хлопья на молоке.', 'Добавьте ягоды и мёд перед подачей.'],
    ingredients: [
      {ingredient_id: 1, name: 'Овсяные хлопья', unit: 'g', quantity: '100.000'},
      {ingredient_id: 2, name: 'Молоко', unit: 'ml', quantity: '360.000'},
      {ingredient_id: 3, name: 'Ягоды', unit: 'g', quantity: '160.000'},
    ],
  },
  {
    id: 2,
    title: 'Зелёный боул с киноа',
    image_url: '/assets/salad.jpg',
    cooking_time_minutes: 25,
    difficulty: 2,
    base_servings: 2,
    meal_types: ['lunch', 'dinner'],
    kcal_per_serving: '420.00',
    protein_g_per_serving: '15.00',
    fat_g_per_serving: '20.00',
    carbs_g_per_serving: '46.00',
    estimated_price_rub_per_serving: '260.00',
    description: 'Киноа, свежие овощи и авокадо с лимонной заправкой.',
    steps: ['Отварите киноа.', 'Нарежьте овощи.', 'Смешайте всё с заправкой.'],
    ingredients: [
      {ingredient_id: 4, name: 'Киноа', unit: 'g', quantity: '120.000'},
      {ingredient_id: 5, name: 'Помидоры', unit: 'g', quantity: '200.000'},
      {ingredient_id: 6, name: 'Авокадо', unit: 'pcs', quantity: '1.000'},
    ],
  },
  {
    id: 3,
    title: 'Паста с песто и томатами',
    image_url: '/assets/pasta.jpg',
    cooking_time_minutes: 20,
    difficulty: 2,
    base_servings: 2,
    meal_types: ['lunch', 'dinner'],
    kcal_per_serving: '510.00',
    protein_g_per_serving: '17.00',
    fat_g_per_serving: '19.00',
    carbs_g_per_serving: '67.00',
    estimated_price_rub_per_serving: '230.00',
    description: 'Паста с зелёным песто, сладкими томатами и пармезаном.',
    steps: ['Отварите пасту.', 'Прогрейте томаты.', 'Смешайте с песто и сыром.'],
    ingredients: [
      {ingredient_id: 7, name: 'Паста', unit: 'g', quantity: '180.000'},
      {ingredient_id: 5, name: 'Помидоры', unit: 'g', quantity: '200.000'},
      {ingredient_id: 8, name: 'Песто', unit: 'g', quantity: '50.000'},
    ],
  },
  {
    id: 4,
    title: 'Лосось с рисом',
    image_url: '/assets/salmon.jpg',
    cooking_time_minutes: 30,
    difficulty: 3,
    base_servings: 2,
    meal_types: ['dinner'],
    kcal_per_serving: '580.00',
    protein_g_per_serving: '35.00',
    fat_g_per_serving: '25.00',
    carbs_g_per_serving: '52.00',
    estimated_price_rub_per_serving: '430.00',
    description: 'Запечённый лосось с рассыпчатым рисом и зеленью.',
    steps: ['Отварите рис.', 'Запеките лосось при 190 °C.', 'Подавайте с зеленью.'],
    ingredients: [
      {ingredient_id: 9, name: 'Лосось', unit: 'g', quantity: '300.000'},
      {ingredient_id: 10, name: 'Рис', unit: 'g', quantity: '120.000'},
    ],
  },
  {
    id: 5,
    title: 'Банановые панкейки',
    image_url: '/assets/pancakes.jpg',
    cooking_time_minutes: 25,
    difficulty: 2,
    base_servings: 2,
    meal_types: ['breakfast', 'snack'],
    kcal_per_serving: '460.00',
    protein_g_per_serving: '16.00',
    fat_g_per_serving: '12.00',
    carbs_g_per_serving: '70.00',
    estimated_price_rub_per_serving: '170.00',
    description: 'Мягкие панкейки со спелым бананом и ягодами.',
    steps: ['Смешайте тесто.', 'Обжарьте небольшие панкейки.', 'Подавайте с ягодами.'],
    ingredients: [
      {ingredient_id: 11, name: 'Бананы', unit: 'pcs', quantity: '2.000'},
      {ingredient_id: 12, name: 'Яйца', unit: 'pcs', quantity: '2.000'},
      {ingredient_id: 13, name: 'Мука', unit: 'g', quantity: '100.000'},
    ],
  },
  {
    id: 6,
    title: 'Тыквенный крем-суп',
    image_url: '/assets/soup.jpg',
    cooking_time_minutes: 35,
    difficulty: 2,
    base_servings: 2,
    meal_types: ['lunch', 'dinner'],
    kcal_per_serving: '370.00',
    protein_g_per_serving: '8.00',
    fat_g_per_serving: '17.00',
    carbs_g_per_serving: '47.00',
    estimated_price_rub_per_serving: '190.00',
    description: 'Бархатистый суп из тыквы и моркови со сливками.',
    steps: ['Отварите овощи.', 'Измельчите блендером.', 'Добавьте сливки и прогрейте.'],
    ingredients: [
      {ingredient_id: 14, name: 'Тыква', unit: 'g', quantity: '500.000'},
      {ingredient_id: 15, name: 'Морковь', unit: 'g', quantity: '120.000'},
      {ingredient_id: 16, name: 'Сливки', unit: 'ml', quantity: '100.000'},
    ],
  },
];

function clone(value) {
  return structuredClone(value);
}

function summary(recipe) {
  const {description, steps, ingredients, ...result} = recipe;
  return result;
}

function page(results) {
  return {count: results.length, next: null, previous: null, results: clone(results)};
}

function validation(details) {
  throw new ApiError({type: 'validation', status: 400, details});
}

export class DemoApi {
  constructor() {
    this.mode = 'demo';
    this.account = {...DEMO_USER};
    this.currentUser = null;
    this.recipeStates = new Map();
    this.plans = [];
    this.nextPlanId = 1;
  }

  requireUser() {
    if (!this.currentUser) throw new ApiError({type: 'auth', status: 403});
  }

  getSession() {
    return Promise.resolve(this.currentUser
      ? {authenticated: true, id: this.currentUser.id, email: this.currentUser.email}
      : {authenticated: false, id: null, email: null});
  }

  async register({email, password}) {
    if (!email || !String(email).includes('@')) validation({email: ['Введите корректный email.']});
    if (!password || password.length < 10) validation({password: ['Пароль должен содержать не менее 10 символов.']});
    this.account = {id: 2, email: String(email).toLowerCase(), password};
    this.recipeStates = new Map();
    this.plans = [];
    this.nextPlanId = 1;
    return {id: this.account.id, email: this.account.email};
  }

  async login({email, password}) {
    if (String(email).toLowerCase() !== this.account.email || password !== this.account.password) {
      validation({non_field_errors: ['Неверный email или пароль.']});
    }
    this.currentUser = {id: this.account.id, email: this.account.email};
    return this.getSession();
  }

  async logout() {
    this.currentUser = null;
    return this.getSession();
  }

  async getFeed() {
    const now = Date.now();
    const recipes = DEMO_RECIPES.filter((recipe) => {
      if (!this.currentUser) return true;
      const state = this.recipeStates.get(recipe.id);
      return !state?.liked_at && !(state?.disliked_until && Date.parse(state.disliked_until) > now);
    }).map(summary);
    return page(recipes);
  }

  async getRecipes() {
    return clone(DEMO_RECIPES.map(summary));
  }

  async getRecipe(recipeId) {
    const recipe = DEMO_RECIPES.find(({id}) => id === Number(recipeId));
    if (!recipe) throw new ApiError({type: 'not_found', status: 404});
    return clone(recipe);
  }

  stateFor(recipeId) {
    const id = Number(recipeId);
    const recipe = DEMO_RECIPES.find((item) => item.id === id);
    if (!recipe) throw new ApiError({type: 'not_found', status: 404});
    if (!this.recipeStates.has(id)) {
      this.recipeStates.set(id, {recipe_id: id, liked_at: null, disliked_until: null, is_favorite: false});
    }
    return this.recipeStates.get(id);
  }

  async swipe(recipeId, action) {
    this.requireUser();
    if (!['like', 'dislike'].includes(action)) validation({action: ['Недопустимое действие.']});
    const state = this.stateFor(recipeId);
    if (action === 'like') {
      state.liked_at ||= new Date().toISOString();
      state.disliked_until = null;
    } else {
      const tomorrow = new Date();
      tomorrow.setUTCHours(24, 0, 0, 0);
      state.disliked_until = tomorrow.toISOString();
    }
    return clone(state);
  }

  async setFavorite(recipeId, isFavorite) {
    this.requireUser();
    const state = this.stateFor(recipeId);
    state.is_favorite = Boolean(isFavorite);
    return clone(state);
  }

  async getFavorites() {
    this.requireUser();
    return clone(DEMO_RECIPES.filter((recipe) => this.recipeStates.get(recipe.id)?.is_favorite).map(summary));
  }

  async getPlans() {
    this.requireUser();
    return clone([...this.plans].sort((a, b) => b.id - a.id).map(({slots, ...plan}) => plan));
  }

  async createPlan({start_date, duration_days, enabled_meals}) {
    this.requireUser();
    const duration = Number(duration_days);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date || '')) validation({start_date: ['Введите дату начала.']});
    if (![1, 3, 7].includes(duration)) validation({duration_days: ['Выберите 1, 3 или 7 дней.']});
    if (!Array.isArray(enabled_meals) || !enabled_meals.length) validation({enabled_meals: ['Выберите приём пищи.']});
    const plan = {
      id: this.nextPlanId++,
      start_date,
      duration_days: duration,
      enabled_meals: [...enabled_meals],
      slots: [],
    };
    this.plans.push(plan);
    return clone(plan);
  }

  planFor(planId) {
    this.requireUser();
    const plan = this.plans.find(({id}) => id === Number(planId));
    if (!plan) throw new ApiError({type: 'not_found', status: 404});
    return plan;
  }

  async getPlan(planId) {
    return clone(this.planFor(planId));
  }

  async deletePlan(planId) {
    this.planFor(planId);
    this.plans = this.plans.filter(({id}) => id !== Number(planId));
    return null;
  }

  async putSlot(planId, dayIndex, mealType, {recipe_id, servings}) {
    const plan = this.planFor(planId);
    const day = Number(dayIndex);
    const portionCount = Number(servings);
    if (!Number.isInteger(day) || day < 0 || day >= plan.duration_days) validation({day_index: ['Недопустимый день.']});
    if (!plan.enabled_meals.includes(mealType)) validation({meal_type: ['Приём пищи выключен.']});
    if (!Number.isInteger(portionCount) || portionCount < 1 || portionCount > 20) validation({servings: ['Допустимо от 1 до 20 порций.']});
    const recipe = DEMO_RECIPES.find(({id}) => id === Number(recipe_id));
    if (!recipe) throw new ApiError({type: 'not_found', status: 404});
    if (!recipe.meal_types.includes(mealType)) validation({recipe_id: ['Рецепт не подходит для этого приёма пищи.']});
    const existing = plan.slots.find((slot) => slot.day_index === day && slot.meal_type === mealType);
    if (!this.recipeStates.get(recipe.id)?.is_favorite && existing?.recipe_id !== recipe.id) {
      validation({recipe_id: ['Сначала добавьте рецепт в избранное.']});
    }
    const slot = {day_index: day, meal_type: mealType, recipe_id: recipe.id, recipe_title: recipe.title, servings: portionCount};
    if (existing) Object.assign(existing, slot);
    else plan.slots.push(slot);
    return clone(slot);
  }

  async deleteSlot(planId, dayIndex, mealType) {
    const plan = this.planFor(planId);
    plan.slots = plan.slots.filter((slot) => !(slot.day_index === Number(dayIndex) && slot.meal_type === mealType));
    return null;
  }

  calculateShopping(planId) {
    const plan = this.planFor(planId);
    const items = new Map();
    for (const slot of plan.slots) {
      const recipe = DEMO_RECIPES.find(({id}) => id === slot.recipe_id);
      for (const line of recipe.ingredients) {
        const current = items.get(line.ingredient_id) || {...line, quantity: 0};
        current.quantity += Number(line.quantity) * slot.servings / recipe.base_servings;
        items.set(line.ingredient_id, current);
      }
    }
    return [...items.values()].sort((a, b) => a.ingredient_id - b.ingredient_id).map((item) => ({
      ingredient_id: item.ingredient_id,
      name: item.name,
      unit: item.unit,
      quantity: item.quantity.toFixed(3),
    }));
  }

  async getShoppingList(planId) {
    return {plan_id: Number(planId), items: this.calculateShopping(planId)};
  }

  async downloadShoppingList(planId, fileType) {
    const items = this.calculateShopping(planId);
    if (!['csv', 'txt'].includes(fileType)) validation({file_type: ['Неизвестный формат.']});
    const text = fileType === 'csv'
      ? `\uFEFFingredient;quantity;unit\r\n${items.map((item) => `${item.name};${item.quantity};${item.unit}`).join('\r\n')}${items.length ? '\r\n' : ''}`
      : (items.length ? items.map((item) => `[ ] ${item.name} — ${item.quantity} ${item.unit}`).join('\n') : 'Список покупок пуст');
    return {
      blob: new Blob([text], {type: fileType === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8'}),
      filename: `shopping-list-${planId}.${fileType}`,
    };
  }
}

export const demoCredentials = {email: DEMO_USER.email, password: DEMO_USER.password};
