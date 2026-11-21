const canvas = document.querySelector("#room");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
const button = document.querySelector("#action");
const hint = document.querySelector("#hint");

async function read(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(path + " " + response.status);
  return response.json();
}

async function loadImage(path) {
  const image = new Image();
  image.src = path;
  await image.decode();
  return image;
}

async function play() {
  const [map, nav, rig, effect] = await Promise.all([
    read("art/map.tmj"), read("art/nav-grid.json"), read("art/bell.json"), read("art/bronze_chime.json")
  ]);
  const plate = map.layers.find(l => l.type === "imagelayer");
  const markers = map.layers.find(l => l.name === "interactions").objects;
  const spawn = markers.find(o => o.type === "spawn");
  const shrine = markers.find(o => o.type === "interaction");
  const anchor = markers.find(o => o.type === "anchor");
  const property = (o,name) => o.properties.find(p => p.name === name).value;
  const [target] = JSON.parse(property(anchor,"approach"));
  const reach = property(shrine,"reach");
  const [scene, actor, idle, activation, spark] = await Promise.all([
    plate.image, "disciple.png", rig.clips.idle.sheet, rig.clips.activation.sheet, effect.image
  ].map(p => loadImage("art/" + p)));

  // Grid centres and outgoing cardinal edges come from Forge's swept-footprint checks.
  const {cols, rows, cell, moveBits} = nav;
  const directions = {N:[0,-1],S:[0,1],W:[-1,0],E:[1,0]};
  const keys = {ArrowUp:"N",ArrowDown:"S",ArrowLeft:"W",ArrowRight:"E",w:"N",s:"S",a:"W",d:"E"};
  const node = (x,y) => Math.floor(y/cell)*cols + Math.floor(x/cell);
  const center = id => [((id%cols)+.5)*cell,(Math.floor(id/cols)+.5)*cell];
  function step(id, direction) {
    const edges = parseInt(nav.moves[Math.floor(id/cols)][id%cols],16);
    if (!(edges & moveBits[direction])) return id;
    const [x,y] = directions[direction];
    return id+x+y*cols;
  }
  let player = node(spawn.x,spawn.y);
  const pressedKeys = [];
  let path = [], accumulator = 0;
  let ringStart = null, rings = 0, lastState = "", walkClock = 0;
  const close = () => {
    const [x,y] = center(player);
    return Math.hypot(x-shrine.x,y-shrine.y) <= reach;
  };

  function routeTo(x,y) {
    if (x<0 || y<0 || x>=cols*cell || y>=rows*cell) return;
    const goal = node(x,y);
    if (nav.reachable[Math.floor(goal/cols)][goal%cols] !== "1") {
      hint.textContent = "That way is blocked. Follow the stone path.";
      return;
    }
    const from = new Int32Array(cols*rows).fill(-1);
    const queue = [player];
    from[player] = player;
    for (let i=0; i<queue.length && from[goal]===-1; i++) {
      for (const dir of Object.keys(directions)) {
        const next = step(queue[i],dir);
        if (from[next]!==-1) continue;
        from[next]=queue[i];
        queue.push(next);
      }
    }
    if (from[goal]===-1) return;
    path=[];
    for (let at=goal; at!==player; at=from[at]) path.push(at);
    path.reverse();
    pressedKeys.length=0;
    lastState="";
  }

  function ring() {
    if (!close() || ringStart!==null) return;
    ringStart=performance.now();
    rings++;
    path=[];
    pressedKeys.length=0;
    canvas.focus({preventScroll:true});
  }
  function updateGuide() {
    const mode = ringStart!==null ? "ringing" : close() ? "close" : "far";
    const state = mode + rings + (path.length>0);
    if (state===lastState) return;
    lastState=state;
    document.querySelector("#state").textContent = mode==="ringing" ? "Resonating" : rings ? "Shrine awakened" : "Dusk";
    document.querySelector("#objective").textContent = rings ? "The evening bell is awake" : "Ring the shrine bell";
    hint.textContent = mode==="ringing" ? "The bronze bell swings; a golden chime crosses the steps."
      : mode==="close" ? "You are at the shrine. Press E or ring the bell below."
      : path.length ? "Walking the courtyard path…" : "Enter through the south gate and follow the stone path.";
    button.textContent = mode==="ringing" ? "Ringing…" : mode==="close" ? (rings ? "Ring again" : "Ring bell") : "Approach shrine";
    button.disabled=mode==="ringing";
    document.querySelector("#passage").hidden = !rings || mode==="ringing";
  }
  button.addEventListener("click",()=>{ if(close()) ring(); else routeTo(...target); });
  canvas.addEventListener("pointerdown",event=>{
    const box=canvas.getBoundingClientRect();
    const x=(event.clientX-box.left)*canvas.width/box.width, y=(event.clientY-box.top)*canvas.height/box.height;
    canvas.focus({preventScroll:true});
    if (ringStart!==null) return;
    if (Math.abs(x-shrine.x)<19 && y>=36 && y<=shrine.y) {
      if(close()) ring(); else routeTo(...target);
    } else routeTo(x,y);
  });
  window.addEventListener("keydown",event=>{
    if(event.altKey || event.ctrlKey || event.metaKey) return;
    const k=event.key.length===1 ? event.key.toLowerCase() : event.key;
    if(k==="e") { if(!event.repeat) ring(); return; }
    if(!keys[k] || ringStart!==null) return;
    event.preventDefault();
    if (event.repeat || pressedKeys.includes(k)) return;
    pressedKeys.push(k);
    path=[]; player=step(player,keys[k]); lastState="";
  });
  window.addEventListener("keyup",event=>{
    const k=event.key.length===1 ? event.key.toLowerCase() : event.key;
    const index=pressedKeys.indexOf(k);
    if(index!==-1) pressedKeys.splice(index,1);
  });
  window.addEventListener("blur",()=>{pressedKeys.length=0;});

  let previous=performance.now();
  function paint(now) {
    const elapsed=Math.min(80,now-previous);
    previous=now;
    const held=keys[pressedKeys.at(-1)];
    const moving = (held || path.length) && ringStart===null;
    if(moving) {
      accumulator+=elapsed;
      walkClock+=elapsed;
      while(accumulator>=30 && (held || path.length)) {
        player=held ? step(player,held) : path.shift();
        accumulator-=30;
      }
    } else accumulator=0;
    const [x,y]=center(player);
    const t=ringStart===null ? 0 : (now-ringStart)/1000;
    const striking=ringStart!==null && t<rig.clips.activation.frames/rig.fps;
    if(!striking) ringStart=null;
    ctx.drawImage(scene,0,0);
    const frame=striking ? Math.floor(t*rig.fps) : Math.floor(now*rig.fps/1000)%rig.clips.idle.frames;
    const w=rig.frameSize;
    ctx.drawImage(striking?activation:idle,frame*w,0,w,w,shrine.x-rig.pivot[0],38-rig.pivot[1],w,w);
    const fxFrame=Math.floor((t-.26)*effect.fps);
    const fx=striking && fxFrame>=0 && fxFrame<effect.frames.length ? effect.frames[fxFrame] : null;
    if(fx) ctx.drawImage(spark,fx.x,fx.y,fx.w,fx.h,shrine.x-fx.w/2,64-fx.h/2,fx.w,fx.h);
    ctx.fillStyle="#2c2733";
    ctx.beginPath(); ctx.ellipse(x,y,8,3,0,0,2*Math.PI); ctx.fill();
    ctx.drawImage(actor,x-10,y-23-(moving?Math.floor(walkClock/110)%2:0));
    // Expose the state of the actual draw calls for playback verification.
    Object.assign(canvas.dataset,{x,y,clip:striking?"activation":"idle",frame,fx:fx?fxFrame:"",rings});
    updateGuide();
    requestAnimationFrame(paint);
  }
  requestAnimationFrame(paint);
}
play().catch(error=>{
  console.error(error);
  hint.textContent="The courtyard could not load. Reload to try again.";
});
