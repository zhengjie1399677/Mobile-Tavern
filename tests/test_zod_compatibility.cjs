const assert = require("assert");
const _ = require("lodash");

// 1. Shims for testing Zod in Node.js
const parentWin = {
  toastr: {
    info: console.log,
    warning: console.warn,
    success: console.info,
    error: console.error,
  }
};

// Paste Mock Zod factory function directly from tavernHelperBridge.ts
const createZodProxy = () => {
  const createSchema = (type, shapeOrDef) => {
    const schema = {
      _type: type,
      _shape: shapeOrDef,
      _defaultValue: undefined,
      _isOptional: false,
      _isNullable: false,
      
      default(val) {
        this._defaultValue = val;
        return this;
      },
      prefault(val) {
        this._defaultValue = val;
        return this;
      },
      optional() {
        this._isOptional = true;
        return this;
      },
      nullable() {
        this._isNullable = true;
        return this;
      },
      or(otherSchema) {
        return createSchema('union', [this, otherSchema]);
      },
      parse(val) {
        if (val === undefined || val === null) {
          if (this._defaultValue !== undefined) {
            val = typeof this._defaultValue === 'function' ? this._defaultValue() : _.cloneDeep(this._defaultValue);
          } else {
            if (this._type === 'object') {
              val = {};
            } else if (this._type === 'union') {
              // Do not intercept, let it flow to the union checking logic so sub-schemas can test undefined/null
            } else {
              if (this._isOptional || this._isNullable) return val;
              if (this._type === 'string' || this._type === 'coerce_string') return "";
              if (this._type === 'number' || this._type === 'coerce_number') return 0;
              if (this._type === 'boolean' || this._type === 'coerce_boolean') return false;
              if (this._type === 'array') return [];
              if (this._type === 'enum' && Array.isArray(this._shape) && this._shape.length > 0) {
                return this._shape[0];
              }
              if (this._type === 'record' || this._type === 'partialRecord' || this._type === 'map') return {};
              return undefined;
            }
          }
        }
        if (this._type === 'string') {
          if (typeof val !== 'string') throw new Error("Expected string");
          return val;
        }
        if (this._type === 'coerce_string') {
          return String(val);
        }
        if (this._type === 'number') {
          if (typeof val !== 'number') throw new Error("Expected number");
          return val;
        }
        if (this._type === 'coerce_number') {
          const num = Number(val);
          if (isNaN(num)) throw new Error("Expected number coercion");
          return num;
        }
        if (this._type === 'boolean') {
          if (typeof val !== 'boolean') throw new Error("Expected boolean");
          return val;
        }
        if (this._type === 'coerce_boolean') {
          if (val === 'true') return true;
          if (val === 'false') return false;
          return Boolean(val);
        }
        if (this._type === 'object') {
          if (!val || typeof val !== 'object') throw new Error("Expected object");
          const res = { ...val };
          if (this._shape) {
            for (const [key, subSchema] of Object.entries(this._shape)) {
              res[key] = subSchema.parse(val[key]);
            }
          }
          return res;
        }
        if (this._type === 'union' && this._shape) {
          const unionSchemas = Array.isArray(this._shape) ? this._shape : (this._shape.schemas || []);
          for (const sub of unionSchemas) {
            try {
              return sub.parse(val);
            } catch {}
          }
          throw new Error("Union did not match any schemas");
        }
        if (this._type === 'record' || this._type === 'partialRecord') {
          let keySchema = undefined;
          let valueSchema = undefined;
          if (Array.isArray(this._shape)) {
            if (this._shape.length === 2) {
              keySchema = this._shape[0];
              valueSchema = this._shape[1];
            } else if (this._shape.length === 1) {
              valueSchema = this._shape[0];
            }
          }
          if (valueSchema) {
            if (!val || typeof val !== 'object') throw new Error("Expected object for record");
            const res = {};
            for (const [key, item] of Object.entries(val)) {
              if (keySchema) {
                keySchema.parse(key);
              }
              res[key] = valueSchema.parse(item);
            }
            return res;
          }
          return val;
        }
        if (this._type === 'intersection' && Array.isArray(this._shape) && this._shape.length === 2) {
          const parsedA = this._shape[0].parse(val);
          const parsedB = this._shape[1].parse(val);
          if (parsedA && typeof parsedA === 'object' && parsedB && typeof parsedB === 'object') {
            return { ...parsedA, ...parsedB };
          }
          return parsedB !== undefined ? parsedB : parsedA;
        }
        if (this._type === 'literal') {
          if (val !== this._shape) throw new Error("Literal value mismatch");
          return val;
        }
        if (this._type === 'templateLiteral') {
          return val !== undefined ? String(val) : "";
        }
        if (this._type === 'custom') {
          if (typeof this._shape === 'function') {
            const ok = this._shape(val);
            if (!ok) throw new Error("Custom validation failed");
          }
          return val;
        }
        return val;
      },
      safeParse(val) {
        try {
          return { success: true, data: this.parse(val) };
        } catch (e) {
          return { success: false, error: e };
        }
      },
      catch(fallback) {
        const originalParse = this.parse.bind(this);
        this.parse = (val) => {
          try {
            return originalParse(val);
          } catch (e) {
            if (typeof fallback === 'function') {
              return fallback(e);
            }
            return fallback;
          }
        };
        return this;
      },
      transform(fn) {
        const originalParse = this.parse.bind(this);
        this.parse = (val) => {
          const parsed = originalParse(val);
          return fn(parsed);
        };
        return this;
      },
      element() { return this; },
      innerType() { return this; },
      shape: {},
      _def: {},
    };

    if (type === 'object' && shapeOrDef) {
      schema.shape = shapeOrDef;
    }
    
    let schemaProxy;
    schemaProxy = new Proxy(schema, {
      get(target, prop) {
        if (prop in target) {
          return target[prop];
        }
        if (typeof prop === 'string') {
          const mockFunc = function() {
            return schemaProxy;
          };
          mockFunc.prototype = {};
          return mockFunc;
        }
        return undefined;
      }
    });
    return schemaProxy;
  };

  const zodProxy = {
    object(shape) { return createSchema('object', shape); },
    union(schemas) { return createSchema('union', schemas); },
    enum(values) { return createSchema('enum', values); },
    string() { return createSchema('string'); },
    number() { return createSchema('number'); },
    boolean() { return createSchema('boolean'); },
    any() { return createSchema('any'); },
    unknown() { return createSchema('unknown'); },
    array(schema) { return createSchema('array', schema); },
    record(...args) { return createSchema('record', args); },
    partialRecord(...args) { return createSchema('partialRecord', args); },
    templateLiteral(args) { return createSchema('templateLiteral', args); },
    intersection(a, b) { return createSchema('intersection', [a, b]); },
    literal(val) { return createSchema('literal', val); },
    custom(fn) { return createSchema('custom', fn); },
    coerce: {
      number() { return createSchema('coerce_number'); },
      string() { return createSchema('coerce_string'); },
      boolean() { return createSchema('coerce_boolean'); },
    }
  };
  
  let proxyInstance;
  proxyInstance = new Proxy(zodProxy, {
    get(target, prop) {
      if (prop === 'z' || prop === 'default') {
        return proxyInstance;
      }
      if (prop in target) return target[prop];
      if (typeof prop === 'string') {
        const mockFunc = function(...args) {
          return createSchema(prop, args);
        };
        mockFunc.prototype = {};
        return mockFunc;
      }
      return undefined;
    }
  });
  return proxyInstance;
};

