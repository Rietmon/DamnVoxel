import type { Action } from './actions';

/** Lower case, so “Mirror” and “mirror” find the same thing. */
function fold(text: string): string {
  return text.toLowerCase();
}

/**
 * Actions matching a query for the command palette, best first. Every word of the query must
 * appear in the title, the group or the shortcut; titles that start with the query come first,
 * then titles with a word starting with it, then the rest in registration order. Recently run
 * actions lead when the query is empty.
 */
export function searchActions(
  actions: readonly Action[],
  query: string,
  shortcut: (id: string) => string | null,
  recent: readonly string[] = [],
): Action[] {
  const q = fold(query.trim());
  if (!q) {
    const rank = (a: Action) => {
      const i = recent.indexOf(a.id);
      return i < 0 ? recent.length : i;
    };
    return actions
      .map((a, i) => ({ a, i }))
      .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
      .map((x) => x.a);
  }
  const words = q.split(/\s+/);
  const scored: { action: Action; score: number; index: number }[] = [];
  actions.forEach((action, index) => {
    const title = fold(action.title);
    const haystack = `${title} ${fold(action.group)} ${fold(shortcut(action.id) ?? '')}`;
    if (!words.every((w) => haystack.includes(w))) return;
    let score = 3;
    if (title.startsWith(q)) score = 0;
    else if (title.split(/[\s:/(),·—-]+/).some((w) => w.startsWith(words[0]!))) score = 1;
    else if (title.includes(q)) score = 2;
    scored.push({ action, score, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((s) => s.action);
}
