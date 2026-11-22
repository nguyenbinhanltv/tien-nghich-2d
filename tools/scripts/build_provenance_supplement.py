#!/usr/bin/env python
"""Derive assets/review/provenance_supplement.json from what the repository can prove.

The Studio ledger (studio/core/ledger.mjs) reads the per-asset provenance files. Many of them leave origin fields empty. This script
fills ONLY fields it can trace to a file or to git history, and records an explicit reason ("unknown" or "not applicable") for every
other field, so the Atlas tab can tell "checked, not known" from "never looked". It invents nothing and writes no rights.

Usage (from the checkout root):
  node studio/core/ledger-cli.mjs --base > <tmp>/ledger-base.json      # ledger without the supplement
  node studio/core/ledger-cli.mjs --index > <tmp>/index.json           # asset id -> manifest route
  python -I tools/scripts/build_provenance_supplement.py <tmp>/ledger-base.json <tmp>/index.json

Conventions: every script hash is sha256 of the file with CRLF turned into LF, read from git at the last commit that touched the
asset's source files (the commit that produced its current bytes). sourceHash is sha256 of the sorted lines "<sha256>  <relpath>"
(relpath relative to the asset's source folder) of that asset's source files, provenance.json excluded.
"""
import ast
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/review/provenance_supplement.json'
PALETTE_NOTE = 'tools/generators/palette.json'


def git(*args):
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, check=True).stdout


def sha(data):
    return hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()


def last_commit(paths):
    out = git('log', '-1', '--format=%H', '--', *paths).decode().strip()
    if not out:
        raise SystemExit(f'no commit touches {paths}')
    return out


def blob(commit, rel):
    try:
        return git('show', f'{commit}:{rel}')
    except subprocess.CalledProcessError:
        return None


def script_sha_at(commit, rel):
    data = blob(commit, rel)
    return None if data is None else sha(data)


def commit_info(commit):
    subject, body = git('log', '-1', '--format=%s%x00%b', commit).decode().split('\0')
    date = git('log', '-1', '--format=%ad', '--date=short', commit).decode().strip()
    agents = [m.group(1).strip() for m in re.finditer(r'^Co-authored-by:\s*([^<\n]+)', body, re.M) if re.search(r'claude|codex|openai|gemini|antigravity', m.group(1), re.I)]
    return {'short': commit[:8], 'subject': subject, 'date': date, 'agents': agents}


def producer_of(commit):
    c = commit_info(commit)
    who = ', '.join(c['agents']) or 'no agent trailer'
    return f"git commit {c['short']} ({c['date']}: {c['subject']}); agent trailers: {who}; the git author is the owner's identity and no session id is recorded"


def tree_hash(folder, files=None):
    base = ROOT / folder
    rels = sorted(files) if files is not None else sorted(str(p.relative_to(base)) for p in base.rglob('*') if p.is_file() and p.name != 'provenance.json' and p.name != '.DS_Store')
    lines = ''.join(f"{hashlib.sha256((base / r).read_bytes()).hexdigest()}  {r}\n" for r in rels)
    return hashlib.sha256(lines.encode()).hexdigest(), len(rels)


def uses_random(script):
    """True when the script imports a random module or calls numpy's generators. Strings and comments do not count."""
    tree = ast.parse((ROOT / script).read_text(encoding='utf-8-sig'))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import) and any(a.name.split('.')[0] == 'random' or a.name == 'numpy.random' for a in node.names):
            return True
        if isinstance(node, ast.ImportFrom) and (node.module or '').split('.')[0] == 'random':
            return True
        if isinstance(node, ast.Attribute) and node.attr in ('default_rng', 'RandomState', 'randint', 'shuffle') and 'random' in ast.unparse(node):
            return True
    return False


def agent_label(text):
    t = text or ''
    if re.search(r'claude', t, re.I):
        m = re.search(r'claude-[a-z0-9.-]+', t)
        w = re.search(r'tien-nghich-2d-\d+', t)
        return 'Claude Code' + (f' ({m.group(0)})' if m else '') + (f', worker session {w.group(0)}' if w else '')
    if re.search(r'codex', t, re.I):
        return 'OpenAI Codex'
    return None


