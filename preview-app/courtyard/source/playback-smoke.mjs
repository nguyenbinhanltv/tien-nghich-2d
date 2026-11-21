// Run with NODE_PATH pointing to an existing Playwright Core installation.
// Serve only the demo files to this test page via Chromium's request interception.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
const {chromium} = createRequire(import.meta.url)("playwright-core");
const root=fileURLToPath(new URL("../",import.meta.url));
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1040,height:800}});
  const errors=[];
  page.on("pageerror",err=>errors.push(err.message));
  await page.route("**/*",async route=>{
    const url=new URL(route.request().url());
    const file=path.resolve(root,"."+url.pathname);
    if(url.hostname!=="courtyard.test" || !file.startsWith(path.resolve(root)+path.sep)) {
      return route.abort();
    }
    const types={".js":"text/javascript",".html":"text/html",".css":"text/css",".png":"image/png",".json":"application/json",".tmj":"application/json"};
    await route.fulfill({body:await readFile(file),contentType:types[path.extname(file)]});
  });
  await page.goto("http://courtyard.test/index.html");
  const room=page.locator("canvas");
  const state=()=>room.evaluate(el=>({...el.dataset}));
  await page.getByRole("button",{name:"Approach shrine"}).waitFor();
  const start=await state();
  assert.deepEqual([start.x,start.y,start.clip],["193","201","idle"]);
  await page.keyboard.press("e");
  assert.equal((await state()).rings,"0");
  await page.setViewportSize({width:1280,height:640});
  assert.ok(await page.locator("footer").evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight));
  await page.keyboard.down("ArrowUp");
  await page.keyboard.down("d");
  await page.keyboard.up("d");
  const resumeFrom=+(await state()).y;
  await page.waitForFunction(y=>+document.querySelector("canvas").dataset.y<=y-6,resumeFrom,{timeout:2000});
  await page.keyboard.up("ArrowUp");
  const box=await room.boundingBox();
  const walk=(x,y)=>page.mouse.click(box.x+x*box.width/384,box.y+y*box.height/224);
  await walk(193,123);
  await page.waitForFunction(()=>document.querySelector("canvas").dataset.y==="123");
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(1450);
  await page.keyboard.up("ArrowLeft");
  const west=await state();
  assert.ok(+west.x>=142 && +west.x<=145 && west.y==="123");
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(2200);
  await page.keyboard.up("ArrowRight");
  const east=await state();
  assert.ok(+east.x>=239 && +east.x<=243 && east.y==="123");
  await page.getByRole("button",{name:"Approach shrine"}).click();
  await page.getByRole("button",{name:"Ring bell",exact:true}).waitFor();
  // Measure the pixels actually drawn in the area occupied by the moving rig and effect.
  const samples=page.evaluate(()=>new Promise(resolve=>{
    const el=document.querySelector("canvas"), ctx=el.getContext("2d");
    const frames=new Set(), fx=new Set(), hashes=new Set();
    const end=performance.now()+2400;
    function sample(){
      if(el.dataset.clip==="activation") {
        frames.add(el.dataset.frame);
        if(el.dataset.fx!=="") fx.add(el.dataset.fx);
        let hash=0;
        for(const v of ctx.getImageData(166,34,52,54).data) hash=(Math.imul(hash,31)+v)|0;
        hashes.add(hash);
      }
      if(performance.now()<end) requestAnimationFrame(sample);
      else resolve({rigFrames:frames.size,fxFrames:fx.size,pixelStates:hashes.size});
    }
    sample();
  }));
  await page.getByRole("button",{name:"Ring bell",exact:true}).click();
  const movement=await samples;
  assert.ok(movement.rigFrames>=12 && movement.fxFrames>=4 && movement.pixelStates>=10);
  await page.getByRole("button",{name:"Ring again"}).waitFor();
  await page.keyboard.press("e");
  await page.waitForFunction(()=>document.querySelector("canvas").dataset.rings==="2");
  if(process.argv[2]) await page.screenshot({path:process.argv[2]});
  await page.getByRole("button",{name:"Ring again"}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({spawn:[start.x,start.y],pondStops:[west.x,east.x],...movement,rings:2,errors}));
} finally { await browser.close(); }
