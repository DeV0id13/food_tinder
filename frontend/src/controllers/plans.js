import {ApiError} from '../api/errors.js';
import {generatePlanSlots} from '../utils/auto-plan.js';
import {PlanTransfer} from '../components/plan-transfer.js';
import {MEAL_LABELS} from '../constants.js';
import {PlanDrafts} from '../state/plan-drafts.js';
import {compatibleFavorites, duplicatePlanDraft, hasValidPlanDates, includedSlots, makePlanDraft, planContentKey, planDraftPayload, slotFor} from '../utils/plans.js';
import {planDrop, unavailableDraftSlot} from '../utils/plan-drop.js';
import {draftStatus} from '../views/plans-view.js';
import {pickedRecipeTitle, renderPickerResults, renderSlotPicker} from '../views/slot-picker.js';

export class PlansController {
  constructor(app) {
    this.app = app;
    this.browser = app.browser;
    this.dialog = app.dialog;
    this.root = app.root;
    this.state = app.state;
    this.planDrafts = new PlanDrafts(this.browser);
    this.editorDraft = null;
    this.libraryQuery = '';
    this.editRevision = 0;
    this.transferUndo = null;
    this.slotPicker = null;
    this.transfer = new PlanTransfer(this.root, this.browser, {
      getSource: (source, handle) => this.transferSource(source, handle),
      inspect: (context, target) => this.inspectTransfer(context, target),
      drop: (context, target) => this.applyTransfer(context, target),
    });
  }

  prepareRender() {
    const sameDraft = this.editorDraft && this.editorDraft === this.state.planDraft;
    const library = this.root.querySelector?.('[data-plan-library]');
    const results = library?.querySelector('[data-library-results]');
    const left = sameDraft ? results?.scrollLeft : 0;
    const top = sameDraft ? results?.scrollTop : 0;
    const open = sameDraft && library ? library.open : true;
    if (!sameDraft) {
      this.libraryQuery = '';
      this.clearTransferUndo();
    }
    this.editorDraft = this.state.planDraft;
    this.transfer.cancel();
    return {options: {open, query: this.libraryQuery}, scroll: {left, top}};
  }

  restoreRender({left, top}) {
    const nextResults = this.root.querySelector?.('[data-library-results]');
    if (nextResults) {
      nextResults.scrollLeft = left ?? 0;
      nextResults.scrollTop = top ?? 0;
    }
    this.updateTransferUndo();
  }

  async loadEditorView() {
    if (this.state.planMode === 'list') {
      await this.loadPlans();
    } else {
      if (this.state.planMode === 'new' && !this.state.planDraft) {
        const draft = this.planDrafts.get(this.state.session.id, null);
        this.state.planDraft = draft ?? makePlanDraft();
        this.state.restoredDraft = Boolean(draft?.dirty);
        this.state.draftStorageUnavailable = Boolean(draft?.storageUnavailable);
        this.state.activePlanStatus = 'ready';
        this.app.render();
      }
      await Promise.all([
        this.state.planDraft ? undefined : this.loadActivePlan(),
        this.app.recipes.loadFavorites(),
      ]);
    }
  }

  editablePlanId() {
    if (!this.state.session.authenticated || this.state.activePlanStatus !== 'ready') return null;
    const {planDraft, planMode, activePlanId} = this.state;
    if (!planDraft) return null;
    if (planMode === 'new' && !planDraft.plan.id) return 0;
    return planMode === 'edit' && planDraft.plan.id === activePlanId ? activePlanId : null;
  }

  async loadPlans(shouldRender = true) {
    if (!this.state.session.authenticated) return;
    const request = this.app.beginRequest('plans');
    const current = () => this.app.isCurrentRequest('plans', request);
    if (this.state.error === this.state.plansError) this.state.error = null;
    this.state.plansError = null;
    this.state.plansStatus = 'loading';
    if (shouldRender) this.app.render();
    try {
      const plans = await this.app.api.getPlans();
      if (!current()) return;
      this.state.plans = plans;
      this.state.plansStatus = 'ready';
      if (!this.state.shoppingPlanId) this.state.shoppingPlanId = this.state.activePlanId ?? plans[0]?.id ?? null;
    } catch (error) {
      if (!current()) return;
      this.state.plansStatus = 'error';
      this.state.plansError = error;
      await this.app.handleError(error, current);
    }
    if (shouldRender && current()) this.app.render();
  }

