import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, guessDelimiter } from '../csv.mjs';

test('quotes, doubled quotes, embedded newlines, CRLF, BOM and blank lines', () => {
  const r = parseCsv('﻿id,brief,note\r\nlt_a,"say ""hi"", ok","two\nlines"\r\n\r\nlt_b,plain,\r\n');
  assert.deepEqual(r.headers, ['id', 'brief', 'note']);
  assert.deepEqual(r.rows.map(x => x.cells), [['lt_a', 'say "hi", ok', 'two\nlines'], ['lt_b', 'plain', '']]);
  assert.deepEqual(r.rows.map(x => x.line), [2, 5]);
});

test('the delimiter is guessed from the header; short rows are padded, long rows cut', () => {
  assert.equal(guessDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(guessDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(guessDelimiter('"a;b",c\n1,2'), ',');
  const r = parseCsv('a;b\n1\n1;2;3');
  assert.deepEqual(r.rows.map(x => x.cells), [['1', ''], ['1', '2']]);
});

test('an unclosed quote, a missing header and repeated headers are refused with a reason', () => {
  assert.throws(() => parseCsv('a,b\n"x,1'), /never closed/);
  assert.throws(() => parseCsv(''), /no header/);
  assert.throws(() => parseCsv('a,,c\n1,2,3'), /needs a header/);
  assert.throws(() => parseCsv('a,a\n1,2'), /same header/);
});
