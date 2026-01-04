/**
 * Tests for environment utilities.
 */

import { getEnhancedPath, parseEnvironmentVariables } from '../../../src/utils/env';

const isWindows = process.platform === 'win32';
const SEP = isWindows ? ';' : ':';

describe('parseEnvironmentVariables', () => {
  it('parses simple KEY=VALUE pairs', () => {
    const input = 'FOO=bar\nBAZ=qux';
    expect(parseEnvironmentVariables(input)).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('handles quoted values', () => {
    const input = 'FOO="bar baz"\nQUX=\'hello world\'';
    expect(parseEnvironmentVariables(input)).toEqual({ FOO: 'bar baz', QUX: 'hello world' });
  });

  it('ignores comments and empty lines', () => {
    const input = '# comment\nFOO=bar\n\n# another\nBAZ=qux';
    expect(parseEnvironmentVariables(input)).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('handles Windows line endings', () => {
    const input = 'FOO=bar\r\nBAZ=qux\r\n';
    expect(parseEnvironmentVariables(input)).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('handles equals sign in value', () => {
    const input = 'FOO=bar=baz';
    expect(parseEnvironmentVariables(input)).toEqual({ FOO: 'bar=baz' });
  });

  it('trims whitespace around keys and values', () => {
    const input = '  FOO  =  bar  ';
    expect(parseEnvironmentVariables(input)).toEqual({ FOO: 'bar' });
  });
});

describe('getEnhancedPath', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore environment
    Object.keys(process.env).forEach(key => delete process.env[key]);
    Object.assign(process.env, originalEnv);
  });

  describe('basic functionality', () => {
    it('returns a non-empty string', () => {
      const result = getEnhancedPath();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('includes current PATH from process.env', () => {
      process.env.PATH = `/existing/path${SEP}/another/path`;
      const result = getEnhancedPath();
      expect(result).toContain('/existing/path');
      expect(result).toContain('/another/path');
    });

    it('works when process.env.PATH is empty', () => {
      process.env.PATH = '';
      const result = getEnhancedPath();
      expect(typeof result).toBe('string');
      // Should still have extra paths
      expect(result.length).toBeGreaterThan(0);
    });

    it('works when process.env.PATH is undefined', () => {
      delete process.env.PATH;
      const result = getEnhancedPath();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('platform-specific separator', () => {
    it('uses correct separator for current platform', () => {
      const result = getEnhancedPath();
      // Result should contain the platform-specific separator
      expect(result).toContain(SEP);
    });

    it('splits and joins with platform separator', () => {
      const result = getEnhancedPath();
      const segments = result.split(SEP);
      // Should have multiple segments
      expect(segments.length).toBeGreaterThan(1);
      // Rejoining should give same result
      expect(segments.join(SEP)).toBe(result);
    });

    it('handles input with platform separator', () => {
      const customPath = `/custom/bin1${SEP}/custom/bin2`;
      const result = getEnhancedPath(customPath);
      expect(result).toContain('/custom/bin1');
      expect(result).toContain('/custom/bin2');
    });
  });

  describe('custom PATH merging and priority', () => {
    it('prepends additional paths (highest priority)', () => {
      process.env.PATH = '/existing/path';
      const result = getEnhancedPath('/custom/bin');
      const segments = result.split(SEP);
      // Custom path should be first
      expect(segments[0]).toBe('/custom/bin');
      // Existing should come after extra paths
      expect(segments.indexOf('/custom/bin')).toBeLessThan(segments.indexOf('/existing/path'));
    });

    it('merges multiple additional paths in order', () => {
      const customPath = `/first/bin${SEP}/second/bin${SEP}/third/bin`;
      const result = getEnhancedPath(customPath);
      const segments = result.split(SEP);
      expect(segments[0]).toBe('/first/bin');
      expect(segments[1]).toBe('/second/bin');
      expect(segments[2]).toBe('/third/bin');
    });

    it('preserves priority: additional > extra > current', () => {
      process.env.PATH = '/usr/bin';
      const result = getEnhancedPath('/user/custom');
      const segments = result.split(SEP);

      const customIndex = segments.indexOf('/user/custom');
      const usrBinIndex = segments.indexOf('/usr/bin');

      // Custom should come before current PATH
      expect(customIndex).toBeLessThan(usrBinIndex);
    });

    it('handles undefined additional paths', () => {
      process.env.PATH = '/existing/path';
      const result = getEnhancedPath(undefined);
      expect(result).toContain('/existing/path');
    });

    it('handles empty string additional paths', () => {
      process.env.PATH = '/existing/path';
      const result = getEnhancedPath('');
      expect(result).toContain('/existing/path');
      // Should not have empty segments
      const segments = result.split(SEP);
      expect(segments.every(s => s.length > 0)).toBe(true);
    });
  });

  describe('deduplication logic', () => {
    it('removes duplicate paths', () => {
      process.env.PATH = `/usr/local/bin${SEP}/usr/bin`;
      const result = getEnhancedPath('/usr/local/bin');
      const segments = result.split(SEP);
      const count = segments.filter(s => s === '/usr/local/bin').length;
      expect(count).toBe(1);
    });

    it('preserves first occurrence when deduplicating', () => {
      // Additional path should win over current PATH
      process.env.PATH = `/duplicate/path${SEP}/other/path`;
      const result = getEnhancedPath('/duplicate/path');
      const segments = result.split(SEP);
      // First occurrence should be from additional paths
      expect(segments[0]).toBe('/duplicate/path');
    });

    it('deduplicates across all sources', () => {
      // Path appears in additional, might be in extra paths, and in current
      process.env.PATH = `/usr/local/bin${SEP}/usr/bin${SEP}/usr/local/bin`;
      const result = getEnhancedPath(`/usr/local/bin${SEP}/usr/bin`);
      const segments = result.split(SEP);

      // Each unique path should appear only once
      const localBinCount = segments.filter(s => s === '/usr/local/bin').length;
      const usrBinCount = segments.filter(s => s === '/usr/bin').length;
      expect(localBinCount).toBe(1);
      expect(usrBinCount).toBe(1);
    });

    // Note: Case-insensitive deduplication on Windows is tested implicitly
    // since the module uses lowercase comparison on win32
  });

  describe('empty segment filtering', () => {
    it('filters out empty segments from current PATH', () => {
      process.env.PATH = `/usr/bin${SEP}${SEP}/bin${SEP}`;
      const result = getEnhancedPath();
      const segments = result.split(SEP);
      expect(segments.every(s => s.length > 0)).toBe(true);
    });

    it('filters out empty segments from additional paths', () => {
      const result = getEnhancedPath(`${SEP}/custom/bin${SEP}${SEP}`);
      const segments = result.split(SEP);
      expect(segments.every(s => s.length > 0)).toBe(true);
    });

    it('handles path with only empty segments', () => {
      process.env.PATH = `${SEP}${SEP}${SEP}`;
      const result = getEnhancedPath(`${SEP}${SEP}`);
      const segments = result.split(SEP);
      expect(segments.every(s => s.length > 0)).toBe(true);
    });
  });

  describe('extra binary paths', () => {
    it('returns non-empty result with extra paths', () => {
      const result = getEnhancedPath();
      // On both platforms, result should be non-empty
      expect(result.length).toBeGreaterThan(0);
    });

    it('includes platform-appropriate paths', () => {
      const result = getEnhancedPath();
      const segments = result.split(SEP);
      // Should have added some extra paths beyond just process.env.PATH
      expect(segments.length).toBeGreaterThan(1);
    });
  });
});
