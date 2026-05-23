'use strict';

const {
  isValidPenaltyType,
  validatePenaltyInput,
} = require('../src/services/penalties');
const {
  isWithinProtestWindow,
  PROTEST_WINDOW_MINUTES,
} = require('../src/services/protests');

describe('penalties.validatePenaltyInput', () => {
  test('accepts valid pilot oral_warning', () => {
    expect(() => validatePenaltyInput({
      penalty_type: 'oral_warning', pilot_id: 1, team_id: null,
    })).not.toThrow();
  });

  test('rejects unknown penalty type', () => {
    expect(() => validatePenaltyInput({
      penalty_type: 'nuke', pilot_id: 1, team_id: null,
    })).toThrow(/invalid/);
  });

  test('rejects when both pilot and team are set', () => {
    expect(() => validatePenaltyInput({
      penalty_type: 'oral_warning', pilot_id: 1, team_id: 2,
    })).toThrow(/exactly one/);
  });

  test('rejects when neither pilot nor team is set', () => {
    expect(() => validatePenaltyInput({
      penalty_type: 'oral_warning', pilot_id: null, team_id: null,
    })).toThrow(/exactly one/);
  });

  test('points_deduction requires negative points', () => {
    expect(() => validatePenaltyInput({
      penalty_type: 'points_deduction', pilot_id: 1, points: 5,
    })).toThrow(/negative/);
    expect(() => validatePenaltyInput({
      penalty_type: 'points_deduction', pilot_id: 1, points: -3,
    })).not.toThrow();
  });

  test('isValidPenaltyType lists the five sanctioned types', () => {
    for (const t of ['oral_warning','written_warning','points_deduction',
                     'technical_defeat','disqualification']) {
      expect(isValidPenaltyType(t)).toBe(true);
    }
    expect(isValidPenaltyType('yellow_card')).toBe(false);
  });
});

describe('protests.isWithinProtestWindow', () => {
  test('heat not ended → window not open', () => {
    expect(isWithinProtestWindow(null).within).toBe(false);
    expect(isWithinProtestWindow(null).reason).toBe('heat_not_ended');
  });

  test('within 5 minutes of end → allowed', () => {
    const endedAt = new Date('2026-05-01T10:00:00Z');
    const now     = new Date('2026-05-01T10:04:30Z'); // 4m30s later
    const out = isWithinProtestWindow(endedAt, now);
    expect(out.within).toBe(true);
    expect(out.deadline_ms).toBeGreaterThan(0);
  });

  test('exactly at 5 minutes → still allowed', () => {
    const endedAt = new Date('2026-05-01T10:00:00Z');
    const now     = new Date('2026-05-01T10:05:00Z');
    expect(isWithinProtestWindow(endedAt, now).within).toBe(true);
  });

  test('after 5-minute window → rejected with window_expired', () => {
    const endedAt = new Date('2026-05-01T10:00:00Z');
    const now     = new Date('2026-05-01T10:05:01Z');
    const out = isWithinProtestWindow(endedAt, now);
    expect(out.within).toBe(false);
    expect(out.reason).toBe('window_expired');
  });

  test('accepts ISO string and numeric millis', () => {
    const endedAtISO = '2026-05-01T10:00:00Z';
    const nowMs      = new Date('2026-05-01T10:02:00Z').getTime();
    expect(isWithinProtestWindow(endedAtISO, nowMs).within).toBe(true);
  });

  test('constant is 5 minutes', () => {
    expect(PROTEST_WINDOW_MINUTES).toBe(5);
  });
});
