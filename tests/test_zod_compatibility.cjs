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
    // 【修复 X2】识别 MVU 元组类型，抢先设置 _mvuTuple 标志和默认值
    const isTuple = type === "array" && (
      Array.isArray(shapeOrDef) &&
      shapeOrDef.length === 2 &&
      typeof shapeOrDef[1] === "string" &&
      shapeOrDef[1].length > 0
    );

    const schema = {
      _type: type,
      _shape: shapeOrDef,
      _defaultValue: isTuple ? shapeOrDef : undefined,
      _isMvuTuple: isTuple,
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
        return createSchema("union", [this, otherSchema]);
      },
      parse(val) {
        // 【修复 X2】MVU 元组类型特殊处理
        if (this._isMvuTuple) {
          const tupleDefault = this._shape; // [defaultVal, label]
          const label = tupleDefault[1];

          // 输入为 null/undefined → 返回初始默认值
          if (val === undefined || val === null) {
            return _.cloneDeep(tupleDefault);
          }
          // 输入已经是完整元组 [v, l] → 直接保留（优先使用已存值）
          if (
            Array.isArray(val) &&
            val.length === 2 &&
            typeof val[1] === "string"
          ) {
            return _.cloneDeep(val);
          }
          // 输入是原始值（数字/字符串/布尔）→ 包裹成 [val, label]
          if (
            typeof val === "number" ||
            typeof val === "string" ||
            typeof val === "boolean"
          ) {
            return [val, label];
          }
          // 输入是空对象（schema.parse({}) 时，字段在 input 中不存在） → 用默认值
          if (
            val &&
            typeof val === "object" &&
            !Array.isArray(val) &&
            Object.keys(val).length === 0
          ) {
            return _.cloneDeep(tupleDefault);
          }
          // 其他情况（非预期输入）→ 安全兜底返回默认元组
          return _.cloneDeep(tupleDefault);
        }

        if (val === undefined || val === null) {
          if (this._defaultValue !== undefined) {
            val = typeof this._defaultValue === 'function' ? this._defaultValue() : _.cloneDeep(this._defaultValue);
          } else {
            if ((val === undefined && this._isOptional) || (val === null && this._isNullable)) {
              return val;
            }
            const skipEarlyReturnTypes = ["optional", "nullable", "lazy", "preprocess", "tuple", "discriminatedUnion", "coerce_date", "union"];
            if (!skipEarlyReturnTypes.includes(this._type)) {
              if (this._type === 'object') {
                val = {};
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
        if (this._type === "object" || this._type === "looseObject") {
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
        if (this._type === "array" && !this._isMvuTuple) {
          if (val === undefined || val === null) {
            return this._defaultValue !== undefined
              ? (typeof this._defaultValue === "function" ? this._defaultValue() : _.cloneDeep(this._defaultValue))
              : [];
          }
          if (!Array.isArray(val)) throw new Error("Expected array");
          if (this._shape && typeof this._shape.parse === "function") {
            return val.map((item) => this._shape.parse(item));
          }
          return val;
        }
        if (this._type === "enum") {
          if (val === undefined || val === null) {
            if (this._defaultValue !== undefined) {
              return typeof this._defaultValue === "function" ? this._defaultValue() : _.cloneDeep(this._defaultValue);
            }
            return Array.isArray(this._shape) && this._shape.length > 0 ? this._shape[0] : val;
          }
          if (Array.isArray(this._shape)) {
            if (!this._shape.includes(val)) {
              throw new Error(`Expected one of ${this._shape.join(", ")}, got ${val}`);
            }
          }
          return val;
        }
        if (this._type === "lazy" && Array.isArray(this._shape) && typeof this._shape[0] === "function") {
          const actualSchema = this._shape[0]();
          return actualSchema.parse(val);
        }
        if (this._type === "tuple" && Array.isArray(this._shape) && Array.isArray(this._shape[0])) {
          const schemas = this._shape[0];
          if (val === undefined || val === null) {
            return schemas.map((s) => s.parse(undefined));
          }
          if (!Array.isArray(val)) throw new Error("Expected array for tuple");
          return schemas.map((s, idx) => s.parse(val[idx]));
        }
        if (this._type === "preprocess" && Array.isArray(this._shape) && this._shape.length === 2) {
          const preprocessFn = this._shape[0];
          const subSchema = this._shape[1];
          const preprocessedVal = typeof preprocessFn === "function" ? preprocessFn(val) : val;
          return subSchema.parse(preprocessedVal);
        }
        if (this._type === "optional" && Array.isArray(this._shape) && this._shape.length === 1) {
          const subSchema = this._shape[0];
          if (val === undefined) {
            if (subSchema._defaultValue !== undefined) {
              return subSchema.parse(val);
            }
            return undefined;
          }
          return subSchema.parse(val);
        }
        if (this._type === "nullable" && Array.isArray(this._shape) && this._shape.length === 1) {
          const subSchema = this._shape[0];
          if (val === null) return null;
          return subSchema.parse(val);
        }
        if (this._type === "discriminatedUnion" && Array.isArray(this._shape) && this._shape.length === 2) {
          const discriminator = this._shape[0];
          const unionSchemas = this._shape[1];
          if (val && typeof val === "object" && discriminator in val) {
            const discriminatorValue = val[discriminator];
            for (const sub of unionSchemas) {
              if (sub.shape && sub.shape[discriminator] && typeof sub.shape[discriminator].parse === "function") {
                try {
                  const check = sub.shape[discriminator].parse(discriminatorValue);
                  if (check === discriminatorValue) {
                    return sub.parse(val);
                  }
                } catch {}
              }
            }
          }
          if (Array.isArray(unionSchemas)) {
            for (const sub of unionSchemas) {
              try {
                return sub.parse(val);
              } catch {}
            }
          }
          throw new Error("Discriminated union did not match any schemas");
        }
        if (this._type === "coerce_date") {
          if (val === undefined || val === null) {
            if (this._defaultValue !== undefined) {
              return typeof this._defaultValue === "function" ? this._defaultValue() : _.cloneDeep(this._defaultValue);
            }
            return new Date(0);
          }
          const date = new Date(val);
          if (isNaN(date.getTime())) throw new Error("Expected date coercion");
          return date;
        }
        if (this._type.startsWith("coerce_")) {
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
          if (prop.startsWith("_")) {
            return undefined;
          }
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
    looseObject(shape) { return createSchema('looseObject', shape); },
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
    coerce: new Proxy({
      number() {
        return createSchema("coerce_number");
      },
      string() {
        return createSchema("coerce_string");
      },
      boolean() {
        return createSchema("coerce_boolean");
      },
      date() {
        return createSchema("coerce_date");
      }
    }, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return function() {
          return createSchema("coerce_" + prop);
        };
      }
    }),
  };
  
  let proxyInstance;
  proxyInstance = new Proxy(zodProxy, {
    get(target, prop) {
      if (prop === 'z' || prop === 'default') {
        return proxyInstance;
      }
      if (prop in target) return target[prop];
      if (typeof prop === 'string') {
        if (prop.startsWith("_")) {
          return undefined;
        }
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

// Test 7: Standard Array Parsing
const arraySchema = z.array(z.object({
  name: z.string().default("item-name"),
  val: z.coerce.number().default(1)
}));
assert.deepStrictEqual(arraySchema.parse([{}, { name: "custom" }]), [
  { name: "item-name", val: 1 },
  { name: "custom", val: 1 }
], "array schemas parse and default all sub-items");
console.log("✔ Test 7: standard array sub-item parsing passed!");

// Test 8: Enum Verification
const enumSchema = z.enum(["A", "B", "C"]).default("A");
assert.strictEqual(enumSchema.parse(undefined), "A", "enum schema fallback to default");
assert.strictEqual(enumSchema.parse("B"), "B", "enum schema parses valid value");
assert.throws(() => enumSchema.parse("D"), /Expected one of/, "enum schema throws on invalid value");
console.log("✔ Test 8: enum parsing and validation passed!");

// Test 9: Lazy Parsing (Recursion)
const lazySchema = z.lazy(() => z.object({
  value: z.string().default("lazy-default"),
  child: z.lazy(() => lazySchema).optional()
}));
assert.deepStrictEqual(lazySchema.parse({ child: {} }), {
  value: "lazy-default",
  child: {
    value: "lazy-default",
    child: undefined
  }
}, "lazy schemas parse recursively");
console.log("✔ Test 9: lazy schema recursion passed!");

// Test 10: Coerce Date & Proxy Fallback
const dateSchema = z.coerce.date().default(() => new Date(1000));
assert.deepStrictEqual(dateSchema.parse(undefined), new Date(1000), "coerce date defaults correctly");
assert.deepStrictEqual(dateSchema.parse(2000), new Date(2000), "coerce date coercing number passed");
// Proxy fallback for coerce (e.g. z.coerce.bigint)
const bigintSchema = z.coerce.bigint();
assert.strictEqual(bigintSchema._type, "coerce_bigint", "Proxy dynamic coerce method created correctly");
console.log("✔ Test 10: coerce date and proxy fallback passed!");

// Test 11: Preprocess Parsing
const preprocessSchema = z.preprocess((val) => val === "hello" ? "world" : val, z.string());
assert.strictEqual(preprocessSchema.parse("hello"), "world", "preprocess applies transform function");
assert.strictEqual(preprocessSchema.parse("test"), "test", "preprocess passes other values");
console.log("✔ Test 11: preprocess schema parsing passed!");

// Test 12: Standalone Wrapper functions
const optionalSchema = z.optional(z.string().default("opt"));
assert.strictEqual(optionalSchema.parse(undefined), "opt", "standalone optional default parses");
const nullableSchema = z.nullable(z.string().default("null-default"));
assert.strictEqual(nullableSchema.parse(null), null, "standalone nullable parses null");
console.log("✔ Test 12: standalone optional/nullable wrappers passed!");

// Test 13: Discriminated Union
const unionSchemaA = z.object({ type: z.literal("A"), valA: z.string().default("default-A") });
const unionSchemaB = z.object({ type: z.literal("B"), valB: z.coerce.number().default(100) });
const discUnion = z.discriminatedUnion("type", [unionSchemaA, unionSchemaB]);
assert.deepStrictEqual(discUnion.parse({ type: "A" }), { type: "A", valA: "default-A" }, "discriminated union parses schema A");
assert.deepStrictEqual(discUnion.parse({ type: "B" }), { type: "B", valB: 100 }, "discriminated union parses schema B");
console.log("✔ Test 13: discriminated union parsing passed!");

// Test 14: looseObject parsing
const looseSchema = z.looseObject({
  name: z.string().default("loose-name")
});
assert.deepStrictEqual(looseSchema.parse({}), { name: "loose-name" }, "looseObject parses shape and populates defaults");
console.log("✔ Test 14: looseObject parsing passed!");

console.log("\n🎉 ALL COMPATIBILITY TESTS PASSED!");
