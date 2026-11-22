function inside(rect, x, y) {
  return x >= rect.left && y >= rect.top && x < rect.right && y < rect.bottom;
}

// Normalize each axis so all eight sectors fit the shallow landscape pad.
function directions(rect, clientX, clientY) {
  const x = 2 * (clientX - rect.left) / rect.width - 1;
  const y = 2 * (clientY - rect.top) / rect.height - 1;
  const ax = Math.abs(x), ay = Math.abs(y);
  if (Math.max(ax, ay) < .15) return [];
  const keys = [];
  const boundary = Math.tan(Math.PI / 8);
  if (ax > ay * boundary) keys.push(x < 0 ? 'ArrowLeft' : 'ArrowRight');
  if (ay > ax * boundary) keys.push(y < 0 ? 'ArrowUp' : 'ArrowDown');
  return keys;
}

export function bindTouchControls(pad, actions, canPlay) {
  const buttons = [...pad.querySelectorAll('button'), ...actions.querySelectorAll('button')];
  const contacts = new Map(), held = new Set(), pending = new Map();
  function refresh() {
    held.clear();
    for (const contact of contacts.values()) {
      for (const key of contact.keys) held.add(key);
    }
    for (const button of buttons) button.classList.toggle('held', held.has(button.dataset.key));
  }
  function release(id) {
    const contact = contacts.get(id);
    if (!contact) return;
    contacts.delete(id);
    if (contact.owner.hasPointerCapture(id)) contact.owner.releasePointerCapture(id);
    refresh();
  }
  for (const owner of [pad, ...actions.querySelectorAll('button')]) {
    owner.onpointerdown = event => {
      if (!canPlay() || event.button !== 0) return;
      event.preventDefault();
      const key = event.target.closest('button')?.dataset.key;
      const keys = key ? [key] : directions(pad.getBoundingClientRect(), event.clientX, event.clientY);
      owner.setPointerCapture(event.pointerId);
      contacts.set(event.pointerId, {owner, keys});
      if (owner !== pad) pending.set(event.pointerId, key);
      refresh();
    };
    owner.onpointermove = event => {
      const contact = contacts.get(event.pointerId);
      if (contact?.owner !== owner) return;
      const rect = owner.getBoundingClientRect();
      if (!inside(rect, event.clientX, event.clientY)) {
        pending.delete(event.pointerId);
        release(event.pointerId);
      } else if (owner === pad) {
        contact.keys = directions(rect, event.clientX, event.clientY);
        refresh();
      }
    };
    owner.onpointerup = owner.onpointercancel = owner.onlostpointercapture = event => {
      if (contacts.get(event.pointerId)?.owner !== owner) return;
      if (event.type !== 'pointerup') pending.delete(event.pointerId);
      release(event.pointerId);
    };
  }
  return {
    held,
    requested(key) { return [...pending.values()].includes(key); },
    consume() { pending.clear(); },
    reset() {
      pending.clear();
      for (const id of contacts.keys()) release(id);
    },
  };
}
