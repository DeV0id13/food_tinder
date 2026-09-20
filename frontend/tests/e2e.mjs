import { createRequire } from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.FOODTINDER_PLAYWRIGHT || 'playwright');
const launchOptions={headless:true};
if(process.env.FOODTINDER_CHROMIUM)launchOptions.executablePath=process.env.FOODTINDER_CHROMIUM;
if(process.env.FOODTINDER_BROWSER_ARGS)launchOptions.args=JSON.parse(process.env.FOODTINDER_BROWSER_ARGS);
const base=path.resolve(import.meta.dirname,'../public');
const screenshots=path.resolve(process.env.FOODTINDER_SCREENSHOTS || 'test-artifacts');
await mkdir(screenshots,{recursive:true});
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.jpg':'image/jpeg','.svg':'image/svg+xml','.ttf':'font/ttf'};
const server=createServer(async(req,res)=>{try{let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/')name='/index.html';const f=path.join(base,name);if(!f.startsWith(base+'/'))throw Error('Invalid path');res.setHeader('Content-Type',types[path.extname(f)]||'application/octet-stream');res.end(await readFile(f))}catch{res.writeHead(404);res.end('Not found')}});
await new Promise(resolve=>server.listen(4174,'127.0.0.1',resolve));
const browser=await chromium.launch(launchOptions);
const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page=await ctx.newPage();const errors=[];const failures=[];
page.on('pageerror',err=>errors.push(err.message));page.on('response',r=>{if(r.status()>=400)failures.push([r.status(),r.url()])});
const click=selector=>page.locator(selector).click();
const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('foodtinder.v1')));
const nav=async view=>click(`.sidebar [data-view="${view}"]`);
try{
 await page.goto('http://127.0.0.1:4174');await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:path.join(screenshots,'foodtinder-desktop.png'),fullPage:true});
 assert.equal(await page.locator('.recipe-card').count(),1);assert.equal(await page.locator('.collection-footer .primary').isDisabled(),true);
 await click('[data-action="details"][data-id="green-bowl"]');assert.equal(await page.locator('dialog').isVisible(),true);assert.match(await page.locator('dialog').innerText(),/Киноа/);await page.keyboard.press('Escape');
 // Mouse swipe, undo, buttons, and keyboard all lead to a consistent selection.
 let box=await page.locator('.recipe-image').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+130);await page.mouse.down();await page.mouse.move(box.x+box.width/2+120,box.y+132,{steps:8});await page.mouse.up();assert.deepEqual((await state()).liked,['green-bowl']);
 await click('[data-action="undo"]');assert.deepEqual((await state()).liked,[]);
 await click('[data-action="like"]');await page.locator('h1').click();await page.keyboard.press('ArrowRight');await click('[data-action="like"]');assert.equal((await state()).liked.length,3);
 await click('[data-action="skip"]');assert.equal((await state()).seen.length,4);await click('[data-action="undo"]');assert.equal((await state()).seen.length,3);
 await click('[data-action="filter"][data-value="breakfast"]');await click('[data-action="fast"]');assert.match(await page.locator('.recipe-card').innerText(),/Овсянка с ягодами/);
 await nav('plan');await click('[data-action="choose-slot"][data-day="0"][data-meal="breakfast"]');await click('[data-action="set-slot"][data-id="avocado-toast"]');assert.equal((await state()).plan[0].breakfast.recipeId,'avocado-toast');
 await click('[data-action="auto-fill"]');assert.equal(await page.locator('.meal-card').count(),9);
 await click('[data-action="portion"][data-day="0"][data-meal="lunch"][data-delta="1"]');assert.equal((await state()).plan[0].lunch.servings,2);
 await page.screenshot({path:path.join(screenshots,'foodtinder-plan.png'),fullPage:true});
 await nav('shopping');let tomato=page.locator('.shopping-item').filter({has:page.locator('input[data-key="tomato|г"]')});assert.match(await tomato.innerText(),/940 г/);await tomato.click();assert.equal(await tomato.locator('input').isChecked(),true);
 await page.reload();assert.equal(await page.locator('input[data-key="tomato|г"]').isChecked(),true);
 await nav('plan');await click('[data-action="portion"][data-day="0"][data-meal="lunch"][data-delta="1"]');await nav('shopping');assert.equal(await page.locator('input[data-key="tomato|г"]').isChecked(),false);assert.match(await tomato.innerText(),/1,04 кг/);
 const dl=page.waitForEvent('download');await click('[data-action="download"]');const download=await dl;const downloaded=await readFile(await download.path(),'utf8');assert.match(downloaded,/Помидоры — 1,04 кг/);
 await ctx.grantPermissions(['clipboard-read','clipboard-write']);await click('[data-action="copy"]');assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Помидоры — 1,04 кг/);
 await page.screenshot({path:path.join(screenshots,'foodtinder-shopping.png'),fullPage:true});
 // Period switching changes calculations, while longer plans survive shorter views.
 await nav('plan');await click('[data-action="period"][data-value="7"]');await click('[data-action="auto-fill"]');assert.equal(await page.locator('.meal-card').count(),21);
 await click('[data-action="period"][data-value="1"]');assert.equal(await page.locator('.meal-card').count(),3);await nav('shopping');assert.match(await tomato.innerText(),/480 г/);
 await click('[data-action="period"][data-value="7"]');assert.match(await tomato.innerText(),/2,16 кг/);
 await nav('plan');await page.locator('#start-date').fill('2026-10-05');assert.equal((await state()).startDate,'2026-10-05');await page.reload();assert.equal(await page.locator('.meal-card').count(),21);assert.match(await page.locator('.day-label').first().innerText(),/5 окт/);
 // Manual replacement and removal update the list.
 await click('[data-action="choose-slot"][data-day="0"][data-meal="lunch"]');await click('[data-action="set-slot"][data-id="pesto-pasta"]');assert.equal((await state()).plan[0].lunch.recipeId,'pesto-pasta');assert.equal((await state()).plan[0].lunch.servings,3);await click('[data-action="remove-slot"][data-day="0"][data-meal="lunch"]');assert.equal((await state()).plan[0].lunch,null);
 await click('[data-action="period"][data-value="1"]');await click('[data-action="clear-plan"]');await page.getByRole('button',{name:'Оставить план',exact:true}).click();assert.equal(await page.locator('.meal-card').count(),2);await click('[data-action="clear-plan"]');await click('[data-action="confirm-clear"]');assert.equal(await page.locator('.meal-card').count(),0);await click('[data-action="period"][data-value="7"]');assert.equal(await page.locator('.meal-card').count(),18);
 // Responsive layouts must remain inside the viewport.
 for(const width of [1440,1024,768,390]){await page.setViewportSize({width,height:900});for(const v of ['discover','plan','shopping']){await nav(v);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,`Horizontal overflow at ${width} on ${v}`)}if(width===390){await nav('discover');await page.screenshot({path:path.join(screenshots,'foodtinder-mobile.png'),fullPage:true})}}
 // Empty states, demo path, and all-complete purchase list.
 await page.evaluate(()=>localStorage.clear());await page.goto('http://127.0.0.1:4174/#shopping');await page.reload();assert.match(await page.locator('main').innerText(),/Сначала — немного планов/);await nav('plan');await click('[data-action="demo"]');assert.equal(await page.locator('.meal-card').count(),9);await nav('shopping');while(await page.locator('.shopping-item input:not(:checked)').count()){await page.locator('.shopping-item').filter({has:page.locator('input:not(:checked)')}).first().click()}assert.equal(await page.locator('.all-done').count(),1);
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
 console.log('PASS: swipe, undo, keyboard, filters, recipe dialog, manual placement, auto-fill, portions, aggregation, checkboxes, reload, export, clipboard, 1/3/7 days, date, replacement, removal, cancel/confirm clear, responsive layouts, demo, empty/completed states. No browser errors or failed requests.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
