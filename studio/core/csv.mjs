// A small CSV reader (RFC 4180 quoting) for spreadsheets exported from any tool. The delimiter is
// guessed from the header line (comma, semicolon or tab); a leading byte-order mark is dropped.
// Pure: no I/O. Written for this project; it takes only the published format.

const DELIMITERS = [',', ';', '\t'];

/** The delimiter that splits the first line into the most cells, ignoring delimiters inside quotes. */
export function guessDelimiter(text) {
  const first = text.split(/\r\n|\n|\r/, 1)[0] ?? '';
  let best = ',', bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0, quoted = false;
    for (const c of first) { if (c === '"') quoted = !quoted; else if (c === d && !quoted) count++; }
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

/**
 * Parse CSV text into {delimiter, headers, rows}. `rows` are arrays of strings padded or cut to the
 * header width, each with its 1-based `line` in the file. Blank lines are skipped. Throws an Error
 * with a readable message for an unterminated quote.
 */
export function parseCsv(input) {
  const text = String(input).replace(/^﻿/, '');
  const delimiter = guessDelimiter(text);
  const records = [];
  let cell = '', row = [], quoted = false, line = 1, startLine = 1, any = false;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => {
    endCell();
    if (row.length > 1 || row[0].trim() !== '') records.push({cells: row, line: startLine});
    row = []; any = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else { if (c === '\n') line++; cell += c; }
      continue;
    }
    if (c === '"' && cell === '') { quoted = true; any = true; continue; }
    if (c === delimiter) { endCell(); any = true; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow(); line++; startLine = line; continue;
    }
    cell += c; any = true;
  }
  if (quoted) throw new Error(`line ${startLine}: a quoted cell is never closed`);
  if (any || cell !== '' || row.length) endRow();
  if (!records.length) throw new Error('the file has no header line');
  const headers = records[0].cells.map(h => h.trim());
  if (headers.some(h => !h)) throw new Error('every column needs a header (the first line names the columns)');
  if (new Set(headers).size !== headers.length) throw new Error('two columns have the same header');
  const rows = records.slice(1).map(({cells, line: at}) => ({line: at, cells: headers.map((_, i) => (cells[i] ?? '').trim())}));
  return {delimiter, headers, rows};
}
