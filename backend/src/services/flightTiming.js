'use strict';

// Flight timing & reflight logic per Минспорт rules §5.5.7.x / §5.5.8.x.
//
// All functions are pure for ease of unit testing.

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

// ─── Reflight classification (§5.5.7.3) ──────────────────────────────────────
// Маппинг причины перелёта на её эффект:
//   { whole_group: bool, exclude_pilot_id: number|null, dq_penalty: 'last_place'|null }
//
//   falsestart                → whole group, виновнику предупреждение (§5.5.7.3.3)
//   start_zone_collision      → whole group (§5.5.7.3.4 первый абзац)
//   post_gate_clean_collision → перелёт не предусмотрен (§5.5.7.3.4 второй абзац)
//   post_gate_guilty_collision→ whole group БЕЗ виновника (§5.5.7.3.4 третий абзац)
//   landing_collision         → trat'к как post_gate_guilty_collision (§5.5.7.3.6)
//   own_damage                → перелёт не предоставляется (§5.5.7.3.7)
//   video_signal              → перелёт по запросу пилота при условиях §5.5.7.3.8
//   judge_stop                → главсудья может остановить — whole group или продолжение
//
function classifyReflightImpact(reason, opts = {}) {
  const guiltyPilotId = opts.guilty_pilot_id ?? null;
  switch (reason) {
    case 'falsestart':
    case 'start_zone_collision':
    case 'judge_stop':
      return {
        reason, whole_group: true,
        exclude_pilot_id: null, dq_penalty: null,
        warning_to: reason === 'falsestart' ? guiltyPilotId : null,
      };
    case 'post_gate_clean_collision':
      // Все правильно проходили трассу — перелёт не положен.
      return { reason, whole_group: false, exclude_pilot_id: null, dq_penalty: null };
    case 'post_gate_guilty_collision':
    case 'landing_collision':
      // Группа летит без виновника; виновнику — последнее место в этой группе.
      return {
        reason, whole_group: true,
        exclude_pilot_id: guiltyPilotId, dq_penalty: 'last_place',
      };
    case 'own_damage':
      // Поломка без чужого воздействия — перелёт не осуществляется.
      return { reason, whole_group: false, exclude_pilot_id: null, dq_penalty: null };
    case 'video_signal':
      // Перелёт только если выполнены условия §5.5.7.3.8 (видеозапись чужой
      // картинки, поднятый флаг во время вылета, заявка в течение 5 минут,
      // проблема не на стороне приёмника спортсмена). Решение принимает
      // главсудья — здесь возвращаем «conditional» без автоматики.
      return {
        reason, whole_group: true,
        exclude_pilot_id: null, dq_penalty: null,
        conditional: true,
      };
    default:
      return { reason, whole_group: false, exclude_pilot_id: null, dq_penalty: null };
  }
}

// ─── Video channel conflict detection (§5.5.7.1.4-9) ─────────────────────────
// Перед стартом вылета судья в зоне пилотов проверяет, что каналы участников
// не конфликтуют. Здесь — детерминированный детектор: ищем пилотов, у которых
// активный дрон делит канал с другим пилотом группы.
//
//   assignments: [{ pilot_id, drone_id, video_channel_id, video_channel_code }]
//
//   returns: [{ video_channel_id, video_channel_code, pilots: [pilot_id...] }]
//
// Пустой массив — конфликтов нет.
function detectChannelConflicts(assignments = []) {
  const byChannel = new Map();
  for (const a of assignments) {
    const ch = a.video_channel_id;
    if (ch == null) continue;
    if (!byChannel.has(ch)) {
      byChannel.set(ch, { video_channel_id: ch, video_channel_code: a.video_channel_code, pilots: [] });
    }
    byChannel.get(ch).pilots.push(a.pilot_id);
  }
  return Array.from(byChannel.values()).filter(c => c.pilots.length > 1);
}

module.exports = {
  summarizeLaps,
  shouldRequestWholeGroupReflight,
  classifyReflightImpact,
  detectChannelConflicts,
};
