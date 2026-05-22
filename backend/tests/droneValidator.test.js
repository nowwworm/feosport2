'use strict';

// Unit tests for droneValidator. No DB required.

const { validateDrone } = require('../src/services/droneValidator');

// Spec for class 75mm, per Таблица 10.
const SPEC_75 = {
  drone_class: '75mm',
  max_takeoff_weight_g: 50,
  min_takeoff_weight_g: null,
  min_diagonal_mm: 65,
  max_diagonal_mm: 75,
  motor_max_kv: null,
  max_propeller_inches: null,
  video_frequency_ghz: '5.8',
  video_max_power_mw_min: 25,
  video_max_power_mw_max: 25,
  requires_prop_guards: true,
  requires_failsafe: true,
  min_leds: null,
  control_max_power_mw: 50,
  battery_cells: 1,
  battery_max_capacity_mah: 550,
  battery_max_cell_voltage: '4.35',
};

const SPEC_200 = {
  drone_class: '200mm',
  max_takeoff_weight_g: 650,
  min_takeoff_weight_g: null,
  min_diagonal_mm: 180,
  max_diagonal_mm: 250,
  motor_max_kv: null,
  max_propeller_inches: '5.1',
  video_frequency_ghz: '5.8',
  video_max_power_mw_min: 25,
  video_max_power_mw_max: 200,
  requires_prop_guards: false,
  requires_failsafe: true,
  min_leds: 40,
  control_max_power_mw: 50,
  battery_cells: 6,
  battery_max_capacity_mah: 1500,
  battery_max_cell_voltage: '4.20',
};

const SPEC_330 = {
  drone_class: '330mm',
  max_takeoff_weight_g: 99999,
  min_takeoff_weight_g: 850,
  min_diagonal_mm: 300,
  max_diagonal_mm: 350,
  motor_max_kv: 2000,
  max_propeller_inches: '7',
  video_frequency_ghz: '5.8',
  video_max_power_mw_min: 25,
  video_max_power_mw_max: 200,
  requires_prop_guards: false,
  requires_failsafe: true,
  min_leds: 40,
  control_max_power_mw: 50,
  battery_cells: 6,
  battery_max_capacity_mah: 2200,
  battery_max_cell_voltage: '4.20',
};

function errOnly(violations) {
  return violations.filter(v => v.severity === 'error');
}

describe('validateDrone — class mismatch', () => {
  test('drone_class != spec.drone_class is an error', () => {
    const issues = validateDrone({ drone_class: '200mm' }, SPEC_75);
    expect(issues).toEqual([
      { rule: 'drone_class', expected: '75mm', actual: '200mm', severity: 'error' },
    ]);
  });
});

describe('validateDrone — 75mm class', () => {
  const valid75 = {
    drone_class: '75mm',
    weight_g: 49,
    diagonal_mm: 72,
    battery_cells: 1,
    battery_capacity_mah: 500,
    battery_max_cell_voltage: 4.35,
    has_failsafe: true,
    has_prop_guards: true,
    video_power_mw: 25,
    control_power_mw: 25,
  };

  test('valid drone — no error violations', () => {
    expect(errOnly(validateDrone(valid75, SPEC_75))).toEqual([]);
  });

  test('overweight — error', () => {
    const errs = errOnly(validateDrone({ ...valid75, weight_g: 55 }, SPEC_75));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'max_takeoff_weight_g' }));
  });

  test('diagonal too small — error', () => {
    const errs = errOnly(validateDrone({ ...valid75, diagonal_mm: 60 }, SPEC_75));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'min_diagonal_mm' }));
  });

  test('missing failsafe — error', () => {
    const errs = errOnly(validateDrone({ ...valid75, has_failsafe: false }, SPEC_75));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'requires_failsafe' }));
  });

  test('missing prop guards — error (required for 75mm)', () => {
    const errs = errOnly(validateDrone({ ...valid75, has_prop_guards: false }, SPEC_75));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'requires_prop_guards' }));
  });

  test('wrong battery cells — error', () => {
    const errs = errOnly(validateDrone({ ...valid75, battery_cells: 2 }, SPEC_75));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'battery_cells', expected: 1, actual: 2 }));
  });

  test('battery capacity exceeded — error', () => {
    const errs = errOnly(validateDrone({ ...valid75, battery_capacity_mah: 600 }, SPEC_75));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'battery_max_capacity_mah' }));
  });

  test('cell voltage exceeded — error', () => {
    const errs = errOnly(validateDrone({ ...valid75, battery_max_cell_voltage: 4.40 }, SPEC_75));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'battery_max_cell_voltage' }));
  });

  test('missing measurements produce warnings, not errors', () => {
    const all = validateDrone({ drone_class: '75mm' }, SPEC_75);
    expect(errOnly(all)).toEqual([]);
    expect(all.some(v => v.severity === 'warning' && v.rule.endsWith('_missing'))).toBe(true);
  });
});

