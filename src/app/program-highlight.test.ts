import { describe, expect, it } from 'vitest';
import { highlightProgram } from './program-highlight';

describe('program highlighting', () => {
  it('marks comments, strings, numbers, keywords and the API', () => {
    const html = highlightProgram(
      'const h = param("Height", 24); // <tall>\nbox(0, 0, 0, h, 1, 1, c);',
    );
    expect(html).toContain('<span class="k">const</span>');
    expect(html).toContain('<span class="f">param</span>');
    expect(html).toContain('<span class="s">"Height"</span>');
    expect(html).toContain('<span class="n">24</span>');
    expect(html).toContain('<span class="c">// &lt;tall&gt;</span>');
    expect(html).toContain('<span class="f">box</span>');
    // Plain names stay plain, the text stays whole.
    expect(
      html
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>'),
    ).toBe('const h = param("Height", 24); // <tall>\nbox(0, 0, 0, h, 1, 1, c); ');
  });

  it('copes with unfinished strings and comments while typing', () => {
    expect(highlightProgram('log("abc')).toContain('<span class="s">"abc</span>');
    expect(highlightProgram('/* open')).toContain('<span class="c">/* open</span>');
  });
});
