'use strict';

const {
  summarizeLaps,
  shouldRequestWholeGroupReflight,
} = require('../src/services/flightTiming');

describe('flightTiming', () => {
  test('summarizeLaps returns totals and best lap for valid laps', () => {
    expect(summarizeLaps([
      { lap_number: 1, duration_ms: 12000, valid: true },
      { lap_number: 2, duration_ms: 11000, valid: true },
      { lap_number: 3, duration_ms: 13000, valid: true },
    ])).toEqual({
      total_laps: 3,
      total_time_ms: 36000,
      best_lap_ms: 11000,
    });
  });

  test('summarizeLaps ignores invalid laps', () => {
    expect(summarizeLaps([
      { lap_number: 1, duration_ms: 12000, valid: true },
      { lap_number: 2, duration_ms: 8000, valid: false },
    ])).toEqual({
      total_laps: 1,
      total_time_ms: 12000,
      best_lap_ms: 12000,
    });
  });

  test('summarizeLaps handles empty data', () => {
    expect(summarizeLaps([])).toEqual({
      total_laps: 0,
      total_time_ms: null,
      best_lap_ms: null,
    });
  });

  test('false start and start-zone collision request whole-group reflight', () => {
    expect(shouldRequestWholeGroupReflight('falsestart')).toBe(true);
    expect(shouldRequestWholeGroupReflight('start_zone_collision')).toBe(true);
    expect(shouldRequestWholeGroupReflight('pilot_fault_after_first_gate')).toBe(false);
  });
});
