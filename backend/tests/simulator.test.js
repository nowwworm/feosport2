'use strict';

const { classifyDisconnect } = require('../src/services/simulator');

describe('classifyDisconnect', () => {
  test('empty history → continue', () => {
    expect(classifyDisconnect([])).toEqual({ verdict: 'continue' });
  });

  test('any scope=all event → replay_group', () => {
    const out = classifyDisconnect([
      { scope: 'single', pilot_id: 1 },
      { scope: 'all',    pilot_id: null },
    ]);
    expect(out.verdict).toBe('replay_group');
    expect(out.last_event.scope).toBe('all');
  });

  test('single pilot below default threshold → continue', () => {
    const out = classifyDisconnect([
      { scope: 'single', pilot_id: 1 },
      { scope: 'single', pilot_id: 1 },
    ]);
    expect(out.verdict).toBe('continue');
  });

  test('single pilot at default threshold → technical_defeat', () => {
    const out = classifyDisconnect([
      { scope: 'single', pilot_id: 7 },
      { scope: 'single', pilot_id: 7 },
      { scope: 'single', pilot_id: 7 },
    ]);
    expect(out.verdict).toBe('technical_defeat');
    expect(out.repeat_offender_pilot_id).toBe(7);
    expect(out.attempts).toBe(3);
  });

  test('threshold override via competition setting', () => {
    const out = classifyDisconnect([
      { scope: 'single', pilot_id: 7 },
      { scope: 'single', pilot_id: 7 },
    ], { maxAttempts: 2 });
    expect(out.verdict).toBe('technical_defeat');
    expect(out.repeat_offender_pilot_id).toBe(7);
  });

  test('single-scope without pilot_id is ignored', () => {
    const out = classifyDisconnect([
      { scope: 'single', pilot_id: null },
      { scope: 'single', pilot_id: null },
      { scope: 'single', pilot_id: null },
    ]);
    expect(out.verdict).toBe('continue');
  });

  test('different pilots each within threshold → continue', () => {
    const out = classifyDisconnect([
      { scope: 'single', pilot_id: 1 },
      { scope: 'single', pilot_id: 2 },
      { scope: 'single', pilot_id: 3 },
    ]);
    expect(out.verdict).toBe('continue');
  });
});
