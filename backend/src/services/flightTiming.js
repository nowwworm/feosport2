'use strict';

function summarizeLaps(laps = []) {
  const valid = laps
    .filter(lap => lap.valid !== false)
    .map(lap => ({
      ...lap,
      duration_ms: Number(lap.duration_ms),
    }))
    .filter(lap => Number.isFinite(lap.duration_ms) && lap.duration_ms > 0);

  if (!valid.length) {
    return {
      total_laps: 0,
      total_time_ms: null,
      best_lap_ms: null,
    };
  }

  return {
    total_laps: valid.length,
    total_time_ms: valid.reduce((sum, lap) => sum + lap.duration_ms, 0),
    best_lap_ms: Math.min(...valid.map(lap => lap.duration_ms)),
  };
}

function shouldRequestWholeGroupReflight(reason) {
  return ['falsestart', 'start_zone_collision'].includes(reason);
}

module.exports = {
  summarizeLaps,
  shouldRequestWholeGroupReflight,
};
