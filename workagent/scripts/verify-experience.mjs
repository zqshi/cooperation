// Read-only browser review against the user's existing local services. No vendor calls.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const out = new URL('../test-results/evidence/experience/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
 for (const width of [1440, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const failedResponses = [];
  page.on('response', r => { if(r.url().includes('/v1/') && r.status()===429) failedResponses.push(r.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:15173/tenant');
  await page.locator('input[type=email]').fill('admin@workagent.local');
  await page.locator('input[type=password]').fill('admin12345');
  await page.getByRole('button', {name: '登录',exact:true}).click();
  await page.getByRole('heading', {name:'企业工作控制台'}).waitFor();
  const inspect = async (name) => {
   await page.evaluate(() => document.fonts.ready);
   const layout = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, heading: document.querySelector('h1')?.textContent, aside: document.querySelector('aside') ? getComputedStyle(document.querySelector('aside')).display : null }));
   results.push({name,width,...layout,errors:[...errors]});
   if(layout.horizontalOverflow) throw new Error(`Overflow: ${name} ${width}`);
   await page.screenshot({animations:'disabled',path:new URL(`${name}-${width}.png`,out).pathname,fullPage:true});
  };
  await inspect('tenant');
  if(await page.locator('nav a[href="/super-admin"]').count()) throw new Error('Cross-role platform link');
  for(const key of ['org','members','channels','queue','audit','usage','agents','skills','connectors','knowledge','evals']) {
   await page.waitForTimeout(2200);
   await page.goto(`http://localhost:15173/tenant/${key}`);
   await page.locator('h1').waitFor();
   await page.waitForTimeout(350);
   await inspect(`tenant-${key}`);
   if(['members','channels','agents','skills','connectors','knowledge','evals'].includes(key)) {
    const create=page.locator('main button').filter({hasText:/^(新增|新建|创建|邀请)/}).first();
    if(await create.count()) { await create.click(); if(await page.getByRole('dialog').count()) { await inspect(`tenant-${key}-form`); await page.keyboard.press('Escape'); } }
   }
   if(['agents','knowledge','evals'].includes(key)) {
    const link=page.locator(`main a[href^="/tenant/${key}/"], main tbody tr`).first();
    if(await link.count()) {await link.click();await page.locator('h1').waitFor();await page.waitForTimeout(350);await inspect(`tenant-${key}-detail`);}
   }
  }
  await page.goto('http://localhost:15173/super-admin');
  await page.getByRole('button',{name:'登录平台运营'}).waitFor();
  if(await page.locator('aside').count()) throw new Error('Platform login leaks tenant shell');
  await inspect('platform-login');
  await page.goto('http://localhost:15174/');
  // Localhost cookie shared across development ports; also support isolated cookies.
  if(await page.locator('input[type=email]').count()) {
   await page.locator('input[type=email]').fill('admin@workagent.local');await page.locator('input[type=password]').fill('admin12345');await page.getByRole('button',{name:'登录',exact:true}).click();
  }
  await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();await page.waitForTimeout(500);await inspect('portal');
  if(await page.locator('aside').count()) throw new Error('Employee portal uses admin sidebar');
  for(const key of ['projects','tasks','approvals','agents','conversations']) {
   await page.goto(`http://localhost:15174/${key}`);await page.locator('h1').waitFor();await page.waitForTimeout(350);await inspect(`portal-${key}`);
   if(key==='projects') {const project=page.locator('main section button').first();if(await project.count()){await project.click();await page.getByRole('heading',{name:'项目任务看板'}).waitFor();await inspect('portal-project-board');}}
   if(key==='tasks') {const run=page.locator('main tbody tr').first();if(await run.count()){await run.click();await page.waitForTimeout(500);await inspect('portal-run');}}
  }
  if(errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  if(failedResponses.length) throw new Error(`Rate-limited responses: ${failedResponses.length}`);
  await context.close();
 }
} finally {await browser.close();await fs.writeFile(new URL('browser-review.json',out),JSON.stringify(results,null,2));}
console.log(`${results.length} page/viewport reviews passed`);