describe('validateDrone — 200mm class', () => {
  const valid200 = {
    drone_class: '200mm',
    weight_g: 600,
    diagonal_mm: 210,
    propeller_inches: 5,
    battery_cells: 6,
    battery_capacity_mah: 1300,
    battery_max_cell_voltage: 4.20,
    leds_count: 48,
    has_failsafe: true,
    has_prop_guards: false,  // not required for 200mm
    video_power_mw: 100,
    control_power_mw: 25,
  };

  test('valid 200mm — no errors', () => {
    expect(errOnly(validateDrone(valid200, SPEC_200))).toEqual([]);
  });

  test('propellers > 5.1 inches — error', () => {
    const errs = errOnly(validateDrone({ ...valid200, propeller_inches: 5.5 }, SPEC_200));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'max_propeller_inches' }));
  });

  test('not enough LEDs (< 40) — error', () => {
    const errs = errOnly(validateDrone({ ...valid200, leds_count: 30 }, SPEC_200));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'min_leds' }));
  });

  test('video power 220mW (above 200 max) — error', () => {
    const errs = errOnly(validateDrone({ ...valid200, video_power_mw: 220 }, SPEC_200));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'video_max_power_mw' }));
  });

  test('battery cells 4S instead of 6S — error', () => {
    const errs = errOnly(validateDrone({ ...valid200, battery_cells: 4 }, SPEC_200));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'battery_cells' }));
  });
});

describe('validateDrone — 330mm class', () => {
  const valid330 = {
    drone_class: '330mm',
    weight_g: 900,
    diagonal_mm: 320,
    motor_kv: 1900,
    propeller_inches: 6.5,
    battery_cells: 6,
    battery_capacity_mah: 2000,
    battery_max_cell_voltage: 4.20,
    leds_count: 56,
    has_failsafe: true,
  };

  test('valid 330mm — no errors', () => {
    expect(errOnly(validateDrone(valid330, SPEC_330))).toEqual([]);
  });

  test('underweight (< 850g) — error', () => {
    const errs = errOnly(validateDrone({ ...valid330, weight_g: 800 }, SPEC_330));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'min_takeoff_weight_g' }));
  });

  test('kv > 2000 — error', () => {
    const errs = errOnly(validateDrone({ ...valid330, motor_kv: 2200 }, SPEC_330));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'motor_max_kv' }));
  });

  test('propellers > 7 inches — error', () => {
    const errs = errOnly(validateDrone({ ...valid330, propeller_inches: 7.5 }, SPEC_330));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'max_propeller_inches' }));
  });

  test('diagonal > 350mm — error', () => {
    const errs = errOnly(validateDrone({ ...valid330, diagonal_mm: 380 }, SPEC_330));
    expect(errs).toContainEqual(expect.objectContaining({ rule: 'max_diagonal_mm' }));
  });
});

describe('validateDrone — input validation', () => {
  test('throws on missing drone', () => {
    expect(() => validateDrone(null, SPEC_75)).toThrow();
  });
  test('throws on missing spec', () => {
    expect(() => validateDrone({ drone_class: '75mm' }, null)).toThrow();
  });
});
