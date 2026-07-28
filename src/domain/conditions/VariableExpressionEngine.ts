export type ConditionValue = string | number | boolean | null | undefined;

export interface VariableConditionContext {
  variables?: Record<string, unknown>;
  session?: Record<string, unknown>;
}

type TokenKind =
  | "reference"
  | "number"
  | "string"
  | "boolean"
  | "null"
  | "operator"
  | "leftParen"
  | "rightParen"
  | "eof";

interface Token {
  kind: TokenKind;
  value?: string | number | boolean | null;
}

type Node =
  | { type: "literal"; value: ConditionValue }
  | { type: "reference"; path: string }
  | { type: "unary"; operator: "!"; operand: Node }
  | { type: "binary"; operator: string; left: Node; right: Node };

const MAX_EXPRESSION_LENGTH = 512;
const MAX_TOKENS = 128;
const REFERENCE_PATTERN = /^\{(var|session)::([A-Za-z0-9_.\-\u4e00-\u9fff]+)\}/;
const NUMBER_PATTERN = /^-?(?:\d+(?:\.\d+)?|\.\d+)/;

/** 无动态代码执行的条件表达式引擎，供世界书等数据驱动规则复用。 */
export function evaluateVariableCondition(
  expression: string | undefined,
  context: VariableConditionContext,
): boolean {
  if (!expression?.trim()) return true;
  if (expression.length > MAX_EXPRESSION_LENGTH) return false;
  try {
    const parser = new Parser(tokenize(expression));
    return Boolean(evaluate(parser.parse(), context));
  } catch {
    return false;
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let rest = source.trimStart();
  while (rest.length > 0) {
    if (tokens.length >= MAX_TOKENS) throw new Error("CONDITION_TOO_COMPLEX");
    const reference = rest.match(REFERENCE_PATTERN);
    if (reference) {
      tokens.push({ kind: "reference", value: `${reference[1]}::${reference[2]}` });
      rest = rest.slice(reference[0].length).trimStart();
      continue;
    }
    const operator = rest.match(/^(&&|\|\||===|!==|==|!=|>=|<=|>|<|!)/);
    if (operator) {
      tokens.push({ kind: "operator", value: operator[1] });
      rest = rest.slice(operator[0].length).trimStart();
      continue;
    }
    if (rest[0] === "(" || rest[0] === ")") {
      tokens.push({ kind: rest[0] === "(" ? "leftParen" : "rightParen" });
      rest = rest.slice(1).trimStart();
      continue;
    }
    const quoted = readQuotedString(rest);
    if (quoted) {
      tokens.push({ kind: "string", value: quoted.value });
      rest = rest.slice(quoted.length).trimStart();
      continue;
    }
    const number = rest.match(NUMBER_PATTERN);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      rest = rest.slice(number[0].length).trimStart();
      continue;
    }
    const keyword = rest.match(/^(true|false|null)\b/i);
    if (keyword) {
      const value = keyword[1].toLowerCase();
      tokens.push(value === "null"
        ? { kind: "null", value: null }
        : { kind: "boolean", value: value === "true" });
      rest = rest.slice(keyword[0].length).trimStart();
      continue;
    }
    throw new Error("CONDITION_INVALID_TOKEN");
  }
  tokens.push({ kind: "eof" });
  return tokens;
}

function readQuotedString(source: string): { value: string; length: number } | undefined {
  const quote = source[0];
  if (quote !== '"' && quote !== "'") return undefined;
  let value = "";
  for (let index = 1; index < source.length; index++) {
    const character = source[index];
    if (character === quote) return { value, length: index + 1 };
    if (character === "\\") {
      const next = source[++index];
      if (next === undefined) throw new Error("CONDITION_UNTERMINATED_STRING");
      value += next === "n" ? "\n" : next === "t" ? "\t" : next;
    } else {
      value += character;
    }
  }
  throw new Error("CONDITION_UNTERMINATED_STRING");
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.parseOr();
    if (this.peek().kind !== "eof") throw new Error("CONDITION_TRAILING_TOKEN");
    return node;
  }

  private parseOr(): Node {
    let node = this.parseAnd();
    while (this.matchOperator("||")) node = { type: "binary", operator: "||", left: node, right: this.parseAnd() };
    return node;
  }

  private parseAnd(): Node {
    let node = this.parseComparison();
    while (this.matchOperator("&&")) node = { type: "binary", operator: "&&", left: node, right: this.parseComparison() };
    return node;
  }

  private parseComparison(): Node {
    let node = this.parseUnary();
    const token = this.peek();
    if (token.kind === "operator" && ["==", "===", "!=", "!==", ">", ">=", "<", "<="].includes(String(token.value))) {
      this.index++;
      node = { type: "binary", operator: String(token.value), left: node, right: this.parseUnary() };
    }
    return node;
  }

  private parseUnary(): Node {
    if (this.matchOperator("!")) return { type: "unary", operator: "!", operand: this.parseUnary() };
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const token = this.tokens[this.index++];
    if (token.kind === "reference") return { type: "reference", path: String(token.value) };
    if (["number", "string", "boolean", "null"].includes(token.kind)) return { type: "literal", value: token.value };
    if (token.kind === "leftParen") {
      const node = this.parseOr();
      if (this.tokens[this.index++].kind !== "rightParen") throw new Error("CONDITION_EXPECTED_PAREN");
      return node;
    }
    throw new Error("CONDITION_EXPECTED_VALUE");
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private matchOperator(value: string): boolean {
    const token = this.peek();
    if (token.kind !== "operator" || token.value !== value) return false;
    this.index++;
    return true;
  }
}

function evaluate(node: Node, context: VariableConditionContext): ConditionValue {
  if (node.type === "literal") return node.value;
  if (node.type === "reference") return resolveReference(node.path, context);
  if (node.type === "unary") return !Boolean(evaluate(node.operand, context));
  if (node.operator === "&&") return Boolean(evaluate(node.left, context)) && Boolean(evaluate(node.right, context));
  if (node.operator === "||") return Boolean(evaluate(node.left, context)) || Boolean(evaluate(node.right, context));
  const left = evaluate(node.left, context);
  const right = evaluate(node.right, context);
  switch (node.operator) {
    case "==":
    case "===": return left === right;
    case "!=":
    case "!==": return left !== right;
    case ">": return compare(left, right, (a, b) => a > b);
    case ">=": return compare(left, right, (a, b) => a >= b);
    case "<": return compare(left, right, (a, b) => a < b);
    case "<=": return compare(left, right, (a, b) => a <= b);
    default: return false;
  }
}

function resolveReference(path: string, context: VariableConditionContext): ConditionValue {
  const separator = path.indexOf("::");
  const scope = path.slice(0, separator);
  const segments = path.slice(separator + 2).split(".");
  let current: unknown = scope === "var" ? context.variables : context.session;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return isConditionValue(current) ? current : undefined;
}

function isConditionValue(value: unknown): value is ConditionValue {
  return value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value);
}

function compare(
  left: ConditionValue,
  right: ConditionValue,
  operation: (left: number | string, right: number | string) => boolean,
): boolean {
  if (typeof left === "number" && typeof right === "number") return operation(left, right);
  if (typeof left === "string" && typeof right === "string") return operation(left, right);
  return false;
}
