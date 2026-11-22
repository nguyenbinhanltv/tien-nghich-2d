// URL routing for the shell. Pure functions, no DOM, so Node tests can drive them.
//
//   #/<tab>[/<assetId>][?clip=<clip>&dir=<direction>&frame=<n>&source=<id>&...]
//
// The route object is {tab, asset, clip, direction, frame, params}. `params` holds every other
// query parameter, untouched, so a tab can carry its own state in the URL.
import { destinationIds } from './destinations.mjs';

/** The Projects screen is not one of the nine destinations: it is the shell's own, reached from the project switcher. */
export const hubTab = 'projects';

const known = ['clip', 'dir', 'frame'];
const assetPattern = /^[A-Za-z0-9_.-]+$/;

export const defaultRoute = () => ({tab: 'overview', asset: null, clip: null, direction: null, frame: null, params: {}});

export function parseHash(hash) {
  const route = defaultRoute();
  const text = (hash ?? '').replace(/^#\/?/, '');
  const q = text.indexOf('?');
  const pathPart = q < 0 ? text : text.slice(0, q), query = q < 0 ? '' : text.slice(q + 1);
  const [tab, asset] = pathPart.split('/').map(part => {
    try { return decodeURIComponent(part); } catch { return ''; }
  });
  if (destinationIds.includes(tab) || tab === hubTab) route.tab = tab;
  if (route.tab === tab && tab !== hubTab && asset && assetPattern.test(asset)) route.asset = asset;
  const search = new URLSearchParams(query);
  const clip = search.get('clip');
  if (route.asset && clip && assetPattern.test(clip)) route.clip = clip;
  const dir = search.get('dir');
  if (route.asset && dir && /^[a-z]+$/.test(dir)) route.direction = dir;
  const frame = search.get('frame');
  if (route.asset && /^(0|[1-9][0-9]{0,5})$/.test(frame ?? '')) route.frame = Number(frame);
  for (const [key, value] of search) if (!known.includes(key) && !(key in route.params)) route.params[key] = value;
  return route;
}

export function formatHash(route) {
  const r = {...defaultRoute(), ...route};
  let out = '#/' + encodeURIComponent(r.tab);
  if (r.asset) out += '/' + encodeURIComponent(r.asset);
  const search = new URLSearchParams();
  if (r.asset && r.clip) search.set('clip', r.clip);
  if (r.asset && r.direction) search.set('dir', r.direction);
  if (r.asset && r.frame != null) search.set('frame', String(r.frame));
  for (const [key, value] of Object.entries(r.params ?? {})) if (!known.includes(key)) search.set(key, value);
  const query = search.toString();
  return query ? out + '?' + query : out;
}

export const sameRoute = (a, b) => formatHash(a) === formatHash(b);
