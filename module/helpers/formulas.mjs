/**
 * Formula parser and evaluator for Shards of Mana.
 * Supports arithmetic, comparison, ternary conditionals, and built-in functions.
 * Uses a recursive-descent parser — no eval().
 *
 * Variables: SL, RANK, STR, AGI, VIT, MAG, SPI, PER, LCK, CHM, LVL
 * Operators: + - * / ( ) >= <= > < == ? :
 * Functions: ceil() floor() min() max() abs() round()
 */

/**
 * Maps rank letters to 1-indexed numeric values for formula evaluation.
 * F=1, E=2, D=3, C=4, B=5, A=6, S=7
 * @type {Object<string, number>}
 */
export const RANK_NUMERIC = { F: 1, E: 2, D: 3, C: 4, B: 5, A: 6, S: 7 };

/* -------------------------------------------- */
/*  Tokenizer                                    */
/* -------------------------------------------- */

const TOKEN = {
  NUMBER: "NUMBER",
  IDENT: "IDENT",
  OP: "OP",
  LPAREN: "LPAREN",
  RPAREN: "RPAREN",
  COMMA: "COMMA",
  QUESTION: "QUESTION",
  COLON: "COLON",
  EOF: "EOF"
};

/**
 * Tokenize a formula string into an array of tokens.
 * @param {string} input
 * @returns {Array<{type: string, value: string|number}>}
 */
function tokenize(input) {
  const tokens = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Skip whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // Numbers (integers and decimals)
    if (/\d/.test(ch) || (ch === "." && i + 1 < input.length && /\d/.test(input[i + 1]))) {
      let num = "";
      while (i < input.length && (/\d/.test(input[i]) || input[i] === ".")) {
        num += input[i++];
      }
      tokens.push({ type: TOKEN.NUMBER, value: parseFloat(num) });
      continue;
    }

    // Identifiers (variable names and functions)
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
        ident += input[i++];
      }
      tokens.push({ type: TOKEN.IDENT, value: ident });
      continue;
    }

    // Multi-char operators
    if (ch === ">" && input[i + 1] === "=") {
      tokens.push({ type: TOKEN.OP, value: ">=" }); i += 2; continue;
    }
    if (ch === "<" && input[i + 1] === "=") {
      tokens.push({ type: TOKEN.OP, value: "<=" }); i += 2; continue;
    }
    if (ch === "=" && input[i + 1] === "=") {
      tokens.push({ type: TOKEN.OP, value: "==" }); i += 2; continue;
    }
    if (ch === "!" && input[i + 1] === "=") {
      tokens.push({ type: TOKEN.OP, value: "!=" }); i += 2; continue;
    }

    // Single-char tokens
    if (ch === "(") { tokens.push({ type: TOKEN.LPAREN, value: "(" }); i++; continue; }
    if (ch === ")") { tokens.push({ type: TOKEN.RPAREN, value: ")" }); i++; continue; }
    if (ch === ",") { tokens.push({ type: TOKEN.COMMA, value: "," }); i++; continue; }
    if (ch === "?") { tokens.push({ type: TOKEN.QUESTION, value: "?" }); i++; continue; }
    if (ch === ":") { tokens.push({ type: TOKEN.COLON, value: ":" }); i++; continue; }

    // Arithmetic and comparison operators
    if ("+-*/<>".includes(ch)) {
      tokens.push({ type: TOKEN.OP, value: ch }); i++; continue;
    }

    // Unknown character — skip
    console.warn(`Shards Formula | Unknown character '${ch}' in formula`);
    i++;
  }

  tokens.push({ type: TOKEN.EOF, value: null });
  return tokens;
}

/* -------------------------------------------- */
/*  Parser                                       */
/* -------------------------------------------- */

/**
 * Recursive descent parser.
 * Precedence (lowest to highest):
 *   ternary → comparison → add/sub → mul/div → unary → primary
 */
class FormulaParser {
  /**
   * @param {Array} tokens
   * @param {object} context - Variable lookup map
   */
  constructor(tokens, context) {
    this.tokens = tokens;
    this.context = context;
    this.pos = 0;
  }

  peek() { return this.tokens[this.pos]; }
  advance() { return this.tokens[this.pos++]; }