  async loadActivePlan(shouldRender = true) {
    if (!this.state.session.authenticated || !this.state.activePlanId) return;
    this.transfer.cancel();
    const planId = Number(this.state.activePlanId);
    const request = this.app.beginRequest('active-plan');
    const current = () => this.app.isCurrentRequest('active-plan', request)
      && Number(this.state.activePlanId) === planId;
    if (this.state.planMode === 'edit') this.state.planDraft = null;
    this.state.activePlan = null;
    this.state.activePlanStatus = 'loading';
    if (shouldRender) this.app.render();
    try {
      const plan = await this.app.api.getPlan(planId);
      if (!current()) return;
      this.state.activePlan = plan;
      if (this.state.view === 'plans' && this.state.planMode === 'edit') {
        const draft = this.planDrafts.get(this.state.session.id, planId);
        this.state.planDraft = draft || makePlanDraft(plan);
        this.state.restoredDraft = Boolean(draft?.dirty);
        this.state.draftStorageUnavailable = Boolean(draft?.storageUnavailable);
      }
      this.state.activePlanStatus = 'ready';
    } catch (error) {
      if (!current()) return;
      this.state.activePlanStatus = 'error';
      await this.app.handleError(error, current);
    }
    if (shouldRender && current()) this.app.render();
  }

  selectPlanRoute(mode, planId = null) {
    if (this.state.planMode === mode && this.state.activePlanId === planId) return;
    this.app.beginRequest('active-plan');
    Object.assign(this.state, {
      planMode: mode, activePlanId: planId, activePlan: null, planDraft: null,
      restoredDraft: false, draftStorageUnavailable: false,
      activePlanStatus: mode === 'edit' ? 'loading' : 'idle',
    });
  }

  isCurrentPicker(picker) {
    return Boolean(picker && this.slotPicker === picker && this.dialog.open
      && this.state.view === 'plans' && this.editablePlanId() === picker.planId
      && this.state.planDraft === picker.draft
      && this.app.account.isCurrentSession(picker.session));
  }

  focusSlot({planId, dayIndex, mealType, session}) {
    if (this.state.view === 'plans' && this.editablePlanId() === planId && this.app.account.isCurrentSession(session)) {
      this.root.querySelector?.(`#pick-meal-${dayIndex}-${mealType}`)?.focus();
    }
  }

  openSlotPicker(planId, dayIndex, mealType) {
    if (this.dialog.open || this.state.busy || this.state.view !== 'plans' || planId !== this.editablePlanId()) return;
    const draft = this.state.planDraft;
    const plan = draft.plan;
    if (!hasValidPlanDates(plan) || !Object.hasOwn(MEAL_LABELS, mealType) || !plan.enabled_meals.includes(mealType)
      || !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= plan.duration_days) return;
    const slot = slotFor(plan, dayIndex, mealType);
    const picker = {
      draft, planId, dayIndex, mealType, slot, startDate: plan.start_date, query: '',
      recipes: compatibleFavorites(this.state.favorites, mealType),
      recipeId: slot?.recipe_id ?? null,
      session: this.app.account.sessionContext(),
    };
    this.transfer.cancel();
    this.app.beginRequest('recipe-detail');
    this.slotPicker = picker;
    this.dialog.innerHTML = renderSlotPicker(picker, this.state.favoritesStatus);
    if (!this.dialog.open) this.dialog.showModal();
    if (this.state.favoritesStatus === 'idle' || this.state.favoritesStatus === 'loading') {
      return this.loadPickerFavorites(picker);
    }
  }

  updatePickerResults() {
    this.dialog.querySelector('[data-picker-results]').innerHTML =
      renderPickerResults(this.slotPicker, this.state.favoritesStatus);
  }

  updatePickerSelection() {
    this.dialog.querySelector('[data-picker-selection]').textContent = pickedRecipeTitle(this.slotPicker);
    this.dialog.querySelector('[data-form="slot-picker"] button[type="submit"]').disabled = !this.slotPicker.recipeId;
  }

  async loadPickerFavorites(picker) {
    if (!this.isCurrentPicker(picker)) return;
    const loading = this.app.recipes.loadFavorites(false);
    this.updatePickerResults();
    await loading;
    if (!this.isCurrentPicker(picker)) return;
    picker.recipes = compatibleFavorites(this.state.favorites, picker.mealType);
    if (picker.recipeId !== picker.slot?.recipe_id && !picker.recipes.some(({id}) => id === picker.recipeId)) {
      picker.recipeId = null;
    }
    this.updatePickerResults();
    this.updatePickerSelection();
  }

