import { CalcError, MAX_EXPR_LENGTH } from './types.ts';
import type { Token } from './types.ts';

const LETTER = /[\p{L}_]/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}_]/u;

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9';
}

function isSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' ';
}

/** Typographic operators LLMs like to emit; mapped to their ASCII form. */
const UNICODE_OPS: Record<string, string> = {
  '×': '*',
  '·': '*',
  '÷': '/',
  '−': '-',
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
};

/**
 * Splits an expression into tokens. Throws CalcError (never anything else).
 * Numbers: `12`, `3.5`, `.5`, `1_000`, `1e3`, `2.5E-3`. NO decimal comma ("3,5" is
 * number, comma, number -> a syntax error with a hint).
 */
export function tokenize(src: string): Token[] {
  if (typeof src !== 'string') throw new CalcError('type', 'Ausdruck muss ein Text sein', -1);
  if (src.length > MAX_EXPR_LENGTH) {
    throw new CalcError(
      'too_long',
      `Ausdruck zu lang (${src.length} Zeichen, max. ${MAX_EXPR_LENGTH})`,
      MAX_EXPR_LENGTH,
      src.length,
    );
  }
  const tokens: Token[] = [];
  const n = src.length;
  let i = 0;
  const push = (type: Token['type'], text: string, pos: number, end: number, value = 0) => {
    tokens.push({ type, text, value, pos, end });
  };

  while (i < n) {
    const c = src[i];
    if (isSpace(c)) {
      i++;
      continue;
    }

    // ---- numbers
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      const start = i;
      let text = '';
      const readDigits = () => {
        let sawDigit = false;
        while (i < n) {
          const d = src[i];
          if (isDigit(d)) {
            text += d;
            sawDigit = true;
            i++;
          } else if (d === '_') {
            if (!sawDigit || !isDigit(src[i + 1])) {
              throw new CalcError('number', 'Unterstrich in Zahl nur zwischen Ziffern erlaubt (z. B. 1_000)', i);
            }
            i++;
          } else break;
        }
      };
      if (c !== '.') readDigits();
      if (src[i] === '.') {
        if (!isDigit(src[i + 1])) {
          throw new CalcError('number', 'Ungültige Zahl: nach dem Punkt fehlen Ziffern', i);
        }
        text += '.';
        i++;
        readDigits();
      }
      const e = src[i];
      if (e === 'e' || e === 'E') {
        const s = src[i + 1];
        if (isDigit(s) || ((s === '+' || s === '-') && isDigit(src[i + 2]))) {
          text += 'e';
          i++;
          if (src[i] === '+' || src[i] === '-') {
            text += src[i];
            i++;
          }
          readDigits();
        }
      }
      if (i < n && LETTER.test(src[i])) {
        throw new CalcError(
          'number',
          `Zahl direkt vor Buchstaben „${src.slice(start, i + 1)}“ – Operator fehlt? (z. B. 2 * x; Hex-/Einheiten-Schreibweisen gibt es nicht)`,
          start,
          i + 1,
        );
      }
      const value = Number(text);
      if (!Number.isFinite(value)) {
        throw new CalcError('number', 'Zahl ist zu groß', start, i);
      }
      push('num', src.slice(start, i), start, i, value);
      continue;
    }

    // ---- identifiers
    if (LETTER.test(c)) {
      const start = i;
      i++;
      while (i < n && LETTER_OR_DIGIT.test(src[i])) i++;
      push('id', src.slice(start, i), start, i);
      continue;
    }

    // ---- unicode operators
    const u = UNICODE_OPS[c];
    if (u !== undefined) {
      push('op', u, i, i + 1);
      i++;
      continue;
    }

    // ---- punctuation / operators
    const two = src.slice(i, i + 2);
    switch (c) {
      case '(': push('(', c, i, i + 1); i++; continue;
      case ')': push(')', c, i, i + 1); i++; continue;
      case ',': push(',', c, i, i + 1); i++; continue;
      case '?': push('?', c, i, i + 1); i++; continue;
      case ':': push(':', c, i, i + 1); i++; continue;
      case '+': case '-': case '*': case '/': case '^': case '%':
        push('op', c, i, i + 1); i++; continue;
      case '<':
      case '>':
        if (two[1] === '=') { push('op', two, i, i + 2); i += 2; } else { push('op', c, i, i + 1); i++; }
        continue;
      case '=':
        if (two === '==') {
          if (src[i + 2] === '=') throw new CalcError('char', '„===“ gibt es nicht – „==“ zum Vergleichen verwenden', i, i + 3);
          push('op', '==', i, i + 2);
          i += 2;
          continue;
        }
        throw new CalcError('char', 'Zuweisung („=“) ist nicht erlaubt – zum Vergleichen „==“ verwenden', i);
      case '!':
        if (two === '!=') {
          if (src[i + 2] === '=') throw new CalcError('char', '„!==“ gibt es nicht – „!=“ verwenden', i, i + 3);
          push('op', '!=', i, i + 2);
          i += 2;
        } else {
          push('op', '!', i, i + 1);
          i++;
        }
        continue;
      case '&':
        if (two === '&&') { push('op', '&&', i, i + 2); i += 2; continue; }
        throw new CalcError('char', 'Einzelnes „&“ nicht erlaubt – „&&“ für UND verwenden', i);
      case '|':
        if (two === '||') { push('op', '||', i, i + 2); i += 2; continue; }
        throw new CalcError('char', 'Einzelnes „|“ nicht erlaubt – „||“ für ODER verwenden', i);
      case '.':
        throw new CalcError('char', 'Eigenschaftszugriff mit „.“ ist nicht erlaubt (Dezimalzahlen mit führender Ziffer schreiben, z. B. 0.5)', i);
      case '"': case "'": case '`':
        throw new CalcError('char', 'Zeichenketten (Strings) sind nicht erlaubt', i);
      case '[': case ']': case '{': case '}':
        throw new CalcError('char', `Zeichen „${c}“ ist nicht erlaubt (keine Listen, Objekte oder Indexzugriffe)`, i);
      default: {
        const code = c.charCodeAt(0);
        const shown = code < 32 ? `U+${code.toString(16).padStart(4, '0')}` : `„${c}“`;
        throw new CalcError('char', `Unerlaubtes Zeichen ${shown}`, i);
      }
    }
  }
  push('eof', '', n, n);
  return tokens;
}
