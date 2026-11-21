import { problem } from './editor-catalog.mjs';

/** Refuse anything that is not a same-origin request from a loopback peer to a loopback listener. */
export function assertLoopback(req, address) {
  const loop = ['127.0.0.1', '::1'];
  const host = req.headers.host;
  if (!loop.includes(address.address) || !loop.includes(req.socket.remoteAddress) ||
      !['localhost', '127.0.0.1', '[::1]'].some(h => host === h + ':' + address.port) ||
      (req.headers.origin !== undefined && req.headers.origin !== 'http://' + host) ||
      req.headers['sec-fetch-site'] === 'cross-site') throw problem(403, 'forbidden', 'Loopback and same origin required');
}
