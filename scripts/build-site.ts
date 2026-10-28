/**
 * The user guide as a small site (docs/user → public/guide): each Markdown page becomes an
 * HTML page with the chapter list, the pictures are copied next to them. Vite serves and builds
 * public/ as it is, so the guide lives at /guide/ beside the editor and works offline with it.
 *
 * node scripts/build-site.ts
 *
 * The Markdown is the small subset the guide uses: headings, paragraphs, lists, tables, images,
 * links, bold and code.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = 'docs/user';
const OUT = 'public/guide';

/** Chapters in reading order: the file and its title in the list. */
const CHAPTERS: [string, string][] = [
  ['README.md', 'Overview'],
  ['start.md', 'Getting started'],
  ['drawing.md', 'Drawing and shaping'],
  ['selection.md', 'Selecting and moving'],
  ['scene.md', 'Scene'],
  ['color.md', 'Color and materials'],
  ['animation.md', 'Animation'],
  ['render.md', 'Render'],
  ['programs.md', 'Programs'],
  ['files.md', 'Files'],
  ['keys.md', 'Keys'],
];

const page = (md: string) => (md === 'README.md' ? 'index.html' : md.replace(/\.md$/, '.html'));

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** An anchor for a heading: lower case, words joined by hyphens (Cyrillic kept). */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Links to other pages of the guide point at their HTML. */
function href(url: string): string {
  const [path, hash] = url.split('#');
  if (path && /\.md$/.test(path) && !/^[a-z]+:/.test(path))
    return page(path) + (hash ? `#${hash}` : '');
  return url;
}

export function inline(text: string): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `${codes.length - 1}`;
  });
  s = esc(s);
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_, alt: string, src: string) => `<img src="${src}" alt="${alt}" loading="lazy">`,
  );
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, t: string, url: string) => `<a href="${href(url.replace(/&amp;/g, '&'))}">${t}</a>`,
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s.replace(/(\d+)/g, (_, i: string) => codes[Number(i)]!);
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

export function markdown(md: string): { html: string; title: string } {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let title = '';
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ');
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(text);
    out.push(
      image
        ? `<figure>${inline(text)}<figcaption>${esc(image[1]!)}</figcaption></figure>`
        : `<p>${inline(text)}</p>`,
    );
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      const text = heading[2]!;
      if (level === 1 && !title) title = text;
      out.push(`<h${level} id="${slug(text)}">${inline(text)}</h${level}>`);
    } else if (line.startsWith('```')) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith('```'); i++) code.push(lines[i]!);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (line.startsWith('|')) {
      flush();
      const rows: string[] = [];
      for (; i < lines.length && lines[i]!.startsWith('|'); i++) rows.push(lines[i]!);
      i--;
      const [head, , ...body] = rows;
      out.push(
        `<table><thead><tr>${cells(head!)
          .map((c) => `<th>${inline(c)}</th>`)
          .join('')}</tr></thead><tbody>${body
          .map(
            (r) =>
              `<tr>${cells(r)
                .map((c) => `<td>${inline(c)}</td>`)
                .join('')}</tr>`,
          )
          .join('')}</tbody></table>`,
      );
    } else if (/^(- |\d+\. )/.test(line)) {
      flush();
      const ordered = /^\d+\. /.test(line);
      const items: string[] = [];
      for (; i < lines.length && /^(- |\d+\. )/.test(lines[i]!); i++)
        items.push(`<li>${inline(lines[i]!.replace(/^(- |\d+\. )/, ''))}</li>`);
      i--;
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
    } else if (line.trim() === '') flush();
    else paragraph.push(line.trim());
  }
  flush();
  return { html: out.join('\n'), title };
}

