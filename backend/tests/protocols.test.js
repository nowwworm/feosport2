'use strict';

const {
  canonicalize,
  hashPayload,
  renderHtml,
} = require('../src/services/protocols');

describe('canonicalize', () => {
  test('produces the same string regardless of key insertion order', () => {
    const a = { z: 1, a: 2, m: { y: 1, x: 2 } };
    const b = { a: 2, z: 1, m: { x: 2, y: 1 } };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  test('preserves array ordering', () => {
    expect(canonicalize([1, 2, 3])).toBe('[1,2,3]');
    expect(canonicalize([3, 2, 1])).toBe('[3,2,1]');
  });

  test('encodes primitives like JSON.stringify', () => {
    expect(canonicalize('foo')).toBe('"foo"');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(null)).toBe('null');
  });
});

describe('hashPayload', () => {
  test('returns 64-char hex SHA-256', () => {
    const h = hashPayload({ a: 1 });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  test('is stable across runs and key reorderings', () => {
    const h1 = hashPayload({ a: 1, b: 2, nested: { y: 'two', x: 'one' } });
    const h2 = hashPayload({ b: 2, a: 1, nested: { x: 'one', y: 'two' } });
    expect(h1).toBe(h2);
  });

  test('changes when content changes', () => {
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });
});

describe('renderHtml', () => {
  function fakeRecord(type, payload) {
    return {
      protocol_type: type,
      payload,
      payload_hash: 'abc123',
      signed_at: new Date('2026-05-01T10:00:00Z').toISOString(),
    };
  }

  test('renders qualification protocol with all participants', () => {
    const html = renderHtml(fakeRecord('qualification', {
      competition: { name: 'Кубок Тест', discipline: 'класс 75 мм' },
      stage: { type: 'qualification', ordinal: 1, qualification_mode: 'laps_time' },
      participants: [
        { group_number: 1, slot: 1, last_name: 'Иванов', first_name: 'Иван',
          team: 'Test', qualification_total_laps: 3, qualification_total_time_ms: 36000,
          qualification_best_lap_ms: 11500, finish_place: 1 },
      ],
    }), { signedBy: 'chief@example.com' });

    expect(html).toContain('Кубок Тест');
    expect(html).toContain('Иванов');
    expect(html).toContain('11.500 c');
    expect(html).toContain('abc123');
    expect(html).toContain('chief@example.com');
  });

  test('renders final standings with podium order', () => {
    const html = renderHtml(fakeRecord('final_standings', {
      competition: { name: 'X', discipline: null },
      standings: [
        { place: 1, pilot_name: 'A B', team: 'T1', total_points: 9 },
        { place: 2, pilot_name: 'C D', team: 'T2', total_points: 6 },
      ],
      ties: [],
    }));
    expect(html).toContain('A B');
    expect(html).toContain('C D');
    expect(html).toMatch(/9.*6/s);
  });

  test('flags tie situations in final standings', () => {
    const html = renderHtml(fakeRecord('final_standings', {
      competition: { name: 'X' },
      standings: [
        { place: 1, pilot_name: 'A', total_points: 5 },
        { place: 2, pilot_name: 'B', total_points: 5 },
      ],
      ties: [{ points: 5, entries: [{}, {}] }],
    }));
    expect(html).toContain('требуется дуэль');
  });

  test('escapes HTML in user-supplied fields', () => {
    const html = renderHtml(fakeRecord('final_standings', {
      competition: { name: '<script>alert(1)</script>' },
      standings: [],
      ties: [],
    }));
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});