  async savePickedSlot(servings) {
    const picker = this.slotPicker;
    if (this.state.busy || !this.isCurrentPicker(picker) || !picker.recipeId
      || !Number.isInteger(servings) || servings < 1 || servings > 20) return;
    const {draft, dayIndex, mealType, recipeId} = picker;
    const recipe = picker.recipes.find(({id}) => id === recipeId);
    if (recipeId !== picker.slot?.recipe_id && !recipe) return;
    if (recipeId === picker.slot?.recipe_id && servings === picker.slot.servings) {
      this.dialog.close();
      this.focusSlot(picker);
      return;
    }
    draft.plan.slots = draft.plan.slots.filter((slot) => slot.day_index !== dayIndex || slot.meal_type !== mealType);
    draft.plan.slots.push({
      day_index: dayIndex, meal_type: mealType, recipe_id: recipeId, servings,
      recipe_title: recipe?.title ?? picker.slot.recipe_title,
      recipe_image_url: recipe?.image_url ?? picker.slot?.recipe_image_url ?? '',
    });
    this.markDraftChanged();
    this.dialog.close();
    this.app.render();
    this.focusSlot(picker);
  }

  async autoFillPlan({replace = false} = {}) {
    const draft = this.state.planDraft;
    if (!draft || this.state.busy || this.state.view !== 'plans' || this.editablePlanId() === null) return;
    const {plan} = draft;
    const revision = this.editRevision;
    if (!hasValidPlanDates(plan) || !plan.enabled_meals.length) {
      this.app.toast('Укажите корректную дату и хотя бы один приём пищи.');
      return;
    }
    const servings = Number(draft.generationServings ?? 1);
    if (!Number.isInteger(servings) || servings < 1 || servings > 20) {
      this.app.toast('Укажите количество человек от 1 до 20.');
      return;
    }
    if (replace && plan.slots.length
      && !await this.app.navigation.askConfirmation('Пересобрать меню? Все выбранные вручную блюда в черновике будут заменены.', 'Пересобрать меню')) return;
    if (this.state.planDraft !== draft) return;

    const request = this.app.beginRequest('auto-fill-plan');
    if (this.state.favoritesStatus !== 'ready') await this.app.recipes.loadFavorites(false);
    if (!this.app.isCurrentRequest('auto-fill-plan', request) || this.state.planDraft !== draft
      || revision !== this.editRevision || this.state.busy || this.dialog.open
      || this.state.view !== 'plans' || this.editablePlanId() === null
      || this.state.favoritesStatus !== 'ready') return;

    const rotation = (draft.generationRotation ?? 0) + (replace ? 1 : 0);
    const result = generatePlanSlots(plan, this.state.favorites, {servings, replace, rotation});
    if (!result.generated) {
      this.app.toast(result.missing ? 'В избранном нет блюд для выбранных приёмов пищи.'
        : 'Все приёмы пищи уже заполнены. Для нового варианта нажмите «Пересобрать меню».');
      return;
    }
    plan.slots = result.slots;
    draft.generationRotation = rotation;
    draft.generationNotice = `Подобрано блюд: ${result.generated}.${result.repeated ? ` Повторов: ${result.repeated}.` : ''}${result.missing ? ` Пустых слотов: ${result.missing} — нет подходящих блюд в избранном.` : ''} Проверьте меню и нажмите «Сохранить рацион».`;
    this.markDraftChanged();
    this.app.render();
    this.root.querySelector?.('[data-action="auto-fill-plan"]')?.focus();
  }

  transferSource(source, handle) {
    const context = {source, handle, draft: this.state.planDraft,
      session: this.app.account.sessionContext(), revision: this.editRevision};
    const reason = this.transferBlockReason(context);
    if (reason) {
      this.transfer.announce(reason);
      return null;
    }
    const {plan} = context.draft;
    const recipe = this.state.favorites.find(({id}) => id === source.recipe_id);
    const slot = source.type === 'slot' ? slotFor(plan, source.day_index, source.meal_type) : null;
    if (!recipe || recipe.is_active === false || (source.type === 'slot' && slot?.recipe_id !== source.recipe_id)) {
      this.transfer.announce('Для переноса доступны только активные рецепты из избранного.');
      return null;
    }
    return {...context, title: slot?.recipe_title ?? recipe.title};
  }