  expect(type, value) {
    const tok = this.advance();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw new Error(`Expected ${type}${value ? ` '${value}'` : ""} but got ${tok.type} '${tok.value}'`);
    }
    return tok;
  }

  /** Entry point */
  parse() {
    const result = this.parseTernary();
    if (this.peek().type !== TOKEN.EOF) {
      throw new Error(`Unexpected token '${this.peek().value}' after expression`);
    }
    return result;
  }

  /** ternary: comparison ('?' ternary ':' ternary)? */
  parseTernary() {
    let left = this.parseComparison();
    if (this.peek().type === TOKEN.QUESTION) {
      this.advance(); // consume ?
      const trueVal = this.parseTernary();
      this.expect(TOKEN.COLON);
      const falseVal = this.parseTernary();
      return left ? trueVal : falseVal;
    }
    return left;
  }

  /** comparison: addSub (('==' | '!=' | '>=' | '<=' | '>' | '<') addSub)? */
  parseComparison() {
    let left = this.parseAddSub();
    const tok = this.peek();
    if (tok.type === TOKEN.OP && ["==", "!=", ">=", "<=", ">", "<"].includes(tok.value)) {
      this.advance();
      const right = this.parseAddSub();
      switch (tok.value) {
        case "==": return left === right ? 1 : 0;
        case "!=": return left !== right ? 1 : 0;
        case ">=": return left >= right ? 1 : 0;
        case "<=": return left <= right ? 1 : 0;
        case ">": return left > right ? 1 : 0;
        case "<": return left < right ? 1 : 0;
      }
    }
    return left;
  }

  /** addSub: mulDiv (('+' | '-') mulDiv)* */
  parseAddSub() {
    let left = this.parseMulDiv();
    while (this.peek().type === TOKEN.OP && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.advance().value;
      const right = this.parseMulDiv();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  /** mulDiv: unary (('*' | '/') unary)* */
  parseMulDiv() {
    let left = this.parseUnary();
    while (this.peek().type === TOKEN.OP && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.advance().value;
      const right = this.parseUnary();
      left = op === "*" ? left * right : (right !== 0 ? left / right : 0);
    }
    return left;
  }

  /** unary: '-' unary | primary */
  parseUnary() {
    if (this.peek().type === TOKEN.OP && this.peek().value === "-") {
      this.advance();
      return -this.parseUnary();
    }
    return this.parsePrimary();
  }

  /** primary: NUMBER | IDENT (function call?) | '(' ternary ')' */
  parsePrimary() {
    const tok = this.peek();

    // Number literal
    if (tok.type === TOKEN.NUMBER) {
      this.advance();
      return tok.value;
    }

    // Identifier — could be a variable or function call
    if (tok.type === TOKEN.IDENT) {
      this.advance();
      const name = tok.value;

      // Function call: ident '(' args ')'
      if (this.peek().type === TOKEN.LPAREN) {
        this.advance(); // consume (
        const args = [];
        if (this.peek().type !== TOKEN.RPAREN) {
          args.push(this.parseTernary());
          while (this.peek().type === TOKEN.COMMA) {
            this.advance(); // consume ,
            args.push(this.parseTernary());
          }
        }
        this.expect(TOKEN.RPAREN);
        return this.callFunction(name, args);
      }

      // Variable lookup
      const upperName = name.toUpperCase();
      if (upperName in this.context) return this.context[upperName];
      if (name in this.context) return this.context[name];

      // Unknown variable — treat as 0
      console.warn(`Shards Formula | Unknown variable '${name}' — treating as 0`);
      return 0;
    }

    // Parenthesized expression
    if (tok.type === TOKEN.LPAREN) {
      this.advance();
      const result = this.parseTernary();
      this.expect(TOKEN.RPAREN);
      return result;
    }

    throw new Error(`Unexpected token '${tok.value}' (${tok.type})`);
  }

  /**
   * Evaluate a built-in function call.
   * @param {string} name
   * @param {number[]} args
   * @returns {number}
   */
  callFunction(name, args) {
    const lower = name.toLowerCase();
    switch (lower) {
      case "ceil":
        if (args.length !== 1) throw new Error(`ceil() expects 1 argument, got ${args.length}`);
        return Math.ceil(args[0]);
      case "floor":
        if (args.length !== 1) throw new Error(`floor() expects 1 argument, got ${args.length}`);
        return Math.floor(args[0]);
      case "min":
        if (args.length < 2) throw new Error(`min() expects at least 2 arguments`);
        return Math.min(...args);
      case "max":
        if (args.length < 2) throw new Error(`max() expects at least 2 arguments`);
        return Math.max(...args);
      case "abs":
        if (args.length !== 1) throw new Error(`abs() expects 1 argument, got ${args.length}`);
        return Math.abs(args[0]);
      case "round":
        if (args.length !== 1) throw new Error(`round() expects 1 argument, got ${args.length}`);
        return Math.round(args[0]);
      default:
        throw new Error(`Unknown function '${name}'`);
    }
  }
}

/* -------------------------------------------- */
/*  Public API                                   */
/* -------------------------------------------- */

/**
 * Evaluate a formula string with a context of variable values.
 * @param {string} formulaString - e.g. "SL * 3 + MAG"
 * @param {object} context - e.g. { SL: 5, STR: 20, AGI: 15, ... }
 * @returns {number|string} The computed number, or the raw string if parsing fails
 */
export function evaluateFormula(formulaString, context = {}) {
  if (!formulaString || typeof formulaString !== "string") return 0;

  const trimmed = formulaString.trim();
  if (!trimmed) return 0;

  // Fast path: plain number
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== "") return num;

  try {
    const tokens = tokenize(trimmed);
    const parser = new FormulaParser(tokens, context);
    const result = parser.parse();

    // Ensure we return a clean number
    if (typeof result === "number" && isFinite(result)) {
      return Math.round(result * 100) / 100; // round to 2 decimal places
    }
    return result;
  } catch (err) {
    console.warn(`Shards Formula | Failed to evaluate "${trimmed}":`, err.message);
    return trimmed; // Return raw string on failure
  }
}