const STYLE = `
:root{--bg:#1b1d22;--surface:#24272e;--line:#353943;--text:#e7e8eb;--dim:#a0a5ae;--faint:#6f7480;--accent:#ff9f43;--accent-text:#1b1d22;color-scheme:dark}
@media (prefers-color-scheme: light){:root{--bg:#f6f7f9;--surface:#fff;--line:#dfe2e7;--text:#1c1f24;--dim:#545a64;--faint:#858b95;--accent:#f28a1d;--accent-text:#1c1f24;color-scheme:light}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--bg)}
.brand{color:var(--text);font-weight:700;text-decoration:none;font-size:18px}
header span{color:var(--faint)}
.open{margin-left:auto;padding:6px 14px;border-radius:8px;background:var(--accent);color:var(--accent-text);font-weight:600;text-decoration:none}
.wrap{display:flex;gap:32px;max-width:1080px;margin:0 auto;padding:24px 16px 64px}
nav{flex:none;width:200px;position:sticky;top:72px;align-self:flex-start}
nav a{display:block;padding:4px 10px;border-radius:6px;color:var(--dim);text-decoration:none}
nav a:hover{color:var(--text);background:var(--surface)}
nav a.on{color:var(--accent);background:var(--surface);font-weight:600}
main{flex:1;min-width:0;max-width:760px}
h1{margin:0 0 16px;font-size:32px;line-height:1.2}
h2{margin:32px 0 8px;font-size:22px}
h3{margin:24px 0 8px;font-size:18px}
a{color:var(--accent)}
code{padding:1px 5px;border-radius:4px;background:var(--surface);font:14px ui-monospace,Consolas,monospace}
pre{padding:12px;border-radius:8px;background:var(--surface);overflow:auto}
pre code{padding:0;background:none}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:15px}
th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--dim);font-weight:600}
figure{margin:16px 0}
img{max-width:100%;height:auto;border-radius:10px;border:1px solid var(--line)}
figcaption{color:var(--faint);font-size:14px;margin-top:4px}
li{margin:4px 0}
.pager{display:flex;justify-content:space-between;gap:12px;margin-top:48px;padding-top:16px;border-top:1px solid var(--line)}
@media (max-width:760px){.wrap{display:block;padding-top:12px}nav{position:static;width:auto;display:flex;flex-wrap:wrap;gap:2px;margin-bottom:16px}nav a{padding:2px 8px;font-size:14px}h1{font-size:26px}}
`;

function render(md: string, body: string, title: string): string {
  const at = CHAPTERS.findIndex(([f]) => f === md);
  const prev = CHAPTERS[at - 1];
  const next = CHAPTERS[at + 1];
  const nav = CHAPTERS.map(
    ([f, t]) => `<a href="${page(f)}"${f === md ? ' class="on" aria-current="page"' : ''}>${t}</a>`,
  ).join('');
  const pager = `<div class="pager"><span>${prev ? `<a href="${page(prev[0])}">← ${prev[1]}</a>` : ''}</span><span>${next ? `<a href="${page(next[0])}">${next[1]} →</a>` : ''}</span></div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title.includes('DamnVoxel') ? title : `${title} — DamnVoxel`)}</title>
<link rel="icon" href="../favicon.svg">
<style>${STYLE}</style>
</head>
<body>
<header><a class="brand" href="index.html">DamnVoxel</a><span>guide</span><a class="open" href="../">Open the editor</a></header>
<div class="wrap"><nav aria-label="Chapters">${nav}</nav><main>
${body}
${pager}
</main></div>
</body>
</html>
`;
}

function build(): void {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'img'), { recursive: true });
  for (const [md] of CHAPTERS) {
    const { html, title } = markdown(readFileSync(join(SOURCE, md), 'utf8'));
    writeFileSync(join(OUT, page(md)), render(md, html, title));
  }
  for (const f of readdirSync(join(SOURCE, 'img')))
    copyFileSync(join(SOURCE, 'img', f), join(OUT, 'img', f));
  console.log(`Guide: ${CHAPTERS.length} pages → ${OUT}`);
}

if (process.argv[1]?.endsWith('build-site.ts')) build();
