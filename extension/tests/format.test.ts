import { describe, expect, it } from 'vitest';
import { formatBytes, formatElapsed, formatQueuePosition } from '@/utils/format';

const MINUTE_MS = 60_000;

describe('formatElapsed', () => {
  it('uses the short style of the design', () => {
    expect(formatElapsed(30_000)).toBe('há menos de 1 min');
    expect(formatElapsed(12 * MINUTE_MS)).toBe('há 12 min');
    expect(formatElapsed(3 * 60 * MINUTE_MS)).toBe('há 3 h');
    expect(formatElapsed(24 * 60 * MINUTE_MS)).toBe('há 1 dia');
    expect(formatElapsed(3 * 24 * 60 * MINUTE_MS)).toBe('há 3 dias');
  });
});

describe('formatBytes', () => {
  it('uses Brazilian decimal separators', () => {
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(148 * 1024 * 1024)).toBe('148 MB');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1,5 GB');
  });
});

describe('formatQueuePosition', () => {
  it('formats a feminine ordinal', () => {
    expect(formatQueuePosition(3)).toBe('3ª');
  });
});
