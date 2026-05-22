'use strict';

// Unit tests for the pure leaderboard ranking function.
// Tests sorting semantics for both qualification modes and DNF/DSQ placement.

const { rankHeatParticipants } = require('../src/services/leaderboard');

describe('rankHeatParticipants', () => {
  test('laps_time: more laps wins, then lower total time wins', () => {
    const rows = [
      { pilot_id: 1, total_laps: 3, total_time_ms: 30000, best_lap_ms: 9500 },
      { pilot_id: 2, total_laps: 3, total_time_ms: 28500, best_lap_ms: 9000 },
      { pilot_id: 3, total_laps: 2, total_time_ms: 18000, best_lap_ms: 8500 },
    ];
    const out = rankHeatParticipants(rows, 'laps_time');
    expect(out.map(r => r.pilot_id)).toEqual([2, 1, 3]);
    expect(out.map(r => r.place)).toEqual([1, 2, 3]);
  });

  test('laps_time: best lap breaks tie when laps and total time match', () => {
    const rows = [
      { pilot_id: 1, total_laps: 3, total_time_ms: 30000, best_lap_ms: 9800 },
      { pilot_id: 2, total_laps: 3, total_time_ms: 30000, best_lap_ms: 9200 },
    ];
    const out = rankHeatParticipants(rows, 'laps_time');
    expect(out.map(r => r.pilot_id)).toEqual([2, 1]);
  });

  test('max_laps: more laps wins, then best lap wins (not total time)', () => {
    const rows = [
      { pilot_id: 1, total_laps: 5, total_time_ms: 60000, best_lap_ms: 11000 },
      { pilot_id: 2, total_laps: 5, total_time_ms: 58000, best_lap_ms: 12000 },
      { pilot_id: 3, total_laps: 4, total_time_ms: 40000, best_lap_ms: 9000 },
    ];
    const out = rankHeatParticipants(rows, 'max_laps');
    // pilot 1 has slower total but better best_lap → wins tiebreaker
    expect(out.map(r => r.pilot_id)).toEqual([1, 2, 3]);
  });

  test('DNF pilots are placed after finishers with status=dnf and null place', () => {
    const rows = [
      { pilot_id: 1, total_laps: 3, total_time_ms: 30000, best_lap_ms: 9500 },
      { pilot_id: 2, total_laps: 0, total_time_ms: null, best_lap_ms: null, dnf: true },
      { pilot_id: 3, total_laps: 2, total_time_ms: 20000, best_lap_ms: 9000 },
    ];
    const out = rankHeatParticipants(rows, 'laps_time');
    expect(out[0].pilot_id).toBe(1);
    expect(out[1].pilot_id).toBe(3);
    expect(out[2].pilot_id).toBe(2);
    expect(out[2].status).toBe('dnf');
    expect(out[2].place).toBeNull();
  });

  test('DSQ ranks below DNF (sanction worse than non-finish)', () => {
    const rows = [
      { pilot_id: 1, total_laps: 0, total_time_ms: null, best_lap_ms: null, dsq: true },
      { pilot_id: 2, total_laps: 0, total_time_ms: null, best_lap_ms: null, dnf: true },
      { pilot_id: 3, total_laps: 2, total_time_ms: 20000, best_lap_ms: 9000 },
    ];
    const out = rankHeatParticipants(rows, 'laps_time');
    expect(out.map(r => r.pilot_id)).toEqual([3, 2, 1]);
    expect(out[2].status).toBe('dsq');
  });

  test('zero-lap finisher (no DNF) ranks below any lap-completer', () => {
    const rows = [
      { pilot_id: 1, total_laps: 0, total_time_ms: null, best_lap_ms: null },
      { pilot_id: 2, total_laps: 1, total_time_ms: 12000, best_lap_ms: 12000 },
    ];
    const out = rankHeatParticipants(rows, 'laps_time');
    expect(out.map(r => r.pilot_id)).toEqual([2, 1]);
    expect(out[0].place).toBe(1);
    expect(out[1].place).toBe(2);
  });

  test('unknown mode falls back to laps_time semantics', () => {
    const rows = [
      { pilot_id: 1, total_laps: 3, total_time_ms: 30000, best_lap_ms: 9500 },
      { pilot_id: 2, total_laps: 3, total_time_ms: 28500, best_lap_ms: 9800 },
    ];
    const out = rankHeatParticipants(rows, 'made_up_mode');
    expect(out.map(r => r.pilot_id)).toEqual([2, 1]);
  });

  test('empty input returns empty array', () => {
    expect(rankHeatParticipants([], 'laps_time')).toEqual([]);
  });

  test('preserves pilot metadata in output', () => {
    const rows = [{
      pilot_id: 7,
      first_name: 'Test',
      last_name: 'Pilot',
      team: 'Skyforce',
      total_laps: 2,
      total_time_ms: 24000,
      best_lap_ms: 11500,
    }];
    const out = rankHeatParticipants(rows, 'laps_time');
    expect(out[0]).toMatchObject({
      pilot_id: 7,
      first_name: 'Test',
      last_name: 'Pilot',
      team: 'Skyforce',
      place: 1,
      status: 'ok',
    });
  });
});