  transferBlockReason(context) {
    if (this.state.view !== 'plans' || this.editablePlanId() === null || this.state.busy || this.dialog.open
      || this.app.navigation.historyReturn || this.app.navigation.historyReplay
      || context.draft !== this.state.planDraft || context.revision !== this.editRevision
      || !this.app.account.isCurrentSession(context.session)) return 'Черновик изменился или сейчас недоступен.';
    const {plan} = context.draft;
    if (plan.id && this.state.activePlan?.version !== plan.version) {
      return 'Версия рациона изменилась. Проверьте сохранённый рацион перед переносом блюд.';
    }
    if (!hasValidPlanDates(plan) || !plan.enabled_meals.length) return 'Укажите корректную дату и приёмы пищи.';
    if (this.state.favoritesStatus !== 'ready') return 'Дождитесь загрузки избранного.';
    return '';
  }

  inspectTransfer(context, target) {
    const reason = context ? this.transferBlockReason(context) : 'Исходное блюдо недоступно.';
    return reason ? {result: 'blocked', reason}
      : planDrop(context.source, target, context.draft, this.state.favorites);
  }

  applyTransfer(context, target) {
    const outcome = this.inspectTransfer(context, target);
    const messages = {added: 'Блюдо добавлено.', replaced: 'Блюдо в слоте заменено.',
      moved: 'Блюдо перенесено вместе с порциями.', swapped: 'Блюда и порции поменялись местами.'};
    const message = messages[outcome.result];
    if (!message) return outcome;
    const {draft, source} = context;
    const {scrollX, scrollY} = this.browser ?? {};
    const previous = {slots: draft.plan.slots, dirty: draft.dirty};
    draft.plan.slots = outcome.nextSlots;
    this.markDraftChanged();
    this.transferUndo = {draft, previous, source, target, message, revision: this.editRevision,
      session: context.session};
    this.transferUndo.timer = setTimeout(() => this.clearTransferUndo(), 8000);
    this.transferUndo.timer.unref?.();
    this.app.render();
    this.browser?.scrollTo?.(scrollX, scrollY);
    this.transfer.announce(message);
    this.focusTransferSlot(target);
    return outcome;
  }

  focusTransferSlot({day_index, meal_type}) {
    this.root.querySelector?.(`#pick-meal-${day_index}-${meal_type}`)?.focus({preventScroll: true});
  }

  updateTransferUndo() {
    const button = this.root.querySelector?.('[data-action="undo-transfer"]');
    if (button) {
      button.hidden = !this.transferUndo;
      button.disabled = Boolean(this.state.busy);
    }
  }

  clearTransferUndo() {
    clearTimeout(this.transferUndo?.timer);
    this.transferUndo = null;
    this.updateTransferUndo();
  }

  undoTransfer() {
    const operation = this.transferUndo;
    if (!operation || operation.draft !== this.state.planDraft || operation.revision !== this.editRevision
      || !this.app.account.isCurrentSession(operation.session) || this.editablePlanId() === null
      || this.state.busy || this.dialog.open) return;
    operation.draft.plan.slots = operation.previous.slots;
    this.markDraftChanged(operation.previous.dirty);
    this.app.render();
    this.transfer.announce('Перестановка отменена.');
    this.focusTransferSlot(operation.source.type === 'slot' ? operation.source : operation.target);
  }

  markDraftChanged(previousDirty) {
    this.editRevision += 1;
    this.clearTransferUndo();
    this.transfer.cancel();
    const {planDraft, activePlan} = this.state;
    const {plan} = planDraft;
    const baseline = plan.id && activePlan?.version === plan.version
      ? planContentKey(activePlan) : planDraft.initialContent;
    planDraft.dirty = previousDirty ?? (baseline === undefined || planContentKey(plan) !== baseline);
    if (!planDraft.dirty) this.state.restoredDraft = false;
    this.persistDraft();
    this.app.navigation.watchUnsavedChanges();
    const status = this.root.querySelector?.('[data-draft-status]');
    if (status) status.textContent = draftStatus(this.state);
    const discard = this.root.querySelector?.('[data-action="discard-draft"]');
    if (discard) discard.hidden = Boolean(planDraft.plan.id && !planDraft.dirty);
  }

