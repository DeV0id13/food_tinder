import test from 'node:test';
import assert from 'node:assert/strict';
import {planDrop, unavailableDraftSlot} from '../src/utils/plan-drop.js';

const breakfast = (day = 0) => ({day_index: day, meal_type: 'breakfast'});
const dinner = (day = 0) => ({day_index: day, meal_type: 'dinner'});
const porridge = {id: 1, title: 'Каша', image_url: '/media/porridge.jpg', meal_types: ['breakfast']};
const stew = {id: 2, title: 'Рагу', image_url: '/media/stew.jpg', meal_types: ['breakfast', 'dinner']};
const omelet = {id: 3, title: 'Омлет', image_url: '/media/omelet.jpg', meal_types: ['breakfast', 'dinner']};
const favorites = [porridge, stew, omelet];
const savedSlot = (recipe, servings, address) => ({
  ...address, recipe_id: recipe.id, servings, recipe_title: recipe.title, recipe_image_url: recipe.image_url,
});
const slot = (record) => ({type: 'slot', ...record});
const favorite = (recipe) => ({type: 'favorite', recipe_id: recipe.id});
const draft = (...slots) => ({
  generationServings: 6,
  plan: {start_date: '2027-04-05', duration_days: 3, enabled_meals: ['breakfast', 'dinner'], slots},
});

test('copy from favorites uses generation servings, preserves duplicates and replaces with target servings', () => {
  const before = draft(savedSlot(porridge, 4, breakfast()));
  const copy = planDrop(favorite(porridge), breakfast(1), before, favorites);
  assert.equal(copy.result, 'added');
  assert.deepEqual(copy.nextSlots, [before.plan.slots[0], savedSlot(porridge, 6, breakfast(1))]);
  const replace = planDrop(favorite(stew), breakfast(), before, favorites);
  assert.equal(replace.result, 'replaced');
  assert.deepEqual(replace.nextSlots, [savedSlot(stew, 4, breakfast())]);
  assert.equal(favorites.length, 3);
  assert.deepEqual(before.plan.slots, [savedSlot(porridge, 4, breakfast())]);
});

test('moving to an empty slot keeps the complete record', () => {
  const origin = {...savedSlot(stew, 13, breakfast()), custom: 'metadata'};
  const before = draft(origin);
  const move = planDrop(slot(origin), dinner(2), before, favorites);
  assert.equal(move.result, 'moved');
  assert.deepEqual(move.nextSlots, [{...origin, ...dinner(2)}]);
  assert.deepEqual(before.plan.slots, [origin]);
});

for (const destination of [dinner(), dinner(1), breakfast(2)]) {
  test(`swap carries both records and servings to their new addresses ${JSON.stringify(destination)}`, () => {
    const a = savedSlot(stew, 2, breakfast());
    const b = savedSlot(omelet, 17, destination);
    const before = draft(a, b);
    const swap = planDrop(slot(a), destination, before, favorites);
    assert.equal(swap.result, 'swapped');
    assert.deepEqual(swap.nextSlots, [{...b, ...breakfast()}, {...a, ...destination}]);
    assert.deepEqual(before.plan.slots, [a, b]);
  });
}

test('both swap directions check both recipes, with no partial changes on rejection', () => {
  const a = savedSlot(porridge, 2, breakfast());
  const b = savedSlot(stew, 17, dinner(1));
  const before = draft(a, b);
  for (const [source, target] of [[a, b], [b, a]]) {
    const blocked = planDrop(slot(source), target, before, favorites);
    assert.equal(blocked.result, 'blocked');
    assert.match(blocked.reason, /Ужин/);
    assert.equal(blocked.nextSlots, before.plan.slots);
  }
  assert.deepEqual(before.plan.slots, [a, b]);
});

test('bad addresses, unknown sources and recipes, disabled meals and invalid servings cannot change the draft', () => {
  const a = savedSlot(stew, 4, dinner());
  const before = draft(a);
  for (const [source, destination] of [
    [slot(a), null], [slot(a), dinner(3)], [slot(a), dinner(-1)], [slot(a), dinner('1')],
    [slot(a), {day_index: 0, meal_type: 'snack'}],
    [slot({...a, recipe_id: 100}), dinner(1)], [{type: 'other'}, dinner(1)], [favorite({id: 999}), dinner()],
  ]) {
    const blocked = planDrop(source, destination, before, favorites);
    assert.equal(blocked.result, 'blocked');
    assert.equal(blocked.nextSlots, before.plan.slots);
  }
  assert.equal(planDrop(favorite(stew), dinner(1), {...before, generationServings: 21}, favorites).result, 'blocked');
  assert.equal(planDrop(slot(a), dinner(), before, favorites).result, 'noop');
  assert.equal(planDrop(favorite(stew), dinner(), before, favorites).result, 'noop');
});

test('an unavailable saved recipe can stay where it is but cannot move or swap', () => {
  const a = savedSlot(stew, 4, dinner());
  const b = savedSlot(omelet, 9, dinner(2));
  const before = draft(a, b);
  for (const subset of [[omelet], [omelet, {...stew, is_active: false}]]) {
    assert.equal(planDrop(slot(a), dinner(1), before, subset).result, 'blocked');
    assert.equal(planDrop(slot(b), dinner(), before, subset).result, 'blocked');
    assert.equal(planDrop(favorite(stew), dinner(), before, subset).result, 'blocked');
    assert.equal(unavailableDraftSlot(before.plan, before.plan, subset), undefined);
    const moved = {...before.plan, slots: [{...a, ...dinner(1)}, b]};
    assert.equal(unavailableDraftSlot(moved, before.plan, subset), moved.slots[0]);
  }
});
