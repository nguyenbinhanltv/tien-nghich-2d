// The handoff package and the AI disclosure drafts (D3). From the ledger (what the project recorded) and the art-bible stamps it builds a
// folder in STAGING (<library>/handoff/<id>/): one provenance file per asset, the ledger, and drafted disclosure text for Steam and
// itch.io built from the ledger's counts. It states facts and lists what a person must decide; it draws no legal conclusion; it never
// publishes or uploads anything (the owner does). A check blocks the package when an asset's recorded OUTPUT licence does not match the
// licence profile the project states in its pack (`ui.tabs.atlas.ledger.licenceProfile`).
//
//   licenceProfile: {statement: "text" | {en, vi}, accepts: ["licence names an asset's recorded rights may carry"], acceptsPattern?: ["regex"], strict?: bool}
//   An asset whose recorded rights match none of them BLOCKS the package. An asset with no recorded rights is flagged for a person to decide
//   (and blocks only when `strict`). Without a stated profile the check cannot run: nothing blocks, and the package says so.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readInside } from './files.mjs';
import { disclosure, ledgerMarkdown, NOT_RECORDED } from './ledger.mjs';
import { rulesReport } from './rules.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
/** Kinds made from an image tool's output (a person must decide how a store counts them); the rest are made by code or are not known. */
const IMAGE_TOOL = ['forge-sheet', 'retired-tool'];
const CODE_MADE = ['generator', 'tool-render', 'audio-engine', 'audio-script'];
const text = (v, lang) => (v && typeof v === 'object' ? v[lang] ?? v.en : v ?? null);

export const licenceProfile = pack => pack.ui?.tabs?.atlas?.ledger?.licenceProfile ?? null;

const matches = (profile, rights) => {
  const r = String(rights).trim().toLowerCase();
  if ((profile.accepts ?? []).some(a => String(a).trim().toLowerCase() === r)) return true;
  return (profile.acceptsPattern ?? []).some(p => { try { return new RegExp(p, 'i').test(rights); } catch { return false; } });
};

/** {profileStated, blockers: [{id, rights, why}], unrecorded: [ids], flags: [text]}: the licence check over the ledger. */
export function checkLicences(ledger, profile) {
  if (!profile) return {profileStated: false, blockers: [], unrecorded: [], flags: ['No licence profile is stated in the project pack (ui.tabs.atlas.ledger.licenceProfile), so recorded output licences could not be checked. A person must decide.']};
  const blockers = [], unrecorded = [];
  for (const a of ledger.assets) {
    if (a.rights) { if (!matches(profile, a.rights)) blockers.push({id: a.id, rights: a.rights, why: `its recorded output licence "${a.rights}" is not one the project's profile accepts`}); }
    else if (a.recorded) { unrecorded.push(a.id); if (profile.strict) blockers.push({id: a.id, rights: null, why: 'no output licence is recorded and the profile is strict'}); }
  }
  const flags = unrecorded.length && !profile.strict ? [`${unrecorded.length} asset(s) have provenance but no recorded output licence; a person must decide whether that is acceptable.`] : [];
  return {profileStated: true, blockers, unrecorded, flags};
}

