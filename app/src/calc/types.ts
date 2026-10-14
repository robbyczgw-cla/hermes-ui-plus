/**
 * Shared types for the calc expression engine.
 * Pure TypeScript, no dependencies. Keep this file free of enums/namespaces
 * (tests run through Node's type stripping).
 */

export const MAX_EXPR_LENGTH = 500;
export const MAX_AST_DEPTH = 50;
export const MAX_AST_NODES = 200;
export const MAX_SWEEP_STEPS = 60;
export const CACHE_SIZE = 200;

export type CalcErrorCode =
  | 'empty'
  | 'too_long'
  | 'too_deep'
  | 'too_complex'
  | 'syntax'
  | 'char'
  | 'number'
  | 'unknown_function'
  | 'arity'
  | 'unknown_identifier'
  | 'reserved'
  | 'type'
  | 'sweep'
  | 'internal';

/** Plain, serialisable error description. `pos`/`end` are 0-based offsets into the expression. */
export interface CalcErrorInfo {
  code: CalcErrorCode;
  /** German, human readable; includes "(Position N)" (1-based) when a position is known. */
  message: string;
  pos: number;
  end: number;
}

export class CalcError extends Error {
  code: CalcErrorCode;
  pos: number;
  end: number;
  constructor(code: CalcErrorCode, text: string, pos: number, end?: number) {
    super(pos >= 0 ? `${text} (Position ${pos + 1})` : text);
    this.name = 'CalcError';
    this.code = code;
    this.pos = pos;
    this.end = end === undefined ? pos + 1 : end;
  }
  toInfo(): CalcErrorInfo {
    return { code: this.code, message: this.message, pos: this.pos, end: this.end };
  }
}

export type TokenType = 'num' | 'id' | 'op' | '(' | ')' | ',' | '?' | ':' | 'eof';

export interface Token {
  type: TokenType;
  /** Source text (operators are normalised, e.g. "×" becomes "*"). */
  text: string;
  /** Numeric value for `num` tokens. */
  value: number;
  pos: number;
  end: number;
}

export type UnaryOp = '-' | '+' | '!';
export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%' | '^'
  | '<' | '<=' | '>' | '>=' | '==' | '!='
  | '&&' | '||';

export interface NumNode { type: 'num'; value: number; pos: number; end: number }
export interface VarNode { type: 'var'; name: string; pos: number; end: number }
export interface UnaryNode { type: 'unary'; op: UnaryOp; arg: Ast; pos: number; end: number }
export interface BinaryNode { type: 'binary'; op: BinaryOp; left: Ast; right: Ast; pos: number; end: number }
export interface CondNode { type: 'cond'; test: Ast; then: Ast; else: Ast; pos: number; end: number }
export interface CallNode { type: 'call'; name: string; args: Ast[]; pos: number; end: number }

export type Ast = NumNode | VarNode | UnaryNode | BinaryNode | CondNode | CallNode;

/** Variables an expression may read. Only OWN keys are ever looked up. */
export type Scope = ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>;

export type EvalResult =
  | { ok: true; value: number | null }
  | { ok: false; error: CalcErrorInfo };

export type CompileResult =
  | {
      ok: true;
      ast: Ast;
      /** Distinct variable names used (includes `pi`/`e` when written). */
      identifiers: string[];
      fn: (scope: Scope) => EvalResult;
    }
  | { ok: false; error: CalcErrorInfo };

export interface CalcOutputDef {
  name?: string;
  expr: string;
}

export interface OutputResult {
  name?: string;
  /** `null` = not computable (division by zero, NaN, Infinity, error) -> UI shows "–". */
  value: number | null;
  error?: CalcErrorInfo;
}
