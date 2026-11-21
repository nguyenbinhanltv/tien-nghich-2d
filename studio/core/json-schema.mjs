// Minimal JSON Schema checker (the subset the studio schemas use). No dependencies.
// Supported: type, const, enum, pattern, minimum, minLength, minItems, maxItems, minProperties,
// required, properties, additionalProperties (boolean or schema), items, anyOf, local $ref.

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(value, type) {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function resolve(root, ref) {
  if (!ref.startsWith('#/')) throw new Error('Unsupported $ref: ' + ref);
  let node = root;
  for (const part of ref.slice(2).split('/')) node = node?.[part];
  if (!node) throw new Error('Unresolved $ref: ' + ref);
  return node;
}

export function validateSchema(schema, value, root = schema, at = '$', issues = []) {
  if (schema.$ref) return validateSchema(resolve(root, schema.$ref), value, root, at, issues);
  if (schema.anyOf) {
    const ok = schema.anyOf.some(option => validateSchema(option, value, root, at, []).length === 0);
    if (!ok) issues.push(`${at}: matches none of the allowed forms`);
    return issues;
  }
  if ('const' in schema && !same(schema.const, value)) { issues.push(`${at}: must be ${JSON.stringify(schema.const)}`); return issues; }
  if (schema.enum && !schema.enum.some(item => same(item, value))) { issues.push(`${at}: must be one of ${schema.enum.map(v => JSON.stringify(v)).join(', ')}`); return issues; }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(type => typeMatches(value, type))) { issues.push(`${at}: expected ${types.join(' or ')}, got ${typeOf(value)}`); return issues; }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) issues.push(`${at}: must not be empty`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) issues.push(`${at}: does not match ${schema.pattern}`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) issues.push(`${at}: must be >= ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push(`${at}: needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push(`${at}: allows at most ${schema.maxItems} item(s)`);
    if (schema.items) value.forEach((item, i) => validateSchema(schema.items, item, root, `${at}[${i}]`, issues));
  }
  if (typeOf(value) === 'object') {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) issues.push(`${at}: needs at least ${schema.minProperties} entr(ies)`);
    for (const name of schema.required ?? []) if (!Object.hasOwn(value, name)) issues.push(`${at}: missing "${name}"`);
    const props = schema.properties ?? {};
    for (const key of keys) {
      const child = `${at}.${key}`;
      if (Object.hasOwn(props, key)) validateSchema(props[key], value[key], root, child, issues);
      else if (schema.additionalProperties === false) issues.push(`${child}: unknown field`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
        validateSchema(schema.additionalProperties, value[key], root, child, issues);
    }
  }
  return issues;
}