const z = createZodProxy();

console.log("=== Running Zod Mock Compatibility Unit Tests ===");

// Test 1: z.coerce.number().prefault(10)
const schema1 = z.coerce.number().prefault(10);
assert.strictEqual(schema1.parse(undefined), 10, "prefault returns default value");
assert.strictEqual(schema1.parse("25"), 25, "coerce string to number");
console.log("✔ Test 1: prefault and number coercion passed!");

// Test 2: z.record(z.enum(...), z.coerce.number().prefault(1))
const schema2 = z.record(
  z.enum(['上衣', '下衣', '内衣']),
  z.coerce.number().prefault(1)
);
const recordInput = { '上衣': '10', '下衣': 20, '内衣': undefined };
const recordParsed = schema2.parse(recordInput);
assert.deepStrictEqual(recordParsed, { '上衣': 10, '下衣': 20, '内衣': 1 }, "record values parsed and coerced correctly");
console.log("✔ Test 2: record schema parsing passed!");

// Test 3: union & chainable .or()
const schema3 = z.coerce.number().or(z.string());
assert.strictEqual(schema3.parse("hello"), "hello", "string parses in union");
assert.strictEqual(schema3.parse("42"), 42, "coerce number parses in union");
console.log("✔ Test 3: union and .or() chain passed!");

// Test 4: intersection
const schemaA = z.object({ foo: z.string().prefault("default-foo") });
const schemaB = z.object({ bar: z.coerce.number().prefault(42) });
const schemaIntersection = z.intersection(schemaA, schemaB);
const intersectParsed = schemaIntersection.parse({ foo: "custom-foo" });
assert.deepStrictEqual(intersectParsed, { foo: "custom-foo", bar: 42 }, "intersection merges schemas and applies defaults");
console.log("✔ Test 4: intersection schema passed!");

// Test 5: dynamic mock fallback with proxy
const customSchema = z.customFunc(123);
assert.strictEqual(customSchema._type, "customFunc", "Proxy fallback correctly generates unknown schema type");
assert.deepStrictEqual(customSchema._shape, [123], "Proxy fallback passes parameters correctly");
console.log("✔ Test 5: dynamic mock proxy passed!");

// Test 6: nested default value recursion (critical compatibility test)
const nestedSchema = z.object({
  个人信息: z.object({
    声望值: z.object({
      数值: z.coerce.number().prefault(0),
      描述: z.string().prefault('在扬州城内暂无特别名气。'),
    }).prefault({}),
    健康状态: z.object({
      状态: z.string().prefault('健康'),
      描述: z.string().prefault('气血充盈，精神饱满，无病无痛。'),
    }).prefault({}),
  }).prefault({}),
});
const parsedNested = nestedSchema.parse({});
assert.deepStrictEqual(parsedNested, {
  个人信息: {
    声望值: {
      数值: 0,
      描述: '在扬州城内暂无特别名气。',
    },
    健康状态: {
      状态: '健康',
      描述: '气血充盈，精神饱满，无病无痛。',
    }
  }
}, "nested default values are recursively populated");
console.log("✔ Test 6: nested default value recursion passed!");

console.log("\n🎉 ALL COMPATIBILITY TESTS PASSED!");
