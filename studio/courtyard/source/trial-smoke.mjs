import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createPreviewServer} from '../../serve.mjs';
import {Trial} from '../trial.js';

const {chromium} = createRequire(import.meta.url)('playwright-core');
const server = createPreviewServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const home = 'http://127.0.0.1:' + server.address().port + '/studio/';
let browser;
try {
  browser = await chromium.launch();
  const errors = [];
  for (const phone of [false, true]) {
    const ctx = await browser.newContext({viewport: phone ? {width:390,height:844} : {width:1060,height:780},
      hasTouch:phone, isMobile:phone});
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if(m.type()==='error') errors.push(m.text());});
    page.on('response', r => {if(r.status()>=400) errors.push(r.status()+' '+r.url());});
    await page.goto(home);
    const use = async locator => phone ? locator.tap() : locator.click();
    await use(page.getByRole('link',{name:'Evening Bell trial'}));
    assert.equal(await page.locator('#passage').isVisible(), false);
    await use(page.getByRole('button',{name:'Approach shrine'}));
    await use(page.getByRole('button',{name:'Ring bell',exact:true}));
    await use(page.getByRole('link',{name:'Enter the training hall'}));
    const hall=page.locator('#hall');
    const phase = name => page.waitForFunction(n => document.querySelector('#hall')?.dataset.phase === n, name);
    await phase('arrival');
    const client=await ctx.newCDPSession(page);
    async function touch(type, ...buttons) {
      const points=[];
      for (const [i,key] of buttons.entries()) {
        const rect=await page.locator('[data-key="'+key+'"]').boundingBox();
        points.push({x:rect.x+rect.width/2,y:rect.y+rect.height/2,id:i+1});
      }
      await client.send('Input.dispatchTouchEvent',{type,touchPoints:points});
    }
    if (!phone) {
      // Reach the north exit before killing the guard; the closed gate blocks escape.
      await page.keyboard.down('ArrowUp');
      await page.waitForFunction(()=>document.querySelector('#hall').dataset.y==='61');
      await phase('combat');
      await page.keyboard.up('ArrowUp');
      assert.equal(await hall.getAttribute('data-phase'),'combat');
      await page.keyboard.down('j');
    } else {
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.ok(await page.locator('.controls').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight));
      await touch('touchStart','right','dash');
      await page.waitForFunction(()=>document.querySelector('#hall').dataset.dash==='true');
      await touch('touchEnd');
      assert.equal(await hall.getAttribute('data-facing'),'east');
      await phase('combat');
      await touch('touchStart','attack');
    }
    await phase('reward');
    if(phone) await touch('touchEnd'); else await page.keyboard.up('j');
    assert.equal(await hall.getAttribute('data-phase'),'reward','releasing Cast must not choose a reward');
    const id=phone?'dash':'shield';
    const chosen=page.getByRole('button',{name:phone?/Wind Step/:/Iron Ward/});
    await use(chosen);
    await phase('exit');
    await page.locator('#choices button').nth(phone?0:1).evaluate(b=>b.click());
    assert.equal(await hall.getAttribute('data-upgrade'),id);
    if(phone) {
      await touch('touchStart','left');
      await page.waitForFunction(()=>+document.querySelector('#hall').dataset.x<=162);
      await touch('touchEnd'); await touch('touchStart','up','dash');
    } else {
      // Move through the seal that blocked movement before the reward.
      await page.keyboard.down('ArrowUp');
    }
    await phase('won');
    if(phone) await touch('touchEnd'); else await page.keyboard.up('ArrowUp');
    await use(page.locator('#restart'));
    await page.getByRole('button',{name:'Approach shrine'}).waitFor();
    assert.equal(await page.locator('#room').getAttribute('data-rings'),'0');
    if(!phone) {
      await page.goto(new URL('courtyard/hall.html', home).href);
      await phase('lost');
      assert.equal(await hall.getAttribute('data-hp'),'0');
      await use(page.locator('#restart'));
      await page.getByRole('button',{name:'Approach shrine'}).waitFor();
    }
    console.log((phone?'390x844 touch':'Keyboard')+' route passed with '+id);
    await ctx.close();
  }
  assert.deepEqual(errors,[]);
  const input={x:0,y:-1,attack:false,dash:false};
  const fresh=()=>new Trial();
  const model=fresh();model.player.x=72;model.player.y=130;
  for(let i=0;i<60;i++) model.step(1/60,input);
  assert.ok(model.player.y>=108 && model.player.y<110,'pillar blocks movement');
  model.enter('reward');model.choose('shield');model.choose('dash');model.hurt();
  assert.equal(model.upgrade,'shield');assert.equal(model.player.hp,3);assert.equal(model.ward,false);
  const wind=fresh();wind.enter('reward');wind.choose('dash');
  const normal=fresh();
  for (const trial of [normal,wind]) {
    trial.step(1/60,{...input,dash:true});
    for (let i=0;i<19;i++) trial.step(1/60,{...input,y:0});
  }
  assert.ok(wind.player.y<normal.player.y-10 && wind.dashWait<normal.dashWait);
  const bash=fresh();
  bash.enter('combat');
  Object.assign(bash.guard,{x:bash.player.x,y:bash.player.y,mode:'windup',clock:0.49});
  bash.step(1/60,{...input,y:0});
  assert.equal(bash.player.hp,3,'the windup itself deals no damage');
  bash.guard.clock=0.74;
  bash.step(1/60,{...input,x:-1,y:0,dash:true});
  assert.equal(bash.guard.mode,'recover');
  assert.equal(bash.player.hp,3,'a timed dodge avoids the impact');
  assert.equal(bash.player.facing,'west');
  console.log('Collision, single reward, ward absorption, dash distance/recovery and browser errors verified.');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
