import * as path from 'path';

import { requireNodeModule } from '../../../src/utils/nodeCompat';

describe('requireNodeModule', () => {
  it('resolves real Node builtins when a Node runtime is present', () => {
    const resolved = requireNodeModule<typeof path>('path');
    expect(resolved.join('a', 'b')).toBe(path.join('a', 'b'));
  });

  it('returns a stub instead of throwing when the module cannot be resolved', () => {
    expect(() => requireNodeModule('definitely-not-a-real-module-xyz')).not.toThrow();
  });

  it('stub throws a platform error only when a property is accessed', () => {
    const stub = requireNodeModule<{ anything: () => void }>('definitely-not-a-real-module-xyz');
    expect(() => stub.anything).toThrow(
      "Node module 'definitely-not-a-real-module-xyz' is unavailable on this platform",
    );
  });
});
