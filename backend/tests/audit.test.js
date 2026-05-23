'use strict';

const { hashEntry } = require('../src/services/audit');

describe('hashEntry', () => {
  test('returns 64-char hex SHA-256', () => {
    const h = hashEntry(null, { a: 1 }, '2026-01-01T00:00:00.000Z');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  test('changes when previous hash changes', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const a = hashEntry(null,           { a: 1 }, ts);
    const b = hashEntry('a'.repeat(64), { a: 1 }, ts);
    expect(a).not.toBe(b);
  });

  test('changes when payload changes', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    expect(hashEntry(null, { a: 1 }, ts)).not.toBe(hashEntry(null, { a: 2 }, ts));
  });

  test('changes when timestamp changes', () => {
    expect(hashEntry(null, { a: 1 }, '2026-01-01T00:00:00.000Z'))
      .not.toBe(hashEntry(null, { a: 1 }, '2026-01-01T00:00:00.001Z'));
  });

  test('is invariant to JSON key insertion order', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    expect(hashEntry(null, { a: 1, b: 2 }, ts)).toBe(hashEntry(null, { b: 2, a: 1 }, ts));
  });
});
