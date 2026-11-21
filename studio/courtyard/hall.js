import {AssetStore} from '../src/assetLoader.js';
import {posts, pulseOn, Trial, upgrades} from './trial.js';

const canvas = document.querySelector('#hall'), ctx = canvas.getContext('2d');
const game = new Trial(), store = new AssetStore();
const guardId = 'mob_courtyard_guard';
const keyNames = {arrowup:'up', w:'up', arrowdown:'down', s:'down', arrowleft:'left', a:'left', arrowright:'right', d:'right', j:'attack', ' ':'dash'};
const held = new Map();
const instructions = {
  arrival: ['The north gate seals', 'The bronze circle marks the guard’s arrival.'],
  combat: ['Break the guard’s stance', 'Hold Cast to strike. Leave the red circle or dash through the shield bash.'],
  fall: ['The guard yields', 'The bell’s last note settles over the hall.'],
  reward: ['Choose a discipline', 'Take one blessing for the crossing.'],
  exit: ['Cross the north gate', 'The gate is open. Cross the gold seal when it dims, or dash through its pulse.'],
  won: ['Trial complete', 'You carried the evening bell’s blessing through the north gate.'],
  lost: ['The bell falls silent', 'Return to the courtyard to attempt the trial again.'],
};
function sprite(key, x, y, options = {}) {
  const frame = store.resolveKey(key);
  if (frame?.type !== 'atlas') throw new Error('Missing atlas frame ' + key);
  const {sw, sh, sx, sy, image} = frame;
  const context = options.ctx || ctx;
  context.save();
  context.translate(Math.round(x), Math.round(y));
  if (options.flip) { context.translate(sw, 0); context.scale(-1, 1); }
  context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  context.restore();
}
function prop(id, x, y) {
  const key = 'props/' + id + '/idle_none_0';
  const {sw, sh} = store.resolveKey(key);
  sprite(key, x-sw/2, y-sh);
}
function rect(color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(x,y,w,h);
}
function ring(x,y,r,color) {
  ctx.strokeStyle=color;
  ctx.beginPath(); ctx.ellipse(x,y,r,r,0,0,Math.PI*2); ctx.stroke();
}
function drawRoom() {
  const floor = 'tilesets/ts_hengyue/floor_blob47_f0_46';
  for (let y=0; y<192; y+=16) {
    for (let x=0; x<320; x+=16) sprite(floor,x,y);
  }
  rect('rgba(20,30,28,.36)',0,0,320,192);
  // A stone sparring mat leaves the tell visible between the patterned borders.
  rect('#323b3b',24,56,272,112);
  rect('#515551',26,58,268,108);
  for (let row=0;row<6;row++) {
    for(let x=27-(row%2)*12;x<293;x+=24) {
      const left=Math.max(27,x);
      rect((row+Math.floor(x/24))%3===0?'#424846':'#404644',left,59+row*17,Math.min(x+23,293)-left,16);
    }
  }
  ctx.strokeStyle='#74705a';ctx.beginPath();ctx.ellipse(160,111,38,24,0,0,2*Math.PI);ctx.stroke();
  ctx.beginPath();ctx.moveTo(160,94);ctx.lineTo(179,111);ctx.lineTo(160,128);ctx.lineTo(141,111);ctx.closePath();ctx.stroke();
  for (const x of [0,310]) rect('#273a32',x,0,10,192);
  rect('#22322d',0,178,320,14);
  for (let x=0;x<320;x+=16) sprite('tilesets/ts_hengyue/wall_top_blob47_f0_46',x,0);
  for (const x of [12,303]) rect('#a5915c',x,17,1,159);
  rect('#a5915c',12,176,292,1);
  const open = ['exit','won'].includes(game.phase);
  rect('#141d1a',139,0,42,18);
  rect('#c4a565',137,0,3,21); rect('#c4a565',180,0,3,21);
  if (!open) {
    rect('#8d634e',14,56,292,2);
    for(let x=18;x<306;x+=12) rect('#c8a26c',x,54,2,5);
    for (let x=143;x<180;x+=7) rect('#a37752',x,1,3,17);
    rect('#cfb07b',139,10,42,2);
  } else {
    rect('#9ae3b8',143,17,35,2);
    for(let i=0;i<3;i++) rect('#e5d08d',157+i,12-i,6-2*i,1);
    const active = pulseOn(game.clock);
    rect(active?'#d7a348':'#647362',14,46,292,2);
    for(let x=18;x<306;x+=12) rect(active?'#f4da92':'#89977c',x,active?43:48,3,active?9:1);
  }
  prop('prop_sect_banner',84,28); prop('prop_sect_banner',236,28);
}
function drawGuard() {
  const g=game.guard, spec=store.mobRuntime[guardId].facings[g.facing];
  let anim='move', index=Math.floor(game.time*8)%6;
  if(game.phase==='fall') {anim='death'; index=Math.min(3,Math.floor(game.clock/.13));}
  else if(g.mode!=='move'){
    anim='attack';
    index=g.mode==='windup'?Math.min(2,Math.floor(g.clock*4)):Math.min(5,3+Math.floor(g.clock*5));
  }
  const [x,y]=spec.anchor_px;
  sprite(`characters/${guardId}/${anim}_${spec.source}_${index}`,g.x-x,g.y-y,{flip:spec.flip_x});
  rect('#241d21',g.x-10,g.y-34,20,3);
  rect('#e3a073',g.x-10,g.y-34,g.hp*5,2);
}
function drawPlayer() {
  const p=game.player;
  let anim='idle', index=Math.floor(game.time*7)%4;
  if(game.phase==='lost') {anim='death';index=3;}
  else if(game.dashTime) {anim='dash';index=Math.min(3,Math.floor((.24-game.dashTime)*18));}
  else if(game.cast) {anim='cast_attack';index=Math.min(3,Math.floor((.22-game.cast)*20));}
  else if(game.walking) {anim='run';index=Math.floor(game.time*10)%6;}
  if(game.ward) ring(p.x,p.y-12,16,'#f2d88f');
  ctx.globalAlpha=game.invulnerable && Math.floor(game.time*14)%2 ? .55 : 1;
  sprite(`characters/wl_outer_disciple/${anim}_${p.facing}_${index}`,p.x-16,p.y-31);
  ctx.globalAlpha=1;
}
function render() {
  drawRoom();
  const g=game.guard;
  if(game.phase==='arrival') ring(g.x,g.y,8+game.clock*11,'#e9ca82');
  if(game.phase==='combat' && g.mode!=='move') {
    const windup=g.mode==='windup';
    if(windup || g.clock<.2) {
      ctx.fillStyle=windup?'rgba(188,62,55,.22)':'rgba(234,159,91,.48)';
      ctx.beginPath();ctx.arc(g.x,g.y,37,0,2*Math.PI);ctx.fill();
      ring(g.x,g.y,37,'#f49f71');
      if(windup) ring(g.x,g.y,Math.max(1,37*g.clock/.75),'#ffcf85');
    }
  }
  const actors=posts.map(p=>({y:p.y,draw:()=>prop('prop_courtyard_pillar',p.x,p.y)}));
  actors.push({y:game.player.y,draw:drawPlayer});
  if(game.phase==='fall' || (g.hp>0 && ['combat','lost'].includes(game.phase))) actors.push({y:g.y,draw:drawGuard});
  for(const a of actors.sort((a,b)=>a.y-b.y)) a.draw();
  for(const s of game.shots) {
    rect('#56aea0',s.x-3,s.y-12,6,3); rect('#e5f5c3',s.x-1,s.y-13,3,4);
  }
  const hp=document.querySelector('#health');
  hp.textContent='Life '+game.player.hp+'/3'+(game.ward?' · Ward':'');
  Object.assign(canvas.dataset,{phase:game.phase,x:Math.round(game.player.x),y:Math.round(game.player.y),facing:game.player.facing,
    guardHp:g.hp,guardMode:g.mode,hp:game.player.hp,upgrade:game.upgrade||'',dash:game.dashTime>0,ward:game.ward});
}
function syncPhase() {
  const [title,hint]=instructions[game.phase];
  document.querySelector('#objective').textContent=title;
  document.querySelector('#hint').textContent=hint;
  document.querySelector('#choices').hidden=game.phase!=='reward';
  const terminal=['won','lost'].includes(game.phase);
  document.querySelector('#restart').hidden=!terminal;
  document.querySelector('.controls').hidden=terminal || game.phase==='reward';
  if(game.phase==='reward') {held.clear(); document.querySelector('#choices button').focus({preventScroll:true});}
  if(terminal) {held.clear(); document.querySelector('#restart').focus({preventScroll:true});}
}
async function start() {
  await store.init();
  ctx.imageSmoothingEnabled=false;
  for(const [id,upgrade] of Object.entries(upgrades)) {
    const button=document.createElement('button'), icon=document.createElement('canvas');
    icon.width=icon.height=24;
    sprite('ui/'+upgrade.icon+'/static_none_0',0,0,{ctx:icon.getContext('2d')});
    const title=document.createElement('strong'), detail=document.createElement('small');
    title.textContent=upgrade.name;detail.textContent=upgrade.detail;
    button.append(icon,title,detail);
    let pressedHere = false;
    button.onpointerdown = () => { pressedHere = true; };
    button.onpointercancel = () => { pressedHere = false; };
    button.onclick = event => {
      // A held touch action can disappear beneath a finger as the rewards open.
      if (event.detail && !pressedHere) return;
      pressedHere = false;
      game.choose(id);
      syncPhase();
    };
    document.querySelector('#choices').append(button);
  }
  const active=()=>!['won','lost','reward'].includes(game.phase);
  window.addEventListener('keydown',e=>{
    const key=keyNames[e.key.toLowerCase()];
    if(!key || !active() || e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault(); held.set(e.code,key);
  });
  window.addEventListener('keyup',e=>held.delete(e.code));
  window.addEventListener('blur',()=>held.clear());
  document.addEventListener('visibilitychange',()=>held.clear());
  for(const button of document.querySelectorAll('[data-key]')) {
    button.onpointerdown=e=>{
      if(!active()) return;
      e.preventDefault();button.setPointerCapture(e.pointerId);
      held.set(e.pointerId,button.dataset.key);
    };
    button.onlostpointercapture=button.onpointerup=button.onpointercancel=e=>held.delete(e.pointerId);
  }
  document.querySelector('#restart').onclick=()=>location.assign('./');
  let previous=performance.now(), accumulator=0;
  syncPhase();
  function frame(now) {
    const keys=new Set(held.values());
    const input={x:Number(keys.has('right'))-Number(keys.has('left')),y:Number(keys.has('down'))-Number(keys.has('up')),
      attack:keys.has('attack'),dash:keys.has('dash')};
    accumulator+=Math.min(.1,(now-previous)/1000); previous=now;
    const phase=game.phase;
    while(accumulator>=1/60) {game.step(1/60,input);accumulator-=1/60;}
    if(phase!==game.phase) syncPhase();
    render();requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
start().catch(error=>{document.querySelector('#objective').textContent='The hall could not load';document.querySelector('#hint').textContent='Return to the courtyard and try again.';console.error(error);});
