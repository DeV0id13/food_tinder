export function createInitialState(mode) {
  return {
    mode,
    initialLoading: true,
    view: 'feed',
    session: {authenticated: false, id: null, email: null},
    sessionKnown: false,
    feed: null,
    feedStatus: 'idle',
    catalog: null,
    catalogStatus: 'idle',
    favorites: null,
    favoritesStatus: 'idle',
    favoriteIds: new Set(),
    guestHidden: new Set(),
    plans: null,
    plansStatus: 'idle',
    plansError: null,
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
  };
}

export function clearPrivateState(state) {
  state.favorites = null;
  state.favoritesStatus = 'idle';
  state.favoriteIds = new Set();
  state.plans = null;
  state.plansStatus = 'idle';
  state.plansError = null;
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
