/** Run against an existing preview server with PLAYWRIGHT_CORE and CHROMIUM_PATH. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const url = new URL(process.argv[2] || 'http://127.0.0.1:4173/studio/');
const web = new URL('../../assets/atlases_longtime/web/', import.meta.url);
const counts = new Map();
for (const group of await readdir(web)) {
  const chunk = JSON.parse(await readFile(new URL(group+'/chunk-manifest.json',web)));
  counts.set(group,chunk);
}
const total = field => [...counts.values()].reduce((n,c) => n + field(c),0);
const audio = JSON.parse(await readFile(new URL('../../assets/audio/packs/pilot_v1/pack.json',import.meta.url)));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
try {
  for (const [size,viewport] of Object.entries({desktop:{width:1280,height:850},mobile:{width:390,height:844}})) {
    const page = await browser.newPage({viewport, isMobile:size==='mobile',hasTouch:size==='mobile'});
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    // Observe the real decoder/scheduler, including resampling to a 48 kHz device.
    await page.addInitScript(() => {
      window.AudioContext = class extends AudioContext {
        constructor() { super({sampleRate:48000}); }
      };
      window.starts = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        window.starts.push({args,rate:this.buffer.sampleRate,loop:this.loop,start:this.loopStart,end:this.loopEnd});
        return start.apply(this,args);
      };
    });
    const snap = async name => {
      if (process.env.INSPECTOR_SHOTS) await page.screenshot({path:join(process.env.INSPECTOR_SHOTS,size+'-'+name+'.png')});
    };
    await page.goto(url.href+'?tab=inspector');
    await page.locator('#inspector-asset-list button').first().waitFor();
    await page.locator('#insp-btn-next').click();
    await snap('core');
    await page.getByRole('link',{name:'Longtime art'}).click();
    await page.getByText(`${total(c=>c.asset_ids.length)} delivered assets · ${total(c=>c.frame_count)} frames`,{exact:true}).waitFor();
    for (const [group,c] of counts) assert.equal(await page.locator('#group option[value="'+group+'"]').textContent(),group+' · '+c.frame_count+' frames');
    async function compareNative() {
      assert.equal(await page.evaluate(async () => {
        const [,id,pose]=document.querySelector('#key').textContent.split('/');
        const image=new Image();image.src='../assets/processed_longtime/'+id+'/'+pose+'.png';
        await image.decode();
        const actual=document.querySelector('#crop'), expected=document.createElement('canvas');
        expected.width=actual.width;expected.height=actual.height;
        const ctx=expected.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(image,0,0,expected.width,expected.height);
        return actual.toDataURL()===expected.toDataURL();
      }),true);
    }
    await page.selectOption('#group','mist_archive');
    await page.selectOption('#zoom','1'); await compareNative();
    await page.click('#next');await page.selectOption('#zoom','4');await compareNative();
    await page.selectOption('#group','armory');await page.selectOption('#asset','lt_tidal_chain');await compareNative();
    await snap('relic');
    await page.selectOption('#asset','lt_tidal_chain_shot');
    await page.click('#next');assert.match(await page.locator('#key').textContent(),/flight_none_1$/);
    await page.click('#play');await page.waitForFunction(()=>!document.querySelector('#key').textContent.endsWith('_1'));await page.click('#play');await compareNative();
    await page.fill('#filter','no-such-asset');assert.equal(await page.locator('#crop').isHidden(),true);
    await page.getByRole('link',{name:'Audio pilot'}).click();
    await page.getByText('Ready to listen.').waitFor();
    assert.deepEqual(await page.evaluate(()=>window.starts),[]);
    for (const codec of ['ogg','m4a']) {
      await page.selectOption('#codec',codec);
      for (const [kind,id] of [['bgm',audio.bgm.id],...audio.sfx.cues.map(c=>['sfx',c.id])]) {
        const n=await page.evaluate(()=>window.starts.length);
        await page.getByRole('button',{name:id,exact:true}).click();
        await page.waitForFunction(n=>window.starts.length>n,n,{timeout:10000});
        const actual=await page.evaluate(()=>window.starts.at(-1));
        const track=audio[kind], data=track.codecs[codec], loop=kind==='bgm';
        const m=loop?data.decoded_loop_frames:data.decoded_markers.find(c=>c.id===id).decoded;
        const seconds=f=>Math.round(f*actual.rate/track.sample_rate_hz)/actual.rate;
        const first=seconds(loop?m.loopStart:m.sprite_start),last=seconds(loop?m.loopEnd:m.sprite_end_exclusive);
        assert.equal(actual.rate,48000);assert.equal(actual.loop,loop);assert.equal(actual.args[1],first);
        if(loop){assert.equal(actual.start,first);assert.equal(actual.end,last);await page.click('#stop');}
        else assert.equal(actual.args[2],last-first);
      }
    }
    await page.locator('#volume').focus(); await page.keyboard.press('Home');
    assert.equal(await page.inputValue('#volume'),'0');
    await snap('audio');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if (size === 'desktop') {
      await page.route('**/web/abode/chunk-manifest.json',route=>route.fulfill({status:404,body:''}));
      await page.goto(new URL('library.html#art',url).href);
      await page.reload();
      await page.getByText(/Unavailable groups: abode/).waitFor();
      await page.selectOption('#group','armory');
      await page.selectOption('#asset','lt_tidal_chain');
      await compareNative();
      await page.route('**/pilot_v1/pack.json',route=>route.fulfill({status:404,body:''}));
      await page.getByRole('link',{name:'Audio pilot'}).click();
      await page.getByText(/Pilot pack unavailable/).waitFor();
    }
    assert.deepEqual(errors,[]);console.log(size,'core, counts, native pixels, zoom, relic, motion, empty search, both codecs and 18 marker starts passed');
    await page.close();
  }
} finally { await browser.close(); }
