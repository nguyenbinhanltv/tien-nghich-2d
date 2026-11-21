// Minimal JSON Schema (2020-12 subset) validator for tool inputs. Zero dependencies.
// Supported: type, enum, const, required, properties, additionalProperties, items,
// minItems/maxItems, minLength/maxLength, pattern, minimum/maximum, anyOf/oneOf/allOf.
// Other keywords are ignored, except $ref/$defs which are rejected at registration time so
// a tool author never believes a reference is being enforced when it is not.

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);

function matchesType(v, t) {
  const actual = typeOf(v);
  return t === actual || (t === 'number' && actual === 'integer');
}

/** Throws if the schema uses a keyword this validator cannot enforce. */
export function assertSupportedSchema(schema, path = 'inputSchema') {
  if (typeof schema === 'boolean') return;
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new TypeError(`${path} must be a JSON Schema object`);
  }
  for (const bad of ['$ref', '$defs', 'definitions', 'not', 'if', 'patternProperties']) {
    if (Object.hasOwn(schema, bad)) throw new TypeError(`${path}: keyword "${bad}" is not supported by studio/mcp/schema.mjs`);
  }
  for (const [k, s] of Object.entries(schema.properties ?? {})) assertSupportedSchema(s, `${path}.properties.${k}`);
  if (schema.items !== undefined) assertSupportedSchema(schema.items, `${path}.items`);
  if (schema.additionalProperties !== undefined) assertSupportedSchema(schema.additionalProperties, `${path}.additionalProperties`);
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    (schema[key] ?? []).forEach((s, i) => assertSupportedSchema(s, `${path}.${key}[${i}]`));
  }
}

/** Returns a list of human-readable problems; empty means valid. */
export function validate(value, schema, path = '$') {
  if (schema === true || schema === undefined) return [];
  if (schema === false) return [`${path}: no value is allowed here`];
  const errs = [];
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      return [`${path}: expected ${types.join(' or ')}, got ${typeOf(value)}`];
    }
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errs.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (Object.hasOwn(schema, 'const') && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    errs.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) errs.push(`${path}: does not match /${schema.pattern}/`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path}: above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items !== undefined) value.forEach((v, i) => errs.push(...validate(v, schema.items, `${path}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errs.push(`${path}: missing required property "${key}"`);
    }
    const props = schema.properties ?? {};
    for (const [key, v] of Object.entries(value)) {
      if (Object.hasOwn(props, key)) errs.push(...validate(v, props[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: unexpected property "${key}"`);
      else if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) {
        errs.push(...validate(v, schema.additionalProperties, `${path}.${key}`));
      }
    }
  }
  if (schema.allOf) for (const s of schema.allOf) errs.push(...validate(value, s, path));
  if (schema.anyOf && !schema.anyOf.some((s) => validate(value, s, path).length === 0)) errs.push(`${path}: matches none of the anyOf alternatives`);
  if (schema.oneOf && schema.oneOf.filter((s) => validate(value, s, path).length === 0).length !== 1) errs.push(`${path}: must match exactly one of the oneOf alternatives`);
  return errs;
}
