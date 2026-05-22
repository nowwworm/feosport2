'use strict';

// Validate a registered drone against the spec from §5.12 (Таблица 10).
//
// Pure function. Takes a drone (as returned by the API) and a spec
// (from the `drone_specs` table). Returns a list of violations:
//   [{ rule: string, expected: any, actual: any, severity: 'error' | 'warning' }, ...]
//
// Empty array means the drone passes all checks.

function num(v) {
  if (v == null) return null;
  return Number(v);
}

/**
 * @param {object} drone — record from `drones` table
 * @param {object} spec  — record from `drone_specs` table for matching drone_class
 * @returns {Array<{rule, expected, actual, severity}>}
 */
function validateDrone(drone, spec) {
  if (!drone)      throw new Error('drone is required');
  if (!spec)       throw new Error('spec is required');
  if (drone.drone_class !== spec.drone_class) {
    return [{
      rule: 'drone_class',
      expected: spec.drone_class,
      actual: drone.drone_class,
      severity: 'error',
    }];
  }

  const issues = [];
  const err  = (rule, expected, actual) => issues.push({ rule, expected, actual, severity: 'error' });
  const warn = (rule, expected, actual) => issues.push({ rule, expected, actual, severity: 'warning' });

  // ─── Mass and dimensions ───────────────────────────────────────────────────
  if (drone.weight_g != null && spec.max_takeoff_weight_g != null &&
      drone.weight_g > spec.max_takeoff_weight_g) {
    err('max_takeoff_weight_g', `≤ ${spec.max_takeoff_weight_g}`, drone.weight_g);
  }
  if (drone.weight_g != null && spec.min_takeoff_weight_g != null &&
      drone.weight_g < spec.min_takeoff_weight_g) {
    err('min_takeoff_weight_g', `≥ ${spec.min_takeoff_weight_g}`, drone.weight_g);
  }
  if (drone.diagonal_mm != null) {
    if (drone.diagonal_mm < spec.min_diagonal_mm) {
      err('min_diagonal_mm', `≥ ${spec.min_diagonal_mm}`, drone.diagonal_mm);
    }
    if (drone.diagonal_mm > spec.max_diagonal_mm) {
      err('max_diagonal_mm', `≤ ${spec.max_diagonal_mm}`, drone.diagonal_mm);
    }
  }

  // ─── Motors / propellers ───────────────────────────────────────────────────
  if (drone.motor_kv != null && spec.motor_max_kv != null && drone.motor_kv > spec.motor_max_kv) {
    err('motor_max_kv', `≤ ${spec.motor_max_kv}`, drone.motor_kv);
  }
  const specMaxProp = num(spec.max_propeller_inches);
  const droneProp   = num(drone.propeller_inches);
  if (droneProp != null && specMaxProp != null && droneProp > specMaxProp) {
    err('max_propeller_inches', `≤ ${specMaxProp}`, droneProp);
  }

  // ─── Video transmitter ─────────────────────────────────────────────────────
  // (Frequency check is implicit via video_channel_id — all R-band entries are
  // 5.8 GHz; pilots cannot select non-R-band channels because the catalogue
  // only contains R-band.)
  if (drone.video_power_mw != null) {
    if (drone.video_power_mw < spec.video_max_power_mw_min) {
      err('video_min_power_mw', `≥ ${spec.video_max_power_mw_min}`, drone.video_power_mw);
    }
    if (spec.video_max_power_mw_max != null &&
        drone.video_power_mw > spec.video_max_power_mw_max) {
      err('video_max_power_mw', `≤ ${spec.video_max_power_mw_max}`, drone.video_power_mw);
    }
  }
  if (drone.control_power_mw != null && drone.control_power_mw > spec.control_max_power_mw) {
    err('control_max_power_mw', `≤ ${spec.control_max_power_mw}`, drone.control_power_mw);
  }

  // ─── Safety features ───────────────────────────────────────────────────────
  if (spec.requires_failsafe && drone.has_failsafe === false) {
    err('requires_failsafe', true, false);
  }
  if (spec.requires_prop_guards && drone.has_prop_guards === false) {
    err('requires_prop_guards', true, false);
  }
  if (spec.min_leds != null && drone.leds_count != null && drone.leds_count < spec.min_leds) {
    err('min_leds', `≥ ${spec.min_leds}`, drone.leds_count);
  }

  // ─── Battery ───────────────────────────────────────────────────────────────
  if (drone.battery_cells != null && drone.battery_cells !== spec.battery_cells) {
    err('battery_cells', spec.battery_cells, drone.battery_cells);
  }
  if (drone.battery_capacity_mah != null &&
      drone.battery_capacity_mah > spec.battery_max_capacity_mah) {
    err('battery_max_capacity_mah', `≤ ${spec.battery_max_capacity_mah}`, drone.battery_capacity_mah);
  }
  const specMaxV   = num(spec.battery_max_cell_voltage);
  const droneCellV = num(drone.battery_max_cell_voltage);
  if (droneCellV != null && specMaxV != null && droneCellV > specMaxV) {
    err('battery_max_cell_voltage', `≤ ${specMaxV}`, droneCellV);
  }

  // ─── Soft warnings for missing measurements ────────────────────────────────
  const requiredMeasurements = [
    'weight_g', 'diagonal_mm', 'battery_cells', 'battery_capacity_mah',
    'has_failsafe',
  ];
  for (const field of requiredMeasurements) {
    if (drone[field] == null) {
      warn(`${field}_missing`, 'measured value', null);
    }
  }

  return issues;
}

module.exports = { validateDrone };