const FACTS = {
  en: {
    steamTitle: 'Steam, AI content survey: DRAFT from the project ledger',
    itchTitle: 'itch.io, AI disclosure: DRAFT from the project ledger',
    pre: 'Pre-generated content (made while developing the game)',
    live: 'Live-generated content (made while the game runs)',
    liveText: 'The ledger records nothing about generation while the game runs. A person must state this; it is not in the records.',
    imageTool: n => `${n} asset(s) were made from output of an image-generation tool, then processed by the studio.`,
    code: n => `${n} asset(s) were made by code (generator scripts, a declarative audio engine or an installed effects tool).`,
    thirdParty: n => `${n} asset(s) come from third-party sources.`,
    unknown: n => `${n} asset(s) have no recorded provenance or a provenance record that does not say how they were made.`,
    total: n => `The ledger covers ${n} asset(s).`,
    fields: 'Fields to fill in (a person decides each)',
    field: (what, v) => `${what}: ${v}`,
    art: 'Art', audio: 'Audio', codeField: 'Code', textField: 'Text',
    artV: (n, t) => `${n} of ${t} art asset(s) involve an image-generation tool`,
    audioV: 'the ledger lists no audio made by an AI tool; check the audio records',
    notCovered: 'not covered by the ledger: a person must state it',
    decide: 'For a person to decide',
    notLegal: 'These are facts from the project\'s records. Whether any of it counts as "AI-generated" for a store, a licence or a law is a human decision; this draft makes no such judgement. The owner publishes; the studio never does.',
    stale: (v, s, u) => `Art-bible version ${v}: ${s} stamped asset(s) were made under an older version of the rules, ${u} were made before stamps existed.`,
    readmeTitle: 'Handoff package', readme: 'A staging folder built from the project ledger. Nothing here was published or uploaded. Review it, then publish by hand.',
  },
  vi: {
    steamTitle: 'Steam, khảo sát nội dung AI: BẢN NHÁP từ sổ dự án',
    itchTitle: 'itch.io, công bố AI: BẢN NHÁP từ sổ dự án',
    pre: 'Nội dung tạo trước (làm trong lúc phát triển game)',
    live: 'Nội dung tạo khi chạy (game sinh ra lúc đang chơi)',
    liveText: 'Sổ không ghi gì về việc sinh nội dung khi game chạy. Một người phải tự khẳng định điều này; nó không có trong hồ sơ.',
    imageTool: n => `${n} asset được làm từ kết quả của công cụ sinh ảnh, rồi studio xử lý.`,
    code: n => `${n} asset do mã tạo ra (script generator, động cơ âm thanh khai báo hoặc công cụ hiệu ứng cài sẵn).`,
    thirdParty: n => `${n} asset đến từ nguồn bên thứ ba.`,
    unknown: n => `${n} asset chưa có nguồn gốc được ghi hoặc hồ sơ không nói cách làm ra.`,
    total: n => `Sổ bao gồm ${n} asset.`,
    fields: 'Các ô cần điền (mỗi ô do một người quyết định)',
    field: (what, v) => `${what}: ${v}`,
    art: 'Hình', audio: 'Âm thanh', codeField: 'Mã', textField: 'Văn bản',
    artV: (n, t) => `${n} trên ${t} asset hình có dùng công cụ sinh ảnh`,
    audioV: 'sổ không liệt kê âm thanh nào do công cụ AI làm; hãy kiểm tra hồ sơ âm thanh',
    notCovered: 'sổ không bao gồm: một người phải tự khẳng định',
    decide: 'Việc con người cần quyết định',
    notLegal: 'Đây là các sự việc từ hồ sơ dự án. Có coi là "do AI tạo" với cửa hàng, giấy phép hay luật hay không là quyết định của con người; bản nháp này không đưa ra phán xét đó. Chủ dự án tự đăng; studio không bao giờ đăng.',
    stale: (v, s, u) => `Phiên bản art bible ${v}: ${s} asset đã đóng dấu được làm theo phiên bản quy tắc cũ, ${u} asset làm trước khi có dấu.`,
    readmeTitle: 'Gói bàn giao', readme: 'Thư mục staging dựng từ sổ dự án. Chưa có gì được đăng hay tải lên. Hãy xem lại rồi tự đăng.',
  },
};

/** Draft text for a store: 'steam' or 'itch', in 'en' or 'vi'. Counts come from the ledger; every claim is a recorded fact or a flag for a person. */
export function storeDisclosure(ledger, store, lang, {rules = null, licence = null} = {}) {
  const F = FACTS[lang] ?? FACTS.en;
  const c = ledger.summary.counts, n = k => c[k] ?? 0;
  const image = IMAGE_TOOL.reduce((t, k) => t + n(k), 0), code = CODE_MADE.reduce((t, k) => t + n(k), 0), unknown = n('unclassified') + n('not-recorded');
  const facts = [F.total(ledger.summary.total), ...(image ? [F.imageTool(image)] : []), ...(code ? [F.code(code)] : []), ...(n('third-party') ? [F.thirdParty(n('third-party'))] : []), ...(unknown ? [F.unknown(unknown)] : []), ...(rules ? [F.stale(rules.version, rules.stale, rules.unstamped)] : [])];
  const decisions = [...ledger.decisions.flatMap(d => d.flags.map(f => `${d.id}${d.count ? ` (${d.count})` : ''}: ${f}`)), ...(licence?.flags ?? [])];
  const out = [];
  if (store === 'steam') {
    out.push(`# ${F.steamTitle}`, '', `## ${F.pre}`, '', ...facts.map(f => `- ${f}`), '', `## ${F.live}`, '', `- ${F.liveText}`);
  } else {
    out.push(`# ${F.itchTitle}`, '', `## ${F.fields}`, '', `- ${F.field(F.art, image ? F.artV(image, ledger.summary.art) : '0')}`, `- ${F.field(F.audio, F.audioV)}`,
      `- ${F.field(F.codeField, F.notCovered)}`, `- ${F.field(F.textField, F.notCovered)}`, '', ...facts.map(f => `- ${f}`));
  }
  out.push('', `## ${F.decide}`, '', ...(decisions.length ? decisions.map(d => `- ${d}`) : ['- –']), '', `_${F.notLegal}_`, '');
  return out.join('\n');
}

