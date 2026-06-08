const createZodProxy = () => {
  const createSchema = (type, shapeOrDef) => {
    const schema = {
      _type: type,
      parse(val) { return val; },
      safeParse(val) { return { success: true, data: val }; }
    };
    let schemaProxy;
    schemaProxy = new Proxy(schema, {
      get(target, prop) {
        if (prop in target) return target[prop];
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
    string() { return createSchema('string'); }
  };

  let proxyInstance;
  proxyInstance = new Proxy(zodProxy, {
    get(target, prop) {
      if (prop === 'z' || prop === 'default') {
        return proxyInstance;
      }
      if (prop in target) return target[prop];
      if (typeof prop === 'string') {
        const mockFunc = function() {
          return createSchema('any');
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
const n = z;

console.log('n is proxy:', n !== undefined);
console.log('n.z is proxy:', n.z === n);
console.log('n.z.ZodObject is function:', typeof n.z.ZodObject === 'function');
console.log('n.z.ZodObject prototype:', n.z.ZodObject.prototype);

try {
  const t = {};
  console.log('instanceof check:', t instanceof n.z.ZodObject);
} catch (e) {
  console.error('instanceof failed:', e);
}