  persistDraft() {
    const {planDraft, session} = this.state;
    planDraft.storageUnavailable = false;
    const stored = this.planDrafts.put(session.id, planDraft.plan.id, planDraft);
    planDraft.storageUnavailable = !stored;
    this.state.draftStorageUnavailable = !stored;
    const warning = this.root.querySelector?.('[data-draft-storage-warning]');
    if (warning) warning.hidden = stored;
  }

  async changePlanSettings(control) {
    const draft = this.state.planDraft;
    if (this.state.view !== 'plans' || !draft || this.state.busy) return;
    const {change} = control.dataset;
    const next = {...draft.plan};
    if (change === 'plan-date') next.start_date = control.value;
    if (change === 'plan-duration') next.duration_days = Number(control.value);
    if (change === 'plan-meal') {
      const meals = new Set(next.enabled_meals);
      if (control.checked) meals.add(control.value);
      else meals.delete(control.value);
      next.enabled_meals = [...meals];
    }
    if (next.start_date === draft.plan.start_date && next.duration_days === draft.plan.duration_days
      && next.enabled_meals.length === draft.plan.enabled_meals.length
      && next.enabled_meals.every((meal) => draft.plan.enabled_meals.includes(meal))) return;
    const remaining = includedSlots(next);
    const removed = draft.plan.slots.length - remaining.length;
    const focus = change === 'plan-date'
      ? '[data-change="plan-date"]' : `[data-change="${change}"][value="${control.value}"]`;
    const accepted = !removed || await this.app.navigation.askConfirmation(
      `После сохранения из рациона будут удалены блюда · ${removed}. Продолжить?`, 'Применить настройки',
    );
    if (this.state.planDraft !== draft || this.state.view !== 'plans') return;
    if (accepted) {
      draft.plan = {...next, slots: remaining};
      draft.generationNotice = '';
      this.markDraftChanged();
    }
    this.app.render();
    this.root.querySelector?.(focus)?.focus({preventScroll: true});
  }

  async openPlanEditor(mode, id = null) {
    const context = this.app.account.sessionContext();
    await this.app.navigation.navigate('plans', {planMode: mode, planId: id});
    if (this.app.account.isCurrentSession(context) && this.state.view === 'plans'
      && this.state.planMode === mode && this.state.activePlanId === id) {
      this.root.querySelector?.('#plan-editor-title')?.focus();
    }
  }

  async duplicatePlan(planId) {
    if (!this.state.session.authenticated || this.state.planMode !== 'list'
      || !this.state.plans?.some(({id}) => id === planId) || this.state.busy) return;
    const userId = this.state.session.id;
    if (this.planDrafts.get(userId, null)?.dirty
      && !await this.app.navigation.askConfirmation('Заменить текущий новый черновик копией рациона?', 'Заменить черновик')) return;
    const request = this.app.beginRequest('duplicate');
    const viewVersion = this.app.requestVersions.get('view');
    let draft;
    await this.app.runMutation('duplicate-plan', async () => {
      const [source, favorites] = await Promise.all([this.app.api.getPlan(planId), this.app.api.getFavorites()]);
      if (!this.app.isCurrentRequest('duplicate', request) || this.app.requestVersions.get('view') !== viewVersion) return;
      draft = duplicatePlanDraft(source, favorites);
      this.planDrafts.put(userId, null, draft);
    });
    if (draft && this.app.isCurrentRequest('duplicate', request)) await this.openPlanEditor('new');
  }

  async discardDraft() {
    const {planDraft, session} = this.state;
    if (!planDraft || this.state.busy) return;
    if (planDraft.dirty && !await this.app.navigation.askConfirmation('Удалить несохранённые изменения в этом черновике?', 'Отменить изменения')) return;
    if (this.state.planDraft !== planDraft) return;
    this.planDrafts.remove(session.id, planDraft.plan.id);
    this.state.error = null;
    this.state.planDraft = null;
    this.app.navigation.watchUnsavedChanges();
    if (planDraft.plan.id) await this.loadActivePlan();
    else await this.app.navigation.navigate('plans', {planMode: 'list', replace: true});
  }