/** The per-asset provenance file: the ledger's record, the hashes of its evidence files, how its output licence compares to the profile, its stamp. */
async function provenanceFile(root, record, profile, stamp) {
  const evidence = [];
  for (const rel of record.evidence) {
    const bytes = await readInside(root, rel).catch(() => null);
    evidence.push({path: rel, exists: bytes !== null, sha256: bytes ? sha(bytes) : null});
  }
  const verdict = !profile ? 'no-profile' : !record.rights ? NOT_RECORDED : matches(profile, record.rights) ? 'match' : 'mismatch';
  return {schema: 'studio.asset-provenance', version: 1, asset: {id: record.id, source: record.source, category: record.category, readiness: record.readiness},
    origin: record.origin, recorded: record.recorded, missing: record.missing, notes: record.notes, outputLicence: {recorded: record.rights, againstProfile: verdict}, evidence,
    rules: stamp ? {state: stamp.state, version: stamp.version} : null};
}

/**
 * Build the handoff. `write: false` only checks and drafts. A package is written ONLY when no recorded output licence mismatches the profile.
 * Returns {ok, blocked, check, files?, dir?, drafts, rules, counts}.
 */
export async function buildHandoff({root, pack, palette, index, ledger, base, lang = 'en', write = true}) {
  const profile = licenceProfile(pack);
  const licence = checkLicences(ledger, profile);
  const rules = await rulesReport({root, pack, palette, index});
  const drafts = {};
  for (const l of ['en', 'vi']) for (const store of ['steam', 'itch']) drafts[`${store}.${l}`] = storeDisclosure(ledger, store, l, {rules, licence});
  const summary = {assets: ledger.summary.total, counts: ledger.summary.counts, rules: {version: rules.version, current: rules.current, stale: rules.stale, unstamped: rules.unstamped}};
  const check = {...licence, statement: profile ? text(profile.statement, lang) : null};
  if (licence.blockers.length) return {ok: false, blocked: true, check, drafts, ...summary, message: `Blocked: ${licence.blockers.length} asset(s) have a recorded output licence the project's profile does not accept. Nothing was written.`};
  if (!write) return {ok: true, blocked: false, check, drafts, ...summary};

  const id = `handoff-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(2).toString('hex')}`;
  const dir = path.join(base, 'handoff', id);
  await fs.mkdir(path.join(dir, 'provenance'), {recursive: true});
  await fs.mkdir(path.join(dir, 'disclosure'), {recursive: true});
  const files = [];
  const put = async (rel, body) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n';
    await fs.writeFile(path.join(dir, rel), data, {flag: 'wx', mode: 0o644});
    files.push({path: rel, sha256: sha(data)});
  };
  const stampOf = new Map(rules.assets.map(a => [a.id, a]));
  for (const record of ledger.assets) await put(`provenance/${record.id}.provenance.json`, await provenanceFile(root, record, profile, stampOf.get(record.id)));
  for (const l of ['en', 'vi']) await put(`ledger.${l}.md`, ledgerMarkdown(ledger, l));
  for (const [name, body] of Object.entries(drafts)) await put(`disclosure/${name.replace('.', '.')}.md`, body);
  const F = FACTS[lang] ?? FACTS.en;
  await put('README.md', `# ${F.readmeTitle}: ${ledger.project.name}\n\n${F.readme}\n\n${F.notLegal}\n`);
  const manifest = {schema: 'studio.handoff', version: 1, id, createdAt: new Date().toISOString(), project: ledger.project, ...summary, licenceCheck: {profileStated: licence.profileStated, mismatches: 0, unrecorded: licence.unrecorded.length, flags: licence.flags},
    published: false, note: 'Staging only. Nothing was published or uploaded; the owner publishes.', files};
  await fs.writeFile(path.join(dir, 'HANDOFF.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx', mode: 0o644});
  return {ok: true, blocked: false, check, id, dir, files: files.length + 1, ...summary, drafts};
}
