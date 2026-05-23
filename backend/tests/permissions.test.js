'use strict';

const { can, rolesFor, rolesIn, ROLE_GROUPS } = require('../src/services/permissions');

describe('permissions matrix', () => {
  test('admin and chief_judge cover every action group', () => {
    const actions = Object.keys(require('../src/services/permissions').PERMISSIONS);
    for (const action of actions) {
      // null = open to any authenticated; skip it
      const allowed = require('../src/services/permissions').PERMISSIONS[action];
      if (allowed === null) continue;
      expect(can('admin', action)).toBe(true);
      expect(can('chief_judge', action)).toBe(true);
    }
  });

  test('chronometer_judge can record laps + flight lifecycle but not penalties', () => {
    expect(can('chronometer_judge', 'lap.record')).toBe(true);
    expect(can('chronometer_judge', 'flight.start')).toBe(true);
    expect(can('chronometer_judge', 'flight.end')).toBe(true);
    expect(can('chronometer_judge', 'penalty.issue')).toBe(false);
    expect(can('chronometer_judge', 'protest.resolve')).toBe(false);
    expect(can('chronometer_judge', 'heat.lock')).toBe(false);
  });

  test('pilot_zone_judge can record falsestarts but not reflight decisions', () => {
    expect(can('pilot_zone_judge', 'falsestart.record')).toBe(true);
    expect(can('pilot_zone_judge', 'reflight.request')).toBe(false);
    expect(can('pilot_zone_judge', 'lap.record')).toBe(false);
  });

  test('pit_judge and senior_pit_judge can record relay handoffs', () => {
    expect(can('pit_judge', 'relay.handoff')).toBe(true);
    expect(can('senior_pit_judge', 'relay.handoff')).toBe(true);
    expect(can('chronometer_judge', 'relay.handoff')).toBe(false);
  });

  test('generic judge is excluded from pit-specialist work (§1.5.15)', () => {
    expect(can('judge', 'relay.handoff')).toBe(false);
  });

  test('generic judge still works for legacy pilot_zone + chronometer paths', () => {
    expect(can('judge', 'falsestart.record')).toBe(true);
    expect(can('judge', 'lap.record')).toBe(true);
    expect(can('judge', 'flight.start')).toBe(true);
  });

  test('tech roles cannot do scoring', () => {
    expect(can('tech_control_judge', 'score.submit')).toBe(false);
    expect(can('tech_director', 'lap.record')).toBe(false);
  });

  test('secretariat signs protocols and is in informer group', () => {
    expect(can('chief_secretary', 'protocol.sign')).toBe(true);
    expect(can('deputy_secretary', 'protocol.sign')).toBe(true);
    expect(can('chief_secretary', 'heat.read')).toBe(true);
  });

  test('pilot cannot do any judging action', () => {
    expect(can('pilot', 'lap.record')).toBe(false);
    expect(can('pilot', 'penalty.issue')).toBe(false);
    expect(can('pilot', 'relay.handoff')).toBe(false);
    expect(can('pilot', 'flight.start')).toBe(false);
  });

  test('leaderboard.read is open to any authenticated role', () => {
    expect(can('pilot', 'leaderboard.read')).toBe(true);
    expect(can('competition_doctor', 'leaderboard.read')).toBe(true);
  });

  test('unknown action defaults to admin/chief_judge only', () => {
    expect(can('admin', 'made.up')).toBe(false);  // not in catalogue
    expect(rolesFor('made.up')).toEqual(['admin', 'chief_judge']);
  });

  test('rolesFor returns the underlying allow list', () => {
    expect(rolesFor('lap.record')).toEqual(ROLE_GROUPS.chronometer);
  });

  test('rolesIn merges multiple role groups uniquely', () => {
    const merged = rolesIn('chronometer', 'pit');
    expect(merged).toEqual(expect.arrayContaining(['chronometer_judge', 'pit_judge']));
    expect(new Set(merged).size).toBe(merged.length);
  });
});
