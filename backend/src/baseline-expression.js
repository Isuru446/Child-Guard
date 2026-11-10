// Narrow parser for the approved baseline CHECK/predicate expressions, not SQL
// execution. Preserve boolean grouping; reject all unsupported syntax.
export function expressionTree(text) {
  if (typeof text !== 'string') throw Error('Expression refused');
  const tokens = [];
  const re = /\s+|'(?:''|[^'])*'|"(?:""|[^"])*"|::|>=|<=|<>|[(),\[\]+~=<>&*-]|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z_0-9]*/gy;
  let pos = 0;
  while (pos < text.length) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) throw Error('Expression refused');
    pos = re.lastIndex;
    if (!/^\s+$/.test(m[0])) tokens.push(m[0]);
  }
  let i = 0;
  const peek = x => tokens[i]?.toUpperCase() === x;
  const eat = x => { if (!peek(x)) throw Error('Expression refused'); i++; };
  const combine = (op, a, b) => [op, ...(a[0] === op ? a.slice(1) : [a]), ...(b[0] === op ? b.slice(1) : [b])];
  function primary() {
    let a;
    const t = tokens[i++];
    if (t === '(') { a = or(); eat(')'); }
    else if (t === '-') { const n = primary(); if (n[0] !== 'number') throw Error('Expression refused'); a = ['number', -n[1]]; }
    else if (t?.startsWith("'")) a = ['string', t.slice(1, -1).replaceAll("''", "'")];
    else if (/^\d/.test(t ?? '')) a = ['number', Number(t)];
    else if (t?.toUpperCase() === 'ARRAY') {
      eat('['); const values = [];
      do { values.push(primary()); if (!peek(',')) break; i++; } while (true);
      eat(']'); a = ['array', ...values];
    } else if (/^(?:"[^"\r\n]+"|[A-Za-z_][A-Za-z_0-9]*)$/.test(t ?? '')) {
      const name = t.startsWith('"') ? t.slice(1, -1) : t.toLowerCase();
      if (peek('(')) {
        if (name !== 'lower') throw Error('Expression refused');
        i++; a = ['lower', or()]; eat(')');
      } else a = ['column', name];
    } else throw Error('Expression refused');
    while (peek('::')) {
      i++; let type = tokens[i++];
      if (type === 'double') { eat('PRECISION'); type = 'double precision'; }
      if (peek('[')) { i++; eat(']'); type += '[]'; }
      if (!['text', 'integer', 'bigint', 'numeric', 'double precision', '"Role"', '"AttendanceStatus"',
        '"ReviewStatus"', 'text[]', '"Role"[]', '"AttendanceStatus"[]', '"ReviewStatus"[]'].includes(type)) throw Error('Expression refused');
      // PostgreSQL deparses numeric constants as explicitly typed strings.
      if (['integer', 'bigint', 'numeric', 'double precision'].includes(type)) {
        if (!['number', 'string'].includes(a[0]) || !/^-?\d+(?:\.\d+)?$/.test(String(a[1]))) throw Error('Expression refused');
        a = ['number', Number(a[1])];
      } else if (!(a[0] === 'string' || a[0] === 'array' || (type === 'text' && a[0] === 'column'))) throw Error('Expression refused');
    }
    return a;
  }
  function additive() {
    let a = primary();
    while (peek('+') || peek('-')) { const op = tokens[i++]; a = [op, a, primary()]; }
    return a;
  }
  function comparison() {
    const a = additive();
    if (peek('IS')) { i++; const not = peek('NOT'); if (not) i++; eat('NULL'); return [not ? 'notnull' : 'isnull', a]; }
    if (peek('BETWEEN')) {
      i++; const low = additive(); eat('AND'); const high = additive();
      return combine('and', ['>=', a, low], ['<=', a, high]);
    }
    if (peek('IN')) {
      i++; eat('('); const values = [];
      do { values.push(primary()); if (!peek(',')) break; i++; } while (true);
      eat(')'); return ['in', a, ...values];
    }
    if (['=', '>=', '<=', '>', '<', '~', '<>'].includes(tokens[i])) {
      const op = tokens[i++];
      if (op === '=' && peek('ANY')) {
        i++; eat('('); const array = primary(); eat(')');
        if (array[0] !== 'array') throw Error('Expression refused');
        return ['in', a, ...array.slice(1)];
      }
      return [op, a, additive()];
    }
    return a;
  }
  function and() { let a = comparison(); while (peek('AND')) { i++; a = combine('and', a, comparison()); } return a; }
  function or() { let a = and(); while (peek('OR')) { i++; a = combine('or', a, and()); } return a; }
  const result = or();
  if (i !== tokens.length) throw Error('Expression refused');
  return result;
}
