import {byId, meals} from './data.js';
export const STORAGE_KEY='foodtinder.v1';
export function freshState(){return {version:1,period:3,startDate:new Date().toLocaleDateString('en-CA'),liked:[],seen:[],history:[],plan:Array.from({length:7},()=>Object.fromEntries(meals.map(m=>[m.id,null]))),checked:{}};}
export function sanitizeState(raw){
 const state=freshState(); if(!raw||raw.version!==1)return state;
 state.period=[1,3,7].includes(raw.period)?raw.period:3;
 state.startDate=typeof raw.startDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw.startDate)&&!Number.isNaN(Date.parse(raw.startDate))?raw.startDate:state.startDate;
 state.liked=[...new Set((Array.isArray(raw.liked)?raw.liked:[]).filter(id=>byId[id]))];
 state.seen=[...new Set((Array.isArray(raw.seen)?raw.seen:[]).filter(id=>byId[id]))];
 state.plan=state.plan.map((day,index)=>Object.fromEntries(meals.map(({id})=>{let s=raw.plan?.[index]?.[id];return[id,s&&byId[s.recipeId]?{recipeId:s.recipeId,servings:Math.max(1,Math.min(12,Number.isFinite(+s.servings)?Math.round(+s.servings):1))}:null]})));
 state.checked=raw.checked&&typeof raw.checked==='object'?Object.fromEntries(Object.entries(raw.checked).filter(([k,v])=>typeof v==='number'&&Number.isFinite(v)&&v>0)):{};
 return state;
}
export function activeSlots(state){return state.plan.slice(0,state.period).flatMap((day,d)=>meals.map(m=>({...day[m.id],day:d,meal:m.id}))).filter(s=>s.recipeId);}
export function shoppingList(state){
 const map=new Map();
 for(const slot of activeSlots(state))for(const item of byId[slot.recipeId].ingredients){
  const key=item.id+'|'+item.unit;
  const old=map.get(key)||{...item,key,quantity:0,recipes:new Set()};
  old.quantity=Math.round((old.quantity+item.quantity*slot.servings)*1000)/1000;
  old.recipes.add(slot.recipeId); map.set(key,old);
 }
 return [...map.values()].map(x=>({...x,recipes:[...x.recipes]})).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
export function isChecked(state,item){return state.checked[item.key]===item.quantity;}
export function formatAmount(quantity,unit){let q=quantity,u=unit;if(quantity>=1000&&unit==='г'){q=quantity/1000;u='кг'}if(quantity>=1000&&unit==='мл'){q=quantity/1000;u='л'}return q.toLocaleString('ru-RU',{maximumFractionDigits:3})+' '+u;}
export function autoFill(state){let count=0;for(let d=0;d<state.period;d++)for(const m of meals){if(state.plan[d][m.id])continue;const candidates=state.liked.filter(id=>byId[id].category===m.id);if(candidates.length){state.plan[d][m.id]={recipeId:candidates[d%candidates.length],servings:1};count++}}return count;}
export function shoppingText(state){const items=shoppingList(state);const groups=[...new Set(items.map(i=>i.group))];return `FoodTinder · Список покупок\nПериод: ${state.period} дн. · с ${state.startDate}\n\n`+groups.map(group=>group+'\n'+items.filter(i=>i.group===group).map(i=>`${isChecked(state,i)?'[x]':'[ ]'} ${i.name} — ${formatAmount(i.quantity,i.unit)}`).join('\n')).join('\n\n');}
