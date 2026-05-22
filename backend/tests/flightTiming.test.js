'use strict';

const {
  summarizeLaps,
  shouldRequestWholeGroupReflight,
  classifyReflightImpact,
  detectChannelConflicts,
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

  describe('classifyReflightImpact (§5.5.7.3)', () => {
    test('falsestart — whole group, warning to guilty', () => {
      const r = classifyReflightImpact('falsestart', { guilty_pilot_id: 42 });
      expect(r.whole_group).toBe(true);
      expect(r.exclude_pilot_id).toBeNull();
      expect(r.warning_to).toBe(42);
    });

    test('start_zone_collision — whole group, no exclusion', () => {
      const r = classifyReflightImpact('start_zone_collision');
      expect(r.whole_group).toBe(true);
      expect(r.exclude_pilot_id).toBeNull();
    });

    test('post_gate_clean_collision — no reflight (§5.5.7.3.4 ¶2)', () => {
      const r = classifyReflightImpact('post_gate_clean_collision');
      expect(r.whole_group).toBe(false);
    });

    test('post_gate_guilty_collision — reflight without guilty pilot', () => {
      const r = classifyReflightImpact('post_gate_guilty_collision', { guilty_pilot_id: 17 });
      expect(r.whole_group).toBe(true);
      expect(r.exclude_pilot_id).toBe(17);
      expect(r.dq_penalty).toBe('last_place');
    });

    test('landing_collision treated as guilty collision (§5.5.7.3.6)', () => {
      const r = classifyReflightImpact('landing_collision', { guilty_pilot_id: 99 });
      expect(r.exclude_pilot_id).toBe(99);
      expect(r.dq_penalty).toBe('last_place');
    });

    test('own_damage — no reflight (§5.5.7.3.7)', () => {
      const r = classifyReflightImpact('own_damage');
      expect(r.whole_group).toBe(false);
    });

    test('video_signal — conditional reflight (§5.5.7.3.8)', () => {
      const r = classifyReflightImpact('video_signal');
      expect(r.whole_group).toBe(true);
      expect(r.conditional).toBe(true);
    });

    test('unknown reason — no automatic reflight', () => {
      const r = classifyReflightImpact('weather');
      expect(r.whole_group).toBe(false);
    });
  });

  describe('detectChannelConflicts (§5.5.7.1.4-9)', () => {
    test('no conflicts when channels unique', () => {
      const result = detectChannelConflicts([
        { pilot_id: 1, video_channel_id: 10, video_channel_code: 'R1' },
        { pilot_id: 2, video_channel_id: 11, video_channel_code: 'R2' },
        { pilot_id: 3, video_channel_id: 12, video_channel_code: 'R3' },
      ]);
      expect(result).toEqual([]);
    });

    test('detects two pilots on the same channel', () => {
      const result = detectChannelConflicts([
        { pilot_id: 1, video_channel_id: 10, video_channel_code: 'R1' },
        { pilot_id: 2, video_channel_id: 10, video_channel_code: 'R1' },
        { pilot_id: 3, video_channel_id: 11, video_channel_code: 'R2' },
      ]);
      expect(result.length).toBe(1);
      expect(result[0].video_channel_code).toBe('R1');
      expect(result[0].pilots.sort()).toEqual([1, 2]);
    });

    test('ignores pilots without an assigned channel', () => {
      const result = detectChannelConflicts([
        { pilot_id: 1, video_channel_id: null, video_channel_code: null },
        { pilot_id: 2, video_channel_id: null, video_channel_code: null },
      ]);
      expect(result).toEqual([]);
    });

    test('detects 3-way conflict on the same channel', () => {
      const result = detectChannelConflicts([
        { pilot_id: 1, video_channel_id: 10, video_channel_code: 'R1' },
        { pilot_id: 2, video_channel_id: 10, video_channel_code: 'R1' },
        { pilot_id: 3, video_channel_id: 10, video_channel_code: 'R1' },
      ]);
      expect(result[0].pilots.length).toBe(3);
    });
  });
});