NA = lambda why: {'status': 'not-applicable', 'reason': why}
UNK = lambda why: {'status': 'unknown', 'reason': why}

TOOL_NA = 'The asset is drawn by the generator script itself; no separate tool is involved.'
PIN_UNK = 'The versions of the Python interpreter and libraries that ran the generator are not recorded for this asset.'
PROMPT_NA = 'Not made from a prompt: the drawing is code.'


def main(ledger_path, index_path):
    ledger = json.loads(Path(ledger_path).read_text())
    index = json.loads(Path(index_path).read_text())
    docs_ok = lambda p: (ROOT / p).exists() or sys.exit(f'missing document {p}')
    entries = {}

    def add(group, asset_id, fields=None, unknown=None, na=None, basis=None, defaults=None, intent=None):
        e = entries.setdefault(group, {'id': group, 'basis': [], 'defaults': defaults or {}, 'assets': {}})
        e['basis'] = sorted(set(e['basis'] + (basis or [])))
        rec = {}
        if fields: rec['fields'] = {k: v for k, v in fields.items() if v is not None}
        reasons = {**(unknown or {}), **(na or {})}
        if reasons: rec['reasons'] = reasons
        if intent: rec['intent'] = intent
        e['assets'][asset_id] = rec

    for a in ledger['assets']:
        o, i, aid = a['origin'], index[a['id']], a['id']
        raw = i['layout']
        if raw is None and i['source'] == 'longtime-vfx':
            raw = f'assets/raw/longtime/{aid}'
        if raw and not (ROOT / raw).exists() and '/icons/' in raw:
            raw = raw.replace('/icons/', '/ui/')  # the manifest says icons/, the files live in ui/
        kind = o['kind']
        fields, reasons = {}, {}
        basis = []

        def need(f):
            return o.get(f) is None

        if kind == 'not-recorded':
            # planned audio, not produced: record only the INTENT the plan states, never a provenance
            plan = json.loads((ROOT / 'assets/audio_manifest.json').read_text())['extensions']
            wave = next(w for w, v in plan.items() if aid in v.get('bgm', []) + v.get('sfx', []))
            add('planned-audio', aid, intent={
                'en': f"Planned, not produced. The audio plan (extension wave '{wave}') reserves this cue; docs/AUDIO_DESIGN.md says the core plan uses original deterministic synthesis and scoring by project scripts. This is an intention, not a provenance record.",
                'vi': f"Dự kiến, chưa sản xuất. Kế hoạch âm thanh (đợt mở rộng '{wave}') dành chỗ cho cue này; docs/AUDIO_DESIGN.md nêu kế hoạch dùng tổng hợp và phối khí tất định, nguyên bản, bằng script của dự án. Đây là ý định, không phải bản ghi nguồn gốc.",
                'sources': ['assets/audio_manifest.json', 'docs/AUDIO_DESIGN.md']}, basis=['assets/audio_manifest.json', 'docs/AUDIO_DESIGN.md'])
            continue

        # ---------- audio scripts (46) ----------
        if kind == 'audio-script':
            ev = a['evidence'][0]
            prov = json.loads((ROOT / ev).read_text())
            m = next((m for m in prov.get('masters', []) if m.get('id') == aid), None)
            base = Path(ev).parent
            commit = last_commit([str(base)])
            basis += [ev]
            script = o['script']
            if script is None:
                # a single-cue provenance written before the batch format: render.py beside it
                script = f'{base}/render.py'
                fields['script'] = script
            elif '/' not in script:
                script = f'{base}/{script}'
                fields['script'] = script
            sh = script_sha_at(commit, script)
            if sh: fields['scriptSha256'] = sh
            else: reasons['scriptSha256'] = UNK(f'{script} is not in git at commit {commit[:8]}.')
            creator = prov.get('creator') or ''
            if need('producer'): fields['producer'] = creator
            lab = agent_label(creator)
            if lab: fields['agent'] = lab
            else: reasons['agent'] = UNK('The provenance names no agent.')
            text = json.dumps(prov)
            if isinstance(prov.get('rebuild'), dict):
                rb = prov['rebuild']
                if need('method'): fields['method'] = f"{rb['command']} ({rb['environment']}; {rb['prng']})"
                sd = re.search(r'instrument seed (\d+), room seed (\d+)', rb['prng'])
                if need('seed') and sd: fields['seed'] = f'instrument {sd.group(1)}, room {sd.group(2)} (NumPy PCG64)'
                if need('sourceHash') and isinstance(prov.get('master'), dict): fields['sourceHash'] = prov['master']['file_sha256']
            pyver = re.search(r'CPython ([\d.]+)', text) or re.search(r'"python": "([\d.]+)"', text)
            npver = re.search(r'NumPy ([\d.]+)', text)
            if pyver:
                fields['tool'] = 'CPython' + (' + NumPy' if npver else '')
                fields['toolPin'] = f"CPython {pyver.group(1)}" + (f", NumPy {npver.group(1)}" if npver else '')
            else:
                reasons['tool'] = UNK('The provenance names no interpreter version.')
            if m is None and need('sourceHash'):
                mw = prov.get('wav_sha256')
                if mw: fields['sourceHash'] = mw
            reasons['promptHash'] = NA('Not made from a prompt: synthesised by a script from a score and a patch.')
            fields['document'] = 'docs/AUDIO_DESIGN.md'
            docs_ok('docs/AUDIO_DESIGN.md')
            add('audio-script', aid, fields, None, reasons, basis + [script, 'docs/AUDIO_DESIGN.md'])
            continue

        # ---------- core generators ----------
        if kind == 'generator' and i['source'] == 'core':
            script = o['script']
            commit = last_commit([raw])
            basis += [script]
            fields['scriptSha256'] = o['scriptSha256'] or script_sha_at(commit, script)
            if script.endswith('gen_items_weapons.py'):
                doc = 'tools/generators/README_items_weapons.md'
                ps = {'prop_alchemy_jar': 41, 'prop_courtyard_pillar': 27, 'prop_restriction_pillar': 27, 'prop_petrified_chain': 19, 'prop_ancient_statue': 29}
                if aid in ps:
                    fields['seed'] = f"fixed constant {ps[aid]}: np.random.default_rng({ps[aid]}) in fragments(), used only for the broken, shatter or crumble states"
                else:
                    reasons['seed'] = NA('This drawing calls no random generator (only prop debris in fragments() does); it is deterministic.')
                fields['method'] = 'Procedural pixel drawing by gen_items_weapons.py with the project palette; checked by verify_items_weapons.py (README_items_weapons.md)'
            elif script.endswith('gen_tilesets.py'):
                doc = 'tools/generators/README.md'
                fields['seed'] = 'string-seeded: random.Random("<biome>/<sheet>/<variant>") per sheet (seeded() in gen_tilesets.py); no single integer seed'
                fields['method'] = 'Procedural autotile drawing by gen_tilesets.py with the project palette; the script checks by rendering twice'
            elif script.endswith('gen_ui_icons.py'):
                doc = 'tools/generators/README.md'
                fields['seed'] = 'derived per frame: first 8 bytes of sha256("tien-nghich-2d:v2:<id>:<w>x<h>:f<frame>") (_seed_for in gen_ui_icons.py)'
                fields['method'] = 'Procedural pixel drawing by gen_ui_icons.py with the project palette; checked by verify_ui_icons.py'
            elif script.endswith('gen_phase2_ui.py'):
                doc = 'tools/generators/phase2_ui_provenance.md'  # seed and method are already recorded in the asset's own provenance.json
            else:
                sys.exit(f'unhandled core generator {script}')
            docs_ok(doc)
            fields['document'] = doc
            if need('producer'): fields['producer'] = producer_of(commit)
            if need('agent') and i['assignedAgent']: fields['agent'] = i['assignedAgent']
            sh, n = tree_hash(raw)
            fields['sourceHash'] = sh
            reasons['tool'] = NA(TOOL_NA)
            reasons['toolPin'] = UNK(PIN_UNK)
            reasons['promptHash'] = NA(PROMPT_NA)
            add(f'core-generator:{Path(script).name}', aid, fields, None, reasons, basis + [doc, raw, f'git:{commit[:8]}'])
            continue

        # ---------- core VFX (12) ----------
        if kind == 'tool-render' and i['source'] == 'vfx':
            spec = o['script']
            spec_doc = json.loads((ROOT / spec).read_text())
            commit = last_commit([f'assets/processed/vfx/{aid}.json'])
            files = sorted([f'{aid}.json', f'{aid}_sheet.png'] + [p.name for p in (ROOT / 'assets/processed/vfx').glob(f'{aid}_*.png') if re.fullmatch(re.escape(aid) + r'_\d+\.png', p.name)])
            files = [f for f in files if (ROOT / 'assets/processed/vfx' / f).exists()]
            sh, n = tree_hash('assets/processed/vfx', files)
            fields = {'scriptSha256': script_sha_at(commit, spec), 'seed': spec_doc['seed'], 'sourceHash': sh,
                      'toolPin': 'e5867cc05f6e1dc6207b8e1c3c65cef75e6ba51a', 'producer': producer_of(commit),
                      'method': 'Deterministic JSON effect spec rendered by SpriteFX, exported by tools/generators/vfx_pipeline.py; palette-locked to the 40 colours; no AI image generation (docs/LESSONS_vfx_spritefx.md)',
                      'document': 'docs/LESSONS_vfx_spritefx.md'}
            docs_ok('docs/LESSONS_vfx_spritefx.md')
            trailers = commit_info(commit)['agents']
            if trailers: fields['agent'] = f"Claude Code ({', '.join(trailers)} per commit trailer)" if agent_label(' '.join(trailers)) == 'Claude Code' else agent_label(' '.join(trailers))
            else: reasons['agent'] = UNK('The commit has no agent trailer.')
            reasons['promptHash'] = NA('Not made from a prompt: rendered from a JSON spec.')
            add('core-vfx', aid, fields, None, reasons, [spec, 'docs/LESSONS_vfx_spritefx.md', 'docs/SKILLS_INSTALLED.md', 'tools/scripts/fetch_skills.sh', f'git:{commit[:8]}'])
            continue

        # ---------- Longtime VFX (6) ----------
        if kind == 'tool-render' and i['source'] == 'longtime-vfx':
            specs = sorted((ROOT / raw / 'specs').glob('*.json'))
            seeds = [json.loads(p.read_text())['seed'] for p in specs]
            fields = {'seed': seeds[0] if len(seeds) == 1 else ', '.join(f'{p.stem}: {s}' for p, s in zip(specs, seeds)),
                      'document': 'docs/LONGTIME_VFX.md'}
            docs_ok('docs/LONGTIME_VFX.md')
            lab = agent_label(o['producer'])
            if lab: fields['agent'] = lab
            reasons['promptHash'] = NA('Not made from a prompt: rendered from a JSON spec.')
            add('longtime-vfx', aid, fields, None, reasons, [f'{raw}/specs', 'docs/LONGTIME_VFX.md'])
            continue

        # ---------- Longtime generators (96) ----------
        if kind == 'generator' and i['source'] == 'longtime':
            script = o['script']
            fields['document'] = 'docs/LONGTIME_GDD.md'
            docs_ok('docs/LONGTIME_GDD.md')
            reasons['tool'] = NA(TOOL_NA)
            reasons['toolPin'] = UNK(PIN_UNK)
            reasons['promptHash'] = NA(PROMPT_NA)
            if uses_random(script):
                sys.exit(f'{script} uses a random generator; hand-write its seed rule before running again')
            reasons['seed'] = NA(f"{Path(script).name} imports no random module (checked by AST); the drawing is deterministic")
            lab = agent_label(o['producer'])
            if need('agent'):
                if i['assignedAgent']: fields['agent'] = i['assignedAgent'] + (f' (provenance producer: {o["producer"]})' if o['producer'] else '')
                else: reasons['agent'] = UNK('No agent named.')
            add('longtime-generator', aid, fields, None, reasons, [script, 'docs/LONGTIME_GDD.md', f'{raw}/provenance.json'])
            continue

        # ---------- retired tool: core PixelLab (22) and Longtime PixelLab (32) ----------
        if kind == 'retired-tool':
            if i['source'] == 'core':
                logname = {'player': 'pixellab_log.json', 'mob': 'pixellab_log_mobs.json', 'boss': 'pixellab_log_bosses.json'}[i['category']]
                logp = f'assets/raw/characters/{logname}'
                entry = next(e for e in json.loads((ROOT / logp).read_text())['entries'] if e['id'] == aid)
                meta = json.loads((ROOT / raw / 'metadata.json').read_text())
                prompt = meta['states'][0]['character']['prompt']
                commit = last_commit([raw])
                sh, n = tree_hash(raw)
                fields = {'seed': entry['seed'], 'promptHash': hashlib.sha256(prompt.encode()).hexdigest(), 'sourceHash': sh,
                          'producer': producer_of(commit), 'document': 'docs/LESSONS_processing.md',
                          'method': f"{entry['tool']}; params {json.dumps(entry['params'], sort_keys=True)}; promptHash is sha256 of the Idle state's character prompt in metadata.json"}
                docs_ok('docs/LESSONS_processing.md')
                reasons['toolPin'] = UNK('PixelLab is a hosted service; the log records the call modes (v3) but no service or model version.')
                reasons['scriptSha256'] = NA('No project script drew it: it is a service output (the later processing script only snaps palette and size).')
                reasons['script'] = NA('No project script drew it: it is a service output.')
                add('core-pixellab', aid, fields, None, reasons, [logp, f'{raw}/metadata.json', 'docs/LESSONS_processing.md', f'git:{commit[:8]}'])
            else:
                prov = json.loads((ROOT / raw / 'provenance.json').read_text())
                seed = re.search(r'seed (\d+)', prov['method'])
                fields = {'promptHash': hashlib.sha256(prov['prompt'].encode()).hexdigest(), 'document': 'docs/LONGTIME_GDD.md'}
                docs_ok('docs/LONGTIME_GDD.md')
                if seed: fields['seed'] = int(seed.group(1))
                else: reasons['seed'] = UNK('The provenance records no seed for this PixelLab call, and it cannot be recovered from the repository.')
                fields['agent'] = prov.get('operator') or agent_label(prov.get('creator'))
                reasons['toolPin'] = UNK('PixelLab is a hosted service; the provenance records character and job ids but no service or model version.')
                reasons['script'] = NA('No project script drew it: it is a service output.')
                reasons['scriptSha256'] = NA('No project script drew it: it is a service output.')
                add('longtime-pixellab', aid, fields, None, reasons, [f'{raw}/provenance.json', 'docs/LONGTIME_GDD.md'])
            continue

        sys.exit(f'unhandled: {aid} {kind} {i["source"]}')

    # drop empty fields None from phase2 ui special-case
    for e in entries.values():
        for rec in e['assets'].values():
            f = rec.get('fields', {})
            for k in [k for k, v in f.items() if v is None]: del f[k]
    doc = {'schema_version': 1,
           'description': ('Origin fields the repository can prove, plus an explicit reason for every field it cannot. The ledger (studio/core/ledger.mjs, pack key ui.tabs.atlas.ledger.provenanceSupplements) fills only fields '
                           'that the asset\'s own provenance leaves empty and never overrides one. `reasons` marks a field as checked and "unknown" or "not-applicable". Generated by tools/scripts/build_provenance_supplement.py; '
                           'it records no rights, approves no image and signs no audio.'),
           'conventions': {'scriptSha256': 'sha256 of the script with CRLF turned into LF, read from git at the last commit that touched the asset\'s source files',
                           'sourceHash': 'sha256 of the sorted lines "<sha256>  <relpath>" of the asset\'s source files (provenance.json excluded), relative to its source folder'},
           'entries': sorted(entries.values(), key=lambda e: e['id'])}
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'wrote {OUT.relative_to(ROOT)}: {sum(len(e["assets"]) for e in entries.values())} assets')


if __name__ == '__main__':
    main(*sys.argv[1:3])