  async savePlan({focus = true} = {}) {
    const {planDraft, session} = this.state;
    if (this.dialog.open || this.state.view !== 'plans' || !session.authenticated || !planDraft
      || this.editablePlanId() === null || this.state.busy) return;
    const {plan} = planDraft;
    const context = this.app.account.sessionContext();

    if (!hasValidPlanDates(plan) || !plan.enabled_meals.length) {
      this.state.error = new ApiError({
        type: 'validation', message: 'Выберите корректную дату и хотя бы один приём пищи.',
      });
      this.app.render();
      return;
    }
    const unavailable = this.state.favoritesStatus === 'ready'
      && unavailableDraftSlot(plan, this.state.activePlan, this.state.favorites);
    if (unavailable) {
      this.state.error = new ApiError({type: 'validation',
        message: `День ${unavailable.day_index + 1}, ${MEAL_LABELS[unavailable.meal_type]}: выберите подходящий активный рецепт из избранного.`,
      });
      this.app.render();
      return;
    }
    let savedId;
    await this.app.runMutation('save-plan', async () => {
      const payload = planDraftPayload(planDraft);
      let saved;
      try {
        saved = plan.id ? await this.app.api.updatePlan(plan.id, payload) : await this.app.api.createPlan(payload);
      } catch (error) {
        if (error.status !== 409) throw error;
        throw new ApiError({
          status: 409,
          message: plan.id
            ? 'Рацион изменился в другой вкладке. Отмените изменения, чтобы загрузить сохранённую версию.'
            : 'Этот черновик уже был сохранён с другими данными. Проверьте список рационов.',
        });
      }
      if (this.app.navigation.historyReturn) await this.app.navigation.historyReturn.done;
      if (!this.app.account.isCurrentSession(context) || this.state.planDraft !== planDraft) return;
      this.planDrafts.remove(session.id, plan.id);
      this.app.beginRequest('plans');
      this.app.beginRequest('active-plan');
      this.app.shopping.invalidateShopping();
      this.state.plans = null;
      this.state.plansStatus = 'idle';
      Object.assign(this.state, {
        activePlanId: saved.id, activePlan: saved, activePlanStatus: 'ready',
        planMode: 'edit', planDraft: makePlanDraft(saved), restoredDraft: false, draftStorageUnavailable: false,
      });
      this.app.navigation.watchUnsavedChanges();
      this.app.navigation.writeRoute(true);
      this.app.toast('Рацион сохранён');
      savedId = saved.id;
    });
    if (savedId && this.app.account.isCurrentSession(context)) {
      if (focus) this.root.querySelector?.('[data-draft-status]')?.focus({preventScroll: true});
      return savedId;
    }
    if (focus) this.root.querySelector?.('.error-banner')?.focus();
  }

  async deleteSlot(dayIndex, mealType, planId) {
    const draft = this.state.planDraft;
    const slot = slotFor(draft?.plan, dayIndex, mealType);
    if (!slot || this.state.busy || this.editablePlanId() !== planId) return;
    if (!await this.app.navigation.askConfirmation(`Убрать блюдо «${slot.recipe_title}» из этого слота?`, 'Удалить блюдо')
      || this.state.planDraft !== draft || slotFor(draft.plan, dayIndex, mealType) !== slot) return;
    draft.plan.slots = draft.plan.slots.filter((slot) => slot.day_index !== dayIndex || slot.meal_type !== mealType);
    this.markDraftChanged();
    this.app.render();
    this.root.querySelector?.(`#pick-meal-${dayIndex}-${mealType}`)?.focus();
  }

  async deletePlan(planId) {
    if (!this.state.session.authenticated || !this.state.plans?.some(({id}) => id === planId) || this.state.busy) return;
    const context = this.app.account.sessionContext();
    if (!await this.app.navigation.askConfirmation('Удалить рацион и все блюда в нём?', 'Удалить рацион')) return;
    await this.app.runMutation('delete-plan', async () => {
      await this.app.api.deletePlan(planId);
      if (!this.app.account.isCurrentSession(context)) return;
      this.planDrafts.remove(this.state.session.id, planId);
      if (this.state.shoppingPlanId === planId) this.state.shoppingPlanId = null;
      this.app.shopping.invalidateShopping();
      await this.loadPlans(false);
      if (!this.app.account.isCurrentSession(context)) return;
      if (this.state.view === 'shopping') await this.app.loadView('shopping');
      if (this.app.account.isCurrentSession(context)) this.app.toast('Рацион удалён');
    });
  }
}
