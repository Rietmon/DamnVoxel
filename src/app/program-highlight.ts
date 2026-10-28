import { PROGRAM_API } from '../kernels/program';

/**
 * Colours for program code (docs/programs.md, “Code editor”): comments, strings, numbers,
 * keywords and the shape API, as HTML spans laid under the transparent text of the editor. One
 * pass, no parsing beyond what colouring needs.
 */

const KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'for',
  'of',
  'in',
  'if',
  'else',
  'while',
  'do',
  'return',
  'function',
  'new',
  'true',
  'false',
  'null',
  'undefined',
  'break',
  'continue',
  'typeof',
  'Math',
]);
const API = new Set<string>(PROGRAM_API);

const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?|`(?:\\.|[^`\\])*`?)|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlightProgram(source: string): string {
  let out = '';
  let at = 0;
  for (const m of source.matchAll(TOKEN)) {
    out += esc(source.slice(at, m.index));
    const [text, comment, string, number, word] = m;
    const cls = comment
      ? 'c'
      : string
        ? 's'
        : number
          ? 'n'
          : word && KEYWORDS.has(word)
            ? 'k'
            : word && API.has(word)
              ? 'f'
              : '';
    out += cls ? `<span class="${cls}">${esc(text)}</span>` : esc(text);
    at = m.index + text.length;
  }
  // A trailing newline needs a character after it to take up its line.
  return `${out + esc(source.slice(at))} `;
}