/**
 * Build a formula context object from an actor and a skill item.
 * All skills use their own SL directly — no parent magic resolution.
 * @param {Actor|null} actor - The owning actor (null for unowned items)
 * @param {Item|null} skill - The skill item (for SL)
 * @returns {object|null} Context object or null if no actor
 */
export function buildFormulaContext(actor, skill) {
  if (!actor?.system?.stats) return null;

  const stats = actor.system.stats;
  const rankLetter = actor.system?.adventurerRank ?? "F";
  const effectiveSL = skill?.system?.skillLevel ?? 1;
  const derived = actor.system.derived;

  return {
    SL: effectiveSL,
    RANK: RANK_NUMERIC[rankLetter] ?? 0,
    STR: stats.str?.total ?? stats.str?.base ?? 10,
    AGI: stats.agi?.total ?? stats.agi?.base ?? 10,
    VIT: stats.vit?.total ?? stats.vit?.base ?? 10,
    MAG: stats.mag?.total ?? stats.mag?.base ?? 10,
    SPI: stats.spi?.total ?? stats.spi?.base ?? 10,
    PER: stats.per?.total ?? stats.per?.base ?? 10,
    LCK: stats.lck?.total ?? stats.lck?.base ?? 10,
    CHM: stats.chm?.total ?? stats.chm?.base ?? 10,
    LVL: actor.system.level ?? 1,
    ACC: derived?.acc ?? 0,
    EVA: derived?.eva ?? 0,
    PDEF: derived?.pDef ?? 0,
    MDEF: derived?.mDef ?? 0,
    CRIT: derived?.crit ?? 0
  };
}

/**
 * Generate an auto-formula string from power tier and scaling stats.
 * @param {string[]} skillStats - Array of stat keys (e.g. ["str", "mag"])
 * @param {string} powerTier - Power tier key (weak/standard/strong/devastating)
 * @returns {string} Formula string (e.g. "MAG + SL * 3")
 */
export function generateAutoFormula(skillStats, powerTier) {
  const tiers = CONFIG.SHARDS?.powerTiers;
  const tier = tiers?.[powerTier] ?? tiers?.standard ?? { statMultiplier: 1, slMultiplier: 3 };

  if (!skillStats || skillStats.length === 0) {
    return `SL * ${tier.slMultiplier}`;
  }

  const stats = skillStats.map(s => s.toUpperCase());
  const statExpr = stats.length === 1
    ? stats[0]
    : `(${stats.join(" + ")}) / ${stats.length}`;
  const statPart = tier.statMultiplier === 1
    ? statExpr
    : `${statExpr} * ${tier.statMultiplier}`;

  return `${statPart} + SL * ${tier.slMultiplier}`;
}

/**
 * Evaluate a formula string in an actor's context, returning a number.
 * Used for AE change values. Returns the raw numeric value if already a number.
 * Falls back to 0 if evaluation fails.
 * @param {string} formulaString
 * @param {Actor} actor
 * @returns {number}
 */
export function resolveFormulaValue(formulaString, actor) {
  if (!formulaString) return 0;
  const str = String(formulaString).trim();

  // Fast path: plain number
  const num = Number(str);
  if (!isNaN(num) && str !== "") return num;

  // Build context from actor (no specific skill for AE formulas)
  const ctx = buildFormulaContext(actor, null);
  if (!ctx) return 0;

  const result = evaluateFormula(str, ctx);
  return typeof result === "number" ? result : 0;
}
