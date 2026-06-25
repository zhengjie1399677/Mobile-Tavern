/**
 * zodMock.ts — Zod Schema 校验框架的 Proxy Mock
 *
 * 职责：
 * 为 iframe 沙盒内运行的 mvu_zod.js 提供完整的 z.object().string().default() 等
 * 链式 Zod API Mock，支持 .parse() / .safeParse() / .optional() / .nullable() /
 * .union() / .record() / .intersection() / .literal() / .transform() / .catch() 等操作。
 *
 * 设计原则：
 * - 完全无副作用：仅在调用 createZodProxy() 时返回新 Proxy 实例
 * - 深拷贝兜底：parse 时对默认值做 lodashCloneDeep，防止多会话共享引用污染
 * - prettifyError：将 Zod 校验错误格式化为可读字符串，供 mvu_zod.js 的错误展示使用
 */

import lodashCloneDeep from "lodash/cloneDeep";

/**
 * 创建 Zod Mock Proxy，模拟 Zod 库的完整链式调用 API。
 * 供 mvu_zod.js 在 iframe 沙盒中调用 window.z.object({...}).string().default("value").parse(data)
 */
export function createZodProxy(): any {
  const createSchema = (type: string, shapeOrDef?: any): any => {
    const schema: any = {
      _type: type,
      _shape: shapeOrDef,
      _defaultValue: undefined,
      _isOptional: false,
      _isNullable: false,

      default(val: any) {
        this._defaultValue = val;
        return this;
      },
      prefault(val: any) {
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
      or(otherSchema: any) {
        return createSchema('union', [this, otherSchema]);
      },
      parse(val: any) {
        if (val === undefined || val === null) {
          if (this._defaultValue !== undefined) {
            val = typeof this._defaultValue === 'function' ? this._defaultValue() : lodashCloneDeep(this._defaultValue);
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
          const res: any = { ...val };
          if (this._shape) {
            for (const [key, subSchema] of Object.entries(this._shape)) {
              res[key] = (subSchema as any).parse(val[key]);
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
          let keySchema: any = undefined;
          let valueSchema: any = undefined;
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
            const res: any = {};
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
      safeParse(val: any) {
        try {
          return { success: true, data: this.parse(val) };
        } catch (e) {
          return { success: false, error: e };
        }
      },
      catch(fallback: any) {
        const originalParse = this.parse.bind(this);
        this.parse = (val: any) => {
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
      transform(fn: any) {
        const originalParse = this.parse.bind(this);
        this.parse = (val: any) => {
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

    let schemaProxy: any;
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

  const zodProxy: any = {
    object(shape: any) { return createSchema('object', shape); },
    union(schemas: any) { return createSchema('union', schemas); },
    enum(values: any) { return createSchema('enum', values); },
    string() { return createSchema('string'); },
    number() { return createSchema('number'); },
    boolean() { return createSchema('boolean'); },
    any() { return createSchema('any'); },
    unknown() { return createSchema('unknown'); },
    array(schema: any) { return createSchema('array', schema); },
    record(...args: any[]) { return createSchema('record', args); },
    partialRecord(...args: any[]) { return createSchema('partialRecord', args); },
    templateLiteral(args: any) { return createSchema('templateLiteral', args); },
    intersection(a: any, b: any) { return createSchema('intersection', [a, b]); },
    literal(val: any) { return createSchema('literal', val); },
    custom(fn: any) { return createSchema('custom', fn); },
    coerce: {
      number() { return createSchema('coerce_number'); },
      string() { return createSchema('coerce_string'); },
      boolean() { return createSchema('coerce_boolean'); },
    },
    // prettifyError: Format Zod validation errors into human-readable strings.
    // Critical for mvu_zod.js which calls n.z.prettifyError(error) for error display.
    prettifyError(error: any) {
      if (!error) return 'Unknown validation error';
      if (error.issues && Array.isArray(error.issues)) {
        return error.issues.map((issue: any) => {
          const path = issue.path?.length ? ` at ${issue.path.join('.')}` : '';
          return `✖ ${issue.message}${path}`;
        }).join('\n');
      }
      if (error.message) return error.message;
      return String(error);
    },
  };

  let proxyInstance: any;
  proxyInstance = new Proxy(zodProxy, {
    get(target, prop) {
      if (prop === 'z' || prop === 'default') {
        return proxyInstance;
      }
      if (prop in target) return target[prop];
      if (typeof prop === 'string') {
        const mockFunc = function(...args: any[]) {
          return createSchema(prop, args);
        };
        mockFunc.prototype = {};
        return mockFunc;
      }
      return undefined;
    }
  });
  return proxyInstance;
}
