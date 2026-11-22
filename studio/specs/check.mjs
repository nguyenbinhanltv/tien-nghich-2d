// Checks the behaviour specs against the tests (see README.md in this directory). Pure: it takes the
// text of the spec files and the test files and returns a list of problems; specs.test.mjs feeds it
// the real files.

const SPEC_LINE = /^- \*\*([A-Z]+-\d{3})\*\*(?: |$)/;
const LOOKS_LIKE_SPEC = /^- \*\*/;
const ID_TOKEN = /\b[A-Z]{2,12}-\d{3}\b/g;
const NAME_CALL = /\b(?:test|it|describe)(?:\.(?:skip|only|todo))?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** The names of every test(...), it(...) and describe(...) call in a file's source. */
export function testNames(source) {
  return [...source.matchAll(NAME_CALL)].map(m => m[2]);
}

/**
 * specs: {'review.md': text}; tests: {'studio/x/y.test.mjs': source}. Returns {problems: [string], ids: Map(id -> [test names])}.
 */
export function checkSpecs({specs, tests}) {
  const problems = [];
  const defined = new Map(); // id -> file
  const prefixes = new Set();
  for (const [file, text] of Object.entries(specs)) {
    if (file === 'README.md') continue;
    const prefix = file.replace(/\.md$/, '').toUpperCase();
    prefixes.add(prefix);
    text.split('\n').forEach((line, i) => {
      if (!LOOKS_LIKE_SPEC.test(line)) return;
      const m = SPEC_LINE.exec(line);
      if (!m) { problems.push(`${file}:${i + 1}: a behaviour line must start with "- **${prefix}-001** " (three digits)`); return; }
      const id = m[1];
      if (!id.startsWith(prefix + '-')) problems.push(`${file}:${i + 1}: ${id} does not belong in ${file} (ids there start with ${prefix}-)`);
      if (defined.has(id)) problems.push(`${file}:${i + 1}: ${id} is already defined in ${defined.get(id)}`);
      else defined.set(id, file);
    });
  }
  const used = new Map([...defined.keys()].map(id => [id, []]));
  for (const [file, source] of Object.entries(tests)) {
    for (const name of testNames(source)) {
      for (const token of name.match(ID_TOKEN) ?? []) {
        const prefix = token.slice(0, token.lastIndexOf('-'));
        if (defined.has(token)) used.get(token).push(`${file}: ${name}`);
        else if (prefixes.has(prefix)) problems.push(`${file}: the test "${name.slice(0, 70)}" names ${token}, which no spec defines`);
        else if (name.startsWith(token)) problems.push(`${file}: the test "${name.slice(0, 70)}" starts with ${token}, but there is no spec file named ${prefix.toLowerCase()}.md`);
      }
    }
  }
  for (const [id, names] of used) if (!names.length) problems.push(`${defined.get(id)}: ${id} has no test (put the id in a test name)`);
  return {problems, ids: used};
}
