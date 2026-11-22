// The licence and provenance LEDGER: one list built only from what the project has recorded. Per asset, its origin
// (a generator script with its seed, a tool render of a spec, a sheet from an image tool with the prompt hash, a retired service, an
// audio engine document or synthesis script, a third-party source) and the files that say so; per tool and input, the licence the
// project recorded. Where nothing is recorded the ledger says "not recorded" and never guesses. It states facts and lists what a human
// must decide; it makes no legal conclusion. Read-only.
//
// What counts as a record is declared in the project pack (`ui.tabs.atlas.ledger`): per-asset provenance file names, studio submission
// records, origin logs, descriptors, audio provenance, the third-party components and where the project keeps them.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readInside, readJsonIfExists, walkFiles } from './files.mjs';
import { fillTemplate } from './pack.mjs';

export const NOT_RECORDED = 'not recorded';
/** Origin kinds, in the order they are listed. */
export const ORIGIN_KINDS = ['generator', 'tool-render', 'forge-sheet', 'retired-tool', 'audio-engine', 'audio-script', 'third-party', 'unclassified', 'not-recorded'];

const sha256 = text => createHash('sha256').update(text).digest('hex');
const str = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
const exists = (root, rel) => fs.access(path.join(root, rel)).then(() => true, () => false);
const jsonLines = async (root, rel) => {
  try { return (await readInside(root, rel)).toString('utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
const jsonFile = async (root, rel) => { try { return await readJsonIfExists(root, rel); } catch { return undefined; } };

const origin = (kind, fields = {}) => ({kind, tool: null, toolPin: null, producer: null, script: null, scriptSha256: null, seed: null, promptHash: null, sourceHash: null, method: null, agent: null, document: null, ...fields});

/** The fields a kind is expected to carry; those it lacks are listed as not recorded. */
const EXPECTED = {generator: ['script', 'seed'], 'tool-render': ['tool', 'script'], 'forge-sheet': ['tool', 'promptHash', 'sourceHash'], 'retired-tool': ['tool'],
  'audio-engine': ['document'], 'audio-script': ['script', 'seed'], 'third-party': ['source']};

function fromProvenance(doc, file, retired) {
  const producer = str(doc.producer ?? doc.creator), method = str(doc.method ?? doc.synthesis), text = `${producer ?? ''} ${method ?? ''}`;
  const rights = str(doc.rights);
  const common = {producer, method, rights, sourceHash: str(doc.source_sha256 ?? doc.wav_sha256), seed: doc.seed ?? null};
  if (str(doc.tool) && (str(doc.generator) || doc.specs)) return origin('tool-render', {...common, tool: doc.tool, toolPin: str(doc.tool_pin), toolLicence: str(doc.tool_license), script: str(doc.generator), scriptSha256: str(doc.generator_sha256 ?? doc.generator_sha256_lf)});
  if (str(doc.generator)) return origin('generator', {...common, script: doc.generator, scriptSha256: str(doc.generator_sha256_lf ?? doc.generator_sha256)});
  const hit = retired.find(r => new RegExp(r.match, 'i').test(text));
  if (hit) return origin('retired-tool', {...common, tool: hit.tool});
  return origin('unclassified', {...common});
}

async function loadLogs(root, config) {
  const byId = new Map();
  for (const log of config.originLogs ?? []) {
    const doc = await jsonFile(root, log.file);
    if (!doc) continue;
    for (const entry of Array.isArray(doc[log.list]) ? doc[log.list] : []) {
      const id = entry?.[log.id];
      if (typeof id !== 'string') continue;
      byId.set(id, {...log, entry, script: log.script ?? str(doc[log.scriptField]), file: log.file});
    }
  }
  return byId;
}

/** Owner decisions (`config.rightsDecisions`: files of {decisions: [{id, rights, assets: [asset ids]}]}): asset id -> {rights, file, decision}. */
async function loadRightsDecisions(root, config) {
  const byId = new Map();
  for (const file of config.rightsDecisions ?? []) {
    const doc = await jsonFile(root, file);
    for (const d of Array.isArray(doc?.decisions) ? doc.decisions : []) {
      const rights = str(d?.rights);
      if (!rights || !Array.isArray(d.assets)) continue;
      for (const id of d.assets) if (typeof id === 'string' && !byId.has(id)) byId.set(id, {rights, file, decision: str(d.id)});
    }
  }
  return byId;
}

async function loadAudio(root, config) {
  const batches = new Map();
  const spec = config.audio?.batches;
  if (spec) for (const file of await walkFiles(root, spec.root, f => f.endsWith('/' + spec.file))) {
    const doc = await jsonFile(root, file);
    for (const m of doc?.[spec.list] ?? []) if (typeof m?.[spec.id] === 'string') batches.set(m[spec.id], {file, doc, entry: m});
  }
  return batches;
}

/** The ledger of a project. `index` is the asset index (see assets.mjs), `pack` the loaded pack. */
export async function buildLedger({root, pack, index}) {
  const config = pack.ui?.tabs?.atlas?.ledger ?? {};
  const retired = Object.entries(config.agentOrigins ?? {}).filter(([, v]) => v.kind === 'retired-tool').map(([key, v]) => ({match: key.replace(/[^A-Za-z0-9]/g, ''), tool: v.tool}));
  const audioIds = new Set([...index.assets.values()].filter(a => a.audio).map(a => a.id));
  const logs = await loadLogs(root, config), batches = await loadAudio(root, config), decided = await loadRightsDecisions(root, config);
  const records = [];
  const sourcesFile = config.thirdPartySources;
  const thirdParty = {file: sourcesFile ?? null, present: sourcesFile ? await exists(root, sourcesFile) : false};

  for (const asset of index.assets.values()) {
    const evidence = [];
    let o = null, rights = null;
    const rawDir = asset.layout?.rawDir ?? (config.rawDirs?.[asset.source] ? fillTemplate(config.rawDirs[asset.source], {id: asset.id}) : null);
    const note = [];

    // 1. what studio agents recorded when they submitted frames (the most specific record)
    if (rawDir) {
      const [submissions, forge] = [await jsonLines(root, `${rawDir}/${(config.studioRecords ?? [])[0] ?? 'studio-submissions.jsonl'}`),
        await jsonFile(root, `${rawDir}/${(config.studioRecords ?? [])[1] ?? 'forge/import.json'}`)];
      const first = submissions.find(r => r.kind === 'frames');
      if (forge?.tool && typeof forge.prompt === 'string') {
        o = origin('forge-sheet', {tool: forge.tool, promptHash: sha256(forge.prompt), sourceHash: str(forge.sheet?.sha256), agent: str(forge.agent), producer: str(forge.agent)});
        evidence.push(`${rawDir}/${(config.studioRecords ?? [])[1] ?? 'forge/import.json'}`);
      } else if (first) {
        const generated = str(first.generator) && !str(first.prompt);
        o = origin(generated ? 'generator' : 'forge-sheet', {tool: str(first.tool), script: str(first.generator), promptHash: typeof first.prompt === 'string' ? sha256(first.prompt) : null, sourceHash: str(first.sourceHash), agent: str(first.agent), producer: str(first.agent)});
        rights = str(first.rights);
        evidence.push(`${rawDir}/${(config.studioRecords ?? [])[0] ?? 'studio-submissions.jsonl'}`);
      }
    }
    // 2. the provenance file the project keeps beside an asset's source
    if (!o && rawDir) for (const name of config.assetRecords ?? []) {
      const rel = `${rawDir}/${name}`, doc = await jsonFile(root, rel);
      if (!doc || typeof doc !== 'object') continue;
      o = fromProvenance(doc, rel, retired);
      rights = o.rights ?? null; delete o.rights; delete o.toolLicence;
      if (doc.tool_license) o.toolLicence = doc.tool_license;
      evidence.push(rel);
      break;
    }
    // 3. audio: studio engine document, a single cue's provenance, or its batch's
    if (!o && asset.audio) {
      const docs = await walkFiles(root, asset.audio.dir, f => f.endsWith('.json'));
      const single = config.audio?.singles ? fillTemplate(config.audio.singles, {id: asset.id}) : null;
      const batch = batches.get(asset.id);
      if (docs.length) { o = origin('audio-engine', {document: docs[0], tool: 'studio audio engine'}); evidence.push(...docs.slice(0, 3)); }
      else if (single && await exists(root, single)) {
        const doc = await jsonFile(root, single);
        o = origin('audio-script', {producer: str(doc?.creator), method: str(doc?.render ?? doc?.patch), script: Object.keys(doc?.inputs ?? {}).find(k => k.endsWith('.py')) ?? null, seed: doc?.patch?.match?.(/seed (\d+)/i)?.[1] ? Number(doc.patch.match(/seed (\d+)/i)[1]) : null, sourceHash: str(doc?.wav_sha256)});
        rights = str(doc?.rights); evidence.push(single);
      } else if (batch) {
        o = origin('audio-script', {producer: str(batch.doc.creator), method: str(batch.doc.synthesis), script: str(batch.doc.rebuild)?.split(/\s+/).find(w => w.endsWith('.py')) ?? null, seed: batch.entry.seed ?? null, sourceHash: str(batch.entry.wav_sha256)});
        rights = str(batch.doc.rights); evidence.push(batch.file);
      }
    }
    // 4. a log of generator or service runs that names the asset
    if (!o && logs.has(asset.id)) {
      const log = logs.get(asset.id);
      const retiredTool = log.origin === 'retired-tool' ? Object.values(config.agentOrigins ?? {}).find(v => v.kind === 'retired-tool')?.tool ?? null : null;
      o = origin(log.origin, {script: log.script ?? null, tool: retiredTool ?? str(log.entry.tool), agent: str(asset.assignedAgent), ...(log.fields?.includes('character_uuid') ? {externalId: str(log.entry.character_uuid)} : {})});
      evidence.push(log.file);
    }
    // 5. a descriptor an asset points at (a rendered effect names the spec it came from)
    if (!o) for (const d of config.descriptors ?? []) {
      if (asset.sourceId !== d.source && asset.source !== d.source) continue;
      const rel = fillTemplate(d.file, {descriptor: asset.spec?.descriptor ?? '', id: asset.id});
      const doc = rel && await jsonFile(root, rel);
      if (doc?.[d.field]) { o = origin(d.origin, {tool: d.tool ?? null, script: str(doc[d.field])}); evidence.push(rel, ...(d.evidence ?? [])); break; }
    }
    // 6. only the route the manifest assigned: a claim, not a record
    if (!o) {
      o = origin('not-recorded', {agent: str(asset.assignedAgent)});
      if (asset.assignedAgent) note.push(`the manifest assigns this asset to "${asset.assignedAgent}", but no file records how it was made`);
    }
    // 7. the project owner's recorded decision about an asset's output rights; it fills a gap and never replaces a rights string an asset's own file records
    if (!rights && decided.has(asset.id)) { const d = decided.get(asset.id); rights = d.rights; evidence.push(d.file); }
    // a retired-service character with a source export folder: list the export's own record
    if (o.kind === 'retired-tool' && rawDir) { const meta = `${rawDir}/metadata.json`; if (await exists(root, meta)) evidence.push(meta); }
    const missing = (EXPECTED[o.kind] ?? []).filter(f => o[f] === null || o[f] === undefined);
    records.push({id: asset.id, source: asset.source, category: asset.category, readiness: asset.readiness ?? null, origin: o, rights, evidence: [...new Set(evidence)], recorded: o.kind !== 'not-recorded', missing, notes: note});
  }

  // components: declared in the pack, then any tool the provenance files name that the pack did not declare
  const declared = (config.components ?? []).map(c => ({id: c.id, name: c.name, role: c.role ?? null, licence: str(c.licence), pin: str(c.pin), ships: c.ships ?? null, mustNotShip: Boolean(c.mustNotShip), flag: c.flag ?? null, evidenceFiles: c.evidence ?? [], declared: true}));
  for (const c of declared) {
    c.evidence = await Promise.all(c.evidenceFiles.map(async p => ({path: p, exists: await exists(root, p)})));
    delete c.evidenceFiles;
  }
  const seen = new Map();
  for (const r of records) if (r.origin.tool && r.origin.toolPin) seen.set(r.origin.tool, {tool: r.origin.tool, pin: r.origin.toolPin, licence: r.origin.toolLicence ?? null, count: (seen.get(r.origin.tool)?.count ?? 0) + 1});
  const components = declared.map(c => {
    const found = seen.get(c.id);
    const flags = [...(c.flag ? [c.flag] : [])];
    if (found && c.pin && found.pin !== c.pin) flags.push(`The pack lists pin ${c.pin} but the asset provenance records ${found.pin}.`);
    if (found && c.licence && found.licence && found.licence !== c.licence) flags.push(`The pack lists licence ${c.licence} but the asset provenance records ${found.licence}.`);
    if (c.mustNotShip) flags.push('Marked must-not-ship.');
    if (!c.licence) flags.push('Licence not recorded in the project.');
    if (c.evidence.some(e => !e.exists)) flags.push('A listed evidence file is missing: ' + c.evidence.filter(e => !e.exists).map(e => e.path).join(', '));
    return {...c, licence: c.licence ?? NOT_RECORDED, usedBy: found?.count ?? 0, flags};
  });
  for (const [tool, found] of seen) if (!components.some(c => c.id === tool)) components.push({id: tool, name: tool, role: null, licence: found.licence ?? NOT_RECORDED, pin: found.pin, ships: null, mustNotShip: false, declared: false, evidence: [], usedBy: found.count, flags: ['Named by asset provenance but not listed in the project pack.']});

  // fonts: files that exist in the project (a font is a third-party input with its own licence)
  const scan = config.fontScan ?? {roots: [], extensions: []};
  const fonts = [];
  for (const base of scan.roots) fonts.push(...await walkFiles(root, base, f => scan.extensions.some(e => f.toLowerCase().endsWith(e))));

  const counts = Object.fromEntries(ORIGIN_KINDS.map(k => [k, records.filter(r => r.origin.kind === k).length]));
  const planned = records.filter(r => r.origin.kind === 'not-recorded' && r.readiness === 'planned').length;
  const producers = {};
  for (const r of records) if (r.origin.producer) producers[r.origin.producer] = (producers[r.origin.producer] ?? 0) + 1;
  const audio = records.filter(r => audioIds.has(r.id)).length, art = records.length - audio;
  const decisions = [
    ...components.filter(c => c.flags.length).map(c => ({kind: 'component', id: c.id, flags: c.flags})),
    ...(counts['not-recorded'] ? [{kind: 'assets', id: 'not-recorded', count: counts['not-recorded'], flags: ['No file records how these assets were made; supply provenance before relying on them.']}] : []),
    ...(counts['retired-tool'] ? [{kind: 'assets', id: 'retired-tool', count: counts['retired-tool'], flags: ['Made with a service that is no longer used. The licence terms of its output are not recorded in this project.']}] : []),
    ...(counts.unclassified ? [{kind: 'assets', id: 'unclassified', count: counts.unclassified, flags: ['A provenance file exists but does not name a generator, tool or service.']}] : []),
    ...(!thirdParty.present ? [] : [{kind: 'sources', id: thirdParty.file, flags: ['A third-party sources file exists; this ledger does not parse it. Review it by hand.']}]),
    ...(fonts.length ? [{kind: 'fonts', id: 'fonts', count: fonts.length, flags: ['Font files are present; their licences are not recorded.']}] : [])];
  return {schema: 'studio.ledger', version: 1, project: {id: pack.id, name: pack.name},
    assets: records.sort((a, b) => (a.source + a.id < b.source + b.id ? -1 : 1)), components, fonts: {scanned: scan.roots, files: fonts},
    thirdPartySources: thirdParty, summary: {total: records.length, art, audio, counts, planned, producers}, decisions};
}

/** What a store page could quote: counts by origin, plain facts, no verdict. `t` maps a key and values to text (see ledgerText). */
export function disclosure(ledger, lang = 'en') {
  const {counts, total, art, audio, producers} = ledger.summary;
  const L = ledgerText(lang);
  const agents = Object.entries(producers).sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} (${n})`).join('; ');
  const lines = [L.disclosureHead, L.total(total, art, audio)];
  for (const k of ORIGIN_KINDS) if (counts[k]) lines.push(k === 'not-recorded' ? L.kind[k](counts[k], ledger.summary.planned) : L.kind[k](counts[k]));
  if (agents) lines.push(L.producers(agents));
  lines.push(L.review);
  return {counts, total, text: lines.join('\n'), lines};
}

const TEXT = {
  en: {
    title: 'Licence and provenance ledger', disclosureHead: 'AI disclosure (counts from recorded provenance; wording is for a human to decide)',
    total: (n, a, u) => `The project catalogues ${n} assets: ${a} art and ${u} audio.`,
    kind: {
      generator: n => `${n} drawn by generator scripts (deterministic code with the project palette).`,
      'tool-render': n => `${n} rendered by an installed tool from a written effect spec.`,
      'forge-sheet': n => `${n} made from a sheet produced by an image tool and processed by the studio.`,
      'retired-tool': n => `${n} made with a generation service that is no longer used.`,
      'audio-engine': n => `${n} audio cues rendered by the studio's declarative synthesis engine.`,
      'audio-script': n => `${n} audio cues synthesised by project scripts.`,
      'third-party': n => `${n} from third-party sources.`,
      unclassified: n => `${n} have a provenance file that does not name how they were made.`,
      'not-recorded': (n, p) => `${n} have no recorded provenance${p ? ` (${p} of them are only planned: no frames or master yet)` : ''}.`
    },
    producers: names => `Recorded producers: ${names}.`,
    review: 'This list states what the project recorded. Whether any of it counts as "AI-generated" for a store or a law is a human decision.',
    assets: 'Assets', components: 'Tools and inputs', decisions: 'For a human to decide', fonts: 'Fonts', origin: 'Origin', evidence: 'Evidence', rights: 'Recorded rights', licence: 'Licence', pin: 'Pin',
    ships: 'Ships', usedBy: 'Assets using it', missing: 'Not recorded', none: 'none', asset: 'Asset', source: 'Source', category: 'Category', role: 'Role', tool: 'Tool', script: 'Script', seed: 'Seed',
    promptHash: 'Prompt SHA-256', document: 'Document', thirdParty: 'Third-party sources file', present: 'present', absent: 'absent', fontsNone: 'No font files found in', fontsSome: 'Font files found'
  },
  vi: {
    title: 'Sổ giấy phép và nguồn gốc', disclosureHead: 'Công bố AI (đếm từ nguồn gốc đã ghi; cách diễn đạt do con người quyết định)',
    total: (n, a, u) => `Dự án có ${n} asset trong danh mục: ${a} hình và ${u} âm thanh.`,
    kind: {
      generator: n => `${n} vẽ bằng script generator (mã tất định với bảng màu dự án).`,
      'tool-render': n => `${n} dựng bằng công cụ cài sẵn từ đặc tả hiệu ứng viết tay.`,
      'forge-sheet': n => `${n} làm từ sheet do công cụ ảnh tạo và studio xử lý.`,
      'retired-tool': n => `${n} làm bằng dịch vụ sinh ảnh không còn dùng.`,
      'audio-engine': n => `${n} cue âm thanh dựng bằng động cơ tổng hợp khai báo của studio.`,
      'audio-script': n => `${n} cue âm thanh tổng hợp bằng script của dự án.`,
      'third-party': n => `${n} đến từ nguồn bên thứ ba.`,
      unclassified: n => `${n} có file nguồn gốc nhưng không nói cách làm ra.`,
      'not-recorded': (n, p) => `${n} chưa có nguồn gốc nào được ghi${p ? ` (${p} trong số đó mới ở bước lên kế hoạch: chưa có frame hay master)` : ''}.`
    },
    producers: names => `Bên tạo đã ghi: ${names}.`,
    review: 'Danh sách này chỉ nêu những gì dự án đã ghi. Có coi là "do AI tạo" với cửa hàng hay luật hay không là quyết định của con người.',
    assets: 'Asset', components: 'Công cụ và đầu vào', decisions: 'Việc con người cần quyết định', fonts: 'Font', origin: 'Nguồn gốc', evidence: 'Bằng chứng', rights: 'Quyền đã ghi', licence: 'Giấy phép', pin: 'Phiên bản ghim',
    ships: 'Có đi kèm bản phát hành', usedBy: 'Asset dùng nó', missing: 'Chưa ghi', none: 'không có', asset: 'Asset', source: 'Nguồn', category: 'Loại', role: 'Vai trò', tool: 'Công cụ', script: 'Script', seed: 'Seed',
    promptHash: 'SHA-256 của prompt', document: 'Tài liệu', thirdParty: 'File nguồn bên thứ ba', present: 'có', absent: 'không có', fontsNone: 'Không thấy file font trong', fontsSome: 'Có file font'
  }
};
export const ledgerText = lang => TEXT[lang] ?? TEXT.en;

