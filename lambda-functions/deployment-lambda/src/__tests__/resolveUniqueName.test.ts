import { resolveUniqueName } from '../handlers/saveWorkflow';

describe('resolveUniqueName', () => {
  it('returns the trimmed name when it is free', () => {
    expect(resolveUniqueName('My Flow', new Set())).toBe('My Flow');
    expect(resolveUniqueName('  My Flow  ', new Set())).toBe('My Flow');
  });

  it('is case-sensitive — different case does not collide', () => {
    const existing = new Set(['My Flow']);
    // "my flow" differs in case, so it is considered free.
    expect(resolveUniqueName('my flow', existing)).toBe('my flow');
  });

  it('treats trailing/leading whitespace as the same name', () => {
    const existing = new Set(['my flow']);
    // "my flow " trims to "my flow", which is taken -> next free suffix.
    expect(resolveUniqueName('my flow ', existing)).toBe('my flow (2)');
  });

  it('appends the first free numeric suffix', () => {
    const existing = new Set(['Report', 'Report (2)', 'Report (3)']);
    expect(resolveUniqueName('Report', existing)).toBe('Report (4)');
  });

  it('produces a clean first copy then numbered copies', () => {
    // First duplicate: "X (Copy)" is free.
    expect(resolveUniqueName('X (Copy)', new Set(['X']))).toBe('X (Copy)');
    // Second duplicate: "X (Copy)" taken -> "X (Copy) (2)".
    expect(resolveUniqueName('X (Copy)', new Set(['X', 'X (Copy)']))).toBe('X (Copy) (2)');
  });
});
