// The top bar's location text, as data: pure, so Node tests can drive it. The bar is one line, so the clip, direction and
// frame of a route are ONE label ("clip idle · dir s · frame 3"), not one chip each.
/** {tab, asset, detail}: `detail` is null when the route carries none of clip / direction / frame. */
export function crumbParts(route, t) {
  const bits = [['clip', route.clip], ['dir', route.direction], ['frame', route.frame]].filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`);
  return {tab: t('nav.' + route.tab), asset: route.asset ?? null, detail: bits.length ? bits.join(' · ') : null};
}
