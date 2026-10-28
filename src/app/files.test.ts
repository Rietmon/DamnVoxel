import { describe, expect, it } from 'vitest';
import { documentName, fileNameFor } from './files';

describe('file names', () => {
  it('names a document after its file and a file after its document', () => {
    expect(documentName('house.vox')).toBe('house');
    expect(documentName('HOUSE.VOX')).toBe('HOUSE');
    expect(documentName('.vox')).toBe('Untitled');
    expect(fileNameFor('House')).toBe('House.vox');
    expect(fileNameFor('a/b:c?')).toBe('a b c.vox');
    expect(fileNameFor('  ')).toBe('model.vox');
    expect(fileNameFor('tree.vox')).toBe('tree.vox');
  });
});
