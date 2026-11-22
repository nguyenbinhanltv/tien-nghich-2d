// `node studio/mcp.mjs --self-test`: spawns the server as a child and drives real handshakes.
import { StdioClient } from './stdio_client.mjs';
import { LEGACY_VERSIONS, META_CLIENT_INFO, META_VERSION, MODERN_VERSIONS } from './protocol.mjs';

export async function runSelfTest({ projectRoot, entry }) {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.error(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };
  const args = ['--project', projectRoot, '--agent', 'self-test'];
  console.error(`studio-mcp self-test against ${projectRoot}`);

  // Legacy handshake (what Claude Code, Codex and Antigravity send today, depending on version).
  const a = new StdioClient(entry, args);
  try {
    const init = await a.request(1, 'initialize', { protocolVersion: LEGACY_VERSIONS[0], capabilities: {}, clientInfo: { name: 'self-test', version: '0' } });
    check('legacy initialize negotiates', init.result?.protocolVersion === LEGACY_VERSIONS[0], init.result?.protocolVersion);
    a.notify('notifications/initialized');
    const list = await a.request(2, 'tools/list', {});
    const names = (list.result?.tools ?? []).map((t) => t.name);
    check('legacy tools/list has the read tools', names.includes('studio_project_info') && names.includes('studio_qa_run') && !names.includes('studio_frames_submit'), `${names.length} tools at scope read`);
    const call = await a.request(3, 'tools/call', { name: 'studio_project_info', arguments: {} });
    const s = call.result?.structuredContent;
    check('tools/call returns 40 palette colours', s?.palette?.count === 40 && s.palette.colors.length === 40);
    check('tools/call returns asset counts', s?.assetCounts?.base?.total > 0 && s.assetCounts.longtime.total > 0, `base ${s?.assetCounts?.base?.total}, longtime ${s?.assetCounts?.longtime?.total}`);
    check('caller agent recorded', s?.connection?.agent === 'self-test', s?.connection?.agent);
    const search = await a.request(40, 'tools/call', { name: 'studio_catalog_search', arguments: { source: 'longtime', limit: 1 } });
    check('studio_catalog_search finds Longtime assets', search.result?.structuredContent?.total > 0, `total ${search.result?.structuredContent?.total}`);
    const qa = await a.request(41, 'tools/call', { name: 'studio_qa_run', arguments: { assetId: 'lt_kiln_keeper' } });
    check('studio_qa_run passes a shipped asset', qa.result?.structuredContent?.pass === true, `${qa.result?.structuredContent?.summary?.frames} frames`);
    const sheet = await a.request(42, 'tools/call', { name: 'studio_preview_render', arguments: { assetId: 'lt_kiln_keeper', clip: 'idle', direction: 'south' } });
    check('studio_preview_render returns an image', sheet.result?.content?.some((c) => c.type === 'image' && c.mimeType === 'image/png' && c.data.length > 100));
    const human = await a.request(43, 'tools/call', { name: 'studio_review_approve', arguments: {} });
    check('there is no tool to approve (unknown tool, -32602)', human.error?.code === -32602);
    const bad = await a.request(4, 'tools/call', { name: 'no_such_tool', arguments: {} });
    check('unknown tool -> JSON-RPC -32602', bad.error?.code === -32602);
    a.writeRaw('{not json');
    const ping = await a.request(5, 'ping', {}); // answered after the parse error, so ordering proves the reply
    check('malformed JSON -> -32700 and server survives', a.stdoutLines.some((l) => l.includes('"code":-32700')) && ping.result !== undefined);
    const allJson = a.stdoutLines.every((l) => { try { return JSON.parse(l).jsonrpc === '2.0'; } catch { return false; } });
    check('stdout carries only JSON-RPC messages', allJson);
  } catch (e) {
    check('legacy session', false, e.message);
  }
  const exitA = await a.close();
  check('exits 0 on stdin EOF', exitA.code === 0, JSON.stringify(exitA));

  // Modern (2026-07-28) stateless requests.
  const b = new StdioClient(entry, args);
  try {
    const meta = { [META_VERSION]: MODERN_VERSIONS[0], [META_CLIENT_INFO]: { name: 'self-test', version: '0' } };
    const d = await b.request('d1', 'server/discover', { _meta: meta });
    check('modern server/discover', d.result?.supportedVersions?.includes(MODERN_VERSIONS[0]) && d.result.resultType === 'complete');
    const c = await b.request('c1', 'tools/call', { name: 'studio_project_info', arguments: { sections: ['palette'] }, _meta: meta });
    check('modern tools/call', c.result?.resultType === 'complete' && c.result.structuredContent?.palette?.count === 40);
    const u = await b.request('u1', 'tools/list', { _meta: { [META_VERSION]: '1900-01-01' } });
    check('unsupported modern version -> -32022', u.error?.code === -32022 && u.error.data?.supported?.includes(MODERN_VERSIONS[0]));
  } catch (e) {
    check('modern session', false, e.message);
  }
  await b.close();

  const pass = results.every(Boolean);
  console.error(pass ? `\nself-test PASSED (${results.length} checks)` : '\nself-test FAILED');
  return pass ? 0 : 1;
}
