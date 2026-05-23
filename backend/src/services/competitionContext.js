'use strict';

// Competition context loader — единая точка для получения дисциплины,
// системы (4/8 vs 2/4), размера группы и т.п. для одного соревнования.
//
// Полезно везде, где код должен ветвиться по типу дисциплины:
//   * channel-conflicts / drone validation — только для category='class'
//   * 4/8 система — только для category='simulator' (§1.4.4)
//   * физический пит-стоп при relay — только для class_*_team
//
// Все потребители должны импортировать `isSimulator(ctx)` /
// `isPhysicalClass(ctx)` чтобы решение «что считается симулятором» жило
// в одном месте.

const pool = require('../config/db');

async function loadCompetitionContext(competitionId) {
  const { rows } = await pool.query(
    `SELECT c.id,
            c.name,
            c.status,
            c.discipline_id,
            c.race_system_id,
            d.code        AS discipline_code,
            d.category    AS discipline_category,
            d.is_team     AS discipline_is_team,
            rs.code       AS race_system_code,
            rs.group_size AS race_group_size,
            rs.advance_count AS race_advance_count
       FROM competitions c
       LEFT JOIN disciplines  d  ON d.id  = c.discipline_id
       LEFT JOIN race_systems rs ON rs.id = c.race_system_id
      WHERE c.id = $1`,
    [competitionId]
  );
  return rows[0] || null;
}

async function loadHeatCompetitionContext(heatId) {
  const { rows } = await pool.query(
    'SELECT competition_id FROM heats WHERE id = $1',
    [heatId]
  );
  if (!rows.length) return null;
  return loadCompetitionContext(rows[0].competition_id);
}

function isSimulator(ctx) {
  return !!ctx && ctx.discipline_category === 'simulator';
}

function isPhysicalClass(ctx) {
  return !!ctx && ctx.discipline_category === 'class';
}

function isTeam(ctx) {
  return !!ctx && ctx.discipline_is_team === true;
}

module.exports = {
  loadCompetitionContext,
  loadHeatCompetitionContext,
  isSimulator,
  isPhysicalClass,
  isTeam,
};
