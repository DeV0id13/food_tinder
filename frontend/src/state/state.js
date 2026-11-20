export function defaultFavoriteFilters() {
  return {query: '', meal: '', maxTime: 0, sort: 'added'};
}

export function createInitialState() {
  return {
    initialLoading: true,
    view: 'feed',
    session: {authenticated: false, id: null, email: null},
    sessionKnown: false,
    feed: null,
    feedStatus: 'idle',
    catalog: null,
    catalogStatus: 'idle',
    catalogQuery: '',
    catalogMeal: '',
    catalogMaxTime: 0,
    catalogFavoritesOnly: false,
    favoriteFilters: defaultFavoriteFilters(),
    favorites: null,
    favoritesStatus: 'idle',
    favoriteIds: new Set(),
    guestHidden: new Set(),
    lastSwipe: null,
    plans: null,
    plansStatus: 'idle',
    plansError: null,
    planMode: 'list',
    planDraft: null,
    restoredDraft: false,
    draftStorageUnavailable: false,
    activePlanId: null,
    activePlan: null,
    activePlanStatus: 'idle',
    shoppingPlanId: null,
    shopping: null,
    shoppingStatus: 'idle',
    busy: null,
    error: null,
    authTab: 'login',
    authNotice: null,
    registeredEmail: '',
    account: null,
    accountStatus: 'idle',
  };
}

export function clearPrivateState(state) {
  state.catalogFavoritesOnly = false;
  state.lastSwipe = null;
  state.account = null;
  state.accountStatus = 'idle';
  state.favorites = null;
  state.favoritesStatus = 'idle';
  state.favoriteIds = new Set();
  state.plans = null;
  state.plansStatus = 'idle';
  state.plansError = null;
  state.planMode = 'list';
  state.planDraft = null;
  state.restoredDraft = false;
  state.draftStorageUnavailable = false;
  state.activePlanId = null;
  state.activePlan = null;
  state.activePlanStatus = 'idle';
  state.shoppingPlanId = null;
  state.shopping = null;
  state.shoppingStatus = 'idle';
}

export function setFavorites(state, favorites) {
  state.favorites = favorites;
  state.favoriteIds = new Set(favorites.map(({id}) => id));
}
