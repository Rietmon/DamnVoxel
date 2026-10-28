import { describe, expect, it } from 'vitest';
import { inline, markdown, slug } from '../scripts/build-site';

describe('guide site', () => {
  it('turns the guide Markdown into HTML', () => {
    const { html, title } = markdown(
      [
        '# Render',
        'Text with **bold**, `code` and [a link](render.md#frame-series).',
        '',
        '![Caption](img/a.png)',
        '',
        '- one',
        '- two',
        '',
        '| A | B |',
        '|---|---|',
        '| 1 | 2 |',
        '## Frame series',
      ].join('\n'),
    );
    expect(title).toBe('Render');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<a href="render.html#frame-series">a link</a>');
    expect(html).toContain(
      '<figure><img src="img/a.png" alt="Caption" loading="lazy"><figcaption>Caption</figcaption></figure>',
    );
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain(
      '<thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>',
    );
    expect(html).toContain('<h2 id="frame-series">');
  });

  it('escapes HTML and keeps code as written', () => {
    expect(inline('a < b & `<c>`')).toBe('a &lt; b &amp; <code>&lt;c&gt;</code>');
    expect(inline('[Overview](README.md)')).toBe('<a href="index.html">Overview</a>');
    expect(slug('Render window!')).toBe('render-window');
  });
});
