/**
 * Minimal JSON Schema (draft-07 subset) validator.
 *
 * Supports the keywords actually used by GasGuard's own schema files:
 * type, properties, required, additionalProperties, items, enum, pattern,
 * minLength. No external dependency is pulled in for this - the subset
 * covers every construct our schemas need.
 */

export interface JSONSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  properties?: Record<string, JSONSchema>;
  additionalProperties?: boolean;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  [key: string]: unknown;
}

export interface SchemaValidationError {
  path: string;
  message: string;
  code: string;
}

/**
 * Validate `data` against `schema`, returning every violation found.
 * An empty array means `data` conforms to the schema.
 */
export function validateAgainstSchema(
  data: unknown,
  schema: JSONSchema,
  rootPath = '(root)',
): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];
  validateNode(data, schema, rootPath, errors);
  return errors;
}

function validateNode(
  data: unknown,
  schema: JSONSchema,
  path: string,
  errors: SchemaValidationError[],
): void {
  if (schema.type && !matchesType(data, schema.type)) {
    errors.push({
      path,
      message: `Expected type "${schema.type}" but got "${describeType(data)}"`,
      code: 'TYPE_MISMATCH',
    });
    return;
  }

  if (schema.enum && !schema.enum.some((allowed) => allowed === data)) {
    errors.push({
      path,
      message: `Value must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}; got ${JSON.stringify(data)}`,
      code: 'ENUM_MISMATCH',
    });
  }

  if (typeof data === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
      errors.push({
        path,
        message: `Value "${data}" does not match pattern ${schema.pattern}`,
        code: 'PATTERN_MISMATCH',
      });
    }
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({
        path,
        message: `Value must be at least ${schema.minLength} character(s) long`,
        code: 'MIN_LENGTH',
      });
    }
  }

  if (schema.type === 'object' && isPlainObject(data)) {
    for (const key of schema.required ?? []) {
      if (!(key in data) || data[key] === undefined) {
        errors.push({
          path: joinPath(path, key),
          message: `"${key}" is required`,
          code: 'REQUIRED',
        });
      }
    }

    if (schema.properties) {
      for (const [key, value] of Object.entries(data)) {
        const propSchema = schema.properties[key];
        if (propSchema) {
          validateNode(value, propSchema, joinPath(path, key), errors);
        } else if (schema.additionalProperties === false) {
          errors.push({
            path: joinPath(path, key),
            message: `Unknown property "${key}" is not allowed`,
            code: 'ADDITIONAL_PROPERTY',
          });
        }
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(data) && schema.items) {
    const itemSchema = schema.items;
    data.forEach((item, idx) => {
      validateNode(item, itemSchema, `${path}[${idx}]`, errors);
    });
  }
}

function matchesType(data: unknown, type: NonNullable<JSONSchema['type']>): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(data);
    case 'array':
      return Array.isArray(data);
    case 'string':
      return typeof data === 'string';
    case 'number':
      return typeof data === 'number' && !Number.isNaN(data);
    case 'integer':
      return typeof data === 'number' && Number.isInteger(data);
    case 'boolean':
      return typeof data === 'boolean';
    default:
      return true;
  }
}

function isPlainObject(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data);
}

function describeType(data: unknown): string {
  if (data === null) return 'null';
  if (Array.isArray(data)) return 'array';
  return typeof data;
}

function joinPath(base: string, key: string): string {
  return base === '(root)' ? key : `${base}.${key}`;
}
