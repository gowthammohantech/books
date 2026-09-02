import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
const c = await b.newContext({ viewport:{width:1366,height:768} });
const p = await c.newPage();
await p.goto('http://localhost:3000/signin');
await p.locator('input[type=email]').fill('admin@demo.elixirbooks.local');
await p.locator('input[type=password]').fill('Demo123$');
await p.locator('button[type=submit]').click();
await p.waitForURL(u=>!u.pathname.startsWith('/signin'),{timeout:60000});
await p.goto('http://localhost:3000/accounting/chart-of-accounts');
await p.waitForLoadState('networkidle'); await p.waitForTimeout(2500);
const t0 = await p.evaluate(()=>document.querySelector('thead').getBoundingClientRect().top);
await p.evaluate(()=>{ const m=document.querySelector('main');
  m.style.scrollBehavior='auto'; m.scrollTop=400; });
await p.waitForTimeout(600);
const r = await p.evaluate(()=>({
  scrollTop: document.querySelector('main').scrollTop,
  theadTop: Math.round(document.querySelector('thead').getBoundingClientRect().top),
  paneTop: Math.round(document.querySelector('main').getBoundingClientRect().top),
}));
console.log('thead top before scroll:', Math.round(t0));
console.log('after scrolling main by', r.scrollTop, '-> thead top:', r.theadTop, '(pane top', r.paneTop + ')');
console.log(r.scrollTop===0 ? 'INCONCLUSIVE'
  : (Math.round(t0)-r.theadTop) < r.scrollTop-20 ? 'STICKY WORKS' : 'STICKY IS A NO-OP');
await b.close();