const cell = v => String(v ?? NOT_RECORDED).replaceAll('|', '\\|').replaceAll('\n', ' ');
const label = (obj, lang) => (obj && typeof obj === 'object' ? obj[lang] ?? obj.en : obj ?? '');

/** The ledger as Markdown, in English or Vietnamese. */
export function ledgerMarkdown(ledger, lang = 'en') {
  const L = ledgerText(lang), d = disclosure(ledger, lang);
  const out = [`# ${L.title}: ${ledger.project.name}`, '', `## ${L.disclosureHead.split(' (')[0]}`, '', ...d.lines.map(l => (l === d.lines[0] ? `_${l}_` : `- ${l}`)), ''];
  out.push(`## ${L.decisions}`, '');
  if (!ledger.decisions.length) out.push(`- ${L.none}`);
  for (const x of ledger.decisions) for (const f of x.flags) out.push(`- **${x.id}**${x.count ? ` (${x.count})` : ''}: ${f}`);
  out.push('', `## ${L.components}`, '', `| ${L.tool} | ${L.role} | ${L.licence} | ${L.pin} | ${L.ships} | ${L.usedBy} | ${L.evidence} |`, '|---|---|---|---|---|---|---|');
  for (const c of ledger.components) out.push(`| ${cell(c.name)} | ${cell(label(c.role, lang))} | ${cell(c.licence)} | ${cell(c.pin)} | ${cell(c.ships)} | ${c.usedBy} | ${cell(c.evidence.map(e => e.path).join(', ') || NOT_RECORDED)} |`);
  out.push('', `## ${L.fonts}`, '', ledger.fonts.files.length ? `${L.fontsSome}: ${ledger.fonts.files.join(', ')}` : `${L.fontsNone}: ${ledger.fonts.scanned.join(', ') || '-'}.`, '',
    `${L.thirdParty}: ${ledger.thirdPartySources.file ?? '-'} (${ledger.thirdPartySources.present ? L.present : L.absent}).`, '', `## ${L.assets}`, '',
    `| ${L.asset} | ${L.source} | ${L.category} | ${L.origin} | ${L.tool} | ${L.script} | ${L.seed} | ${L.promptHash} | ${L.document} | ${L.rights} | ${L.evidence} |`, '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const a of ledger.assets) {
    const o = a.origin, need = new Set(a.missing);
    const v = (name, value) => (value ?? null) === null ? (need.has(name) ? NOT_RECORDED : '') : cell(value);
    out.push(`| ${cell(a.id)} | ${cell(a.source)} | ${cell(a.category)} | ${o.kind === 'not-recorded' ? NOT_RECORDED : cell(o.kind)} | ${v('tool', o.tool)} | ${v('script', o.script)} | ${v('seed', o.seed)} | ${v('promptHash', o.promptHash)} | ${v('document', o.document)} | ${cell(a.rights ?? (a.recorded ? NOT_RECORDED : ''))} | ${cell(a.evidence.join(', ') || NOT_RECORDED)} |`);
  }
  return out.join('\n') + '\n';
}
