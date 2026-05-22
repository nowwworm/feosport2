'use strict';

// Unit tests for the pure team relay helpers.

const {
  validateExchangeWindow,
  aggregateLapsByTeam,
} = require('../src/services/teamRelay');

describe('validateExchangeWindow', () => {
  test('handoff within the window is valid with null violation', () => {
    const out = validateExchangeWindow({ exchange_window_ms: 5000, exchange_duration_ms: 4200 });
    expect(out.is_valid).toBe(true);
    expect(out.violation_ms).toBeNull();
  });

  test('handoff exceeding the window flags violation_ms', () => {
    const out = validateExchangeWindow({ exchange_window_ms: 5000, exchange_duration_ms: 6300 });
    expect(out.is_valid).toBe(false);
    expect(out.violation_ms).toBe(1300);
  });

  test('exact-edge handoff at window length is still valid', () => {
    const out = validateExchangeWindow({ exchange_window_ms: 5000, exchange_duration_ms: 5000 });
    expect(out.is_valid).toBe(true);
  });

  test('missing window or duration defaults to valid (no measurement)', () => {
    expect(validateExchangeWindow({ exchange_window_ms: null, exchange_duration_ms: 3000 }).is_valid).toBe(true);
    expect(validateExchangeWindow({ exchange_window_ms: 5000, exchange_duration_ms: null }).is_valid).toBe(true);
  });
});

describe('aggregateLapsByTeam', () => {
  const teams = [
    { team_id: 10, name: 'Team Alpha' },
    { team_id: 20, name: 'Team Bravo' },
  ];
  const members = [
    { team_id: 10, pilot_id: 1 },
    { team_id: 10, pilot_id: 2 },
    { team_id: 20, pilot_id: 3 },
  ];

  test('sums laps per team and finds best lap', () => {
    const laps = [
      { pilot_id: 1, duration_ms: 10000 },
      { pilot_id: 1, duration_ms: 11000 },
      { pilot_id: 2, duration_ms: 9500 },
      { pilot_id: 3, duration_ms: 12000 },
    ];
    const out = aggregateLapsByTeam(laps, members, teams);
    const alpha = out.find(t => t.team_id === 10);
    const bravo = out.find(t => t.team_id === 20);
    expect(alpha.total_laps).toBe(3);
    expect(alpha.total_time_ms).toBe(30500);
    expect(alpha.best_lap_ms).toBe(9500);
    expect(bravo.total_laps).toBe(1);
    expect(bravo.best_lap_ms).toBe(12000);
  });

  test('teams with no laps have null totals', () => {
    const out = aggregateLapsByTeam([], members, teams);
    expect(out.every(t => t.total_laps === 0 && t.total_time_ms === null)).toBe(true);
  });

  test('laps from pilots not on any team are ignored', () => {
    const laps = [
      { pilot_id: 999, duration_ms: 10000 },
      { pilot_id: 1, duration_ms: 11000 },
    ];
    const out = aggregateLapsByTeam(laps, members, teams);
    expect(out.find(t => t.team_id === 10).total_laps).toBe(1);
  });
});
