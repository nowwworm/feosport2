'use strict';

// Stages & groups API — управление этапами соревнования (Раздел 1.4 правил).
//
//   GET  /api/competitions/:id/stages              — все этапы с группами
//   POST /api/competitions/:id/stages/qualification — создать quals из списка допущенных
//                                                     (auto-distribute по жеребьёвке)
//   POST /api/competitions/:id/stages/advance      — построить следующий этап из результатов текущего
//   GET  /api/stages/:id                           — этап с группами и участниками
//   GET  /api/groups/:id                           — группа с участниками
//   PATCH /api/group-participants/:id              — судья фиксирует место (chief_judge+)

const router = require('express').Router({ mergeParams: true });
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const {
  drawQualificationGroups,
  buildFirstKnockout,
  buildNextKnockout,
  rankQualificationParticipants,
} = require('../services/bracket');
const { computeStageLeaderboard } = require('../services/leaderboard');
const { computeStageScores } = require('../services/scoring');

const STAGE_ORDER = {
  qualification: 1, round_of_16: 2, quarterfinal: 3, semifinal: 4, final: 5,
};

async function loadCompetition(competitionId) {
  const { rows } = await pool.query(
    `SELECT c.*,
            d.code      AS discipline_code,
            d.category  AS discipline_category,
            d.is_team   AS discipline_is_team,
            rs.code     AS race_system_code,
            rs.group_size AS race_group_size
       FROM competitions c
       LEFT JOIN disciplines d  ON d.id  = c.discipline_id
       LEFT JOIN race_systems rs ON rs.id = c.race_system_id
      WHERE c.id = $1`,
    [competitionId]
  );
  return rows[0] || null;
}

function normalizeGroupSize(value) {
  const groupSize = Number(value);
  if (![4, 8].includes(groupSize)) {
    throw new Error('group_size_must_be_4_or_8');
  }
  return groupSize;
}

function expectedAdvancersPerGroup(stageType, system) {
  if (stageType === 'round_of_16') return 2;
  if (stageType === 'quarterfinal') return system === 'four_of_eight' ? 4 : 2;
  if (stageType === 'semifinal') return system === 'four_of_eight' ? 4 : 2;
  throw new Error(`cannot build next stage from ${stageType}`);
}

function assertCompletePlacements(groupRows, stageType, system) {
  const expected = expectedAdvancersPerGroup(stageType, system);
  for (const group of groupRows) {
    const placements = Array.isArray(group.placements) ? group.placements : [];
    for (let place = 1; place <= expected; place++) {
      if (!placements.some(p => Number(p.place) === place)) {
        throw new Error('previous_stage_results_incomplete');
      }
    }
  }
}

function normalizeQualificationConfig(input = {}) {
  const mode = input.qualification_mode || input.qualificationMode || 'laps_time';
  if (!['laps_time', 'max_laps'].includes(mode)) {
    throw new Error('qualification_mode_must_be_laps_time_or_max_laps');
  }
  const targetLaps = input.target_laps ?? input.targetLaps ?? null;
  const timeLimitSeconds = input.time_limit_seconds ?? input.timeLimitSeconds ?? null;

  if (mode === 'laps_time' && (!Number.isInteger(Number(targetLaps)) || Number(targetLaps) <= 0)) {
    throw new Error('target_laps_required_for_laps_time');
  }
  if (mode === 'max_laps' &&
      (!Number.isInteger(Number(timeLimitSeconds)) || Number(timeLimitSeconds) <= 0)) {
    throw new Error('time_limit_seconds_required_for_max_laps');
  }

  return {
    qualification_mode: mode,
    target_laps: mode === 'laps_time' ? Number(targetLaps) : null,
    time_limit_seconds: mode === 'max_laps' ? Number(timeLimitSeconds) : null,
  };
}

function isClientStageError(err) {
  return [
    'group_size_must_be_4_or_8',
    'qualification_mode_must_be_laps_time_or_max_laps',
    'target_laps_required_for_laps_time',
    'time_limit_seconds_required_for_max_laps',
    'qualification_mode_required',
  ].includes(err.message);
}

async function loadQualificationRanking(client, competitionId) {
  const { rows: stageRows } = await client.query(
    `SELECT * FROM stages WHERE competition_id = $1 AND stage_type = 'qualification'`,
    [competitionId]
  );
  if (!stageRows.length) throw new Error('qualification_stage_not_found');

  const { rows } = await client.query(
    `SELECT gp.*
       FROM group_participants gp
       JOIN groups g ON g.id = gp.group_id
      WHERE g.stage_id = $1
      ORDER BY g.group_number, gp.slot`,
    [stageRows[0].id]
  );
  return rankQualificationParticipants(rows, stageRows[0]);
}

async function persistStage(client, competitionId, stageType, groups, options = {}) {
  const ordinal = STAGE_ORDER[stageType];
  if (!ordinal) throw new Error(`unknown stage_type ${stageType}`);

  const { rows: [stage] } = await client.query(
    `INSERT INTO stages
       (competition_id, stage_type, ordinal, status, qualification_mode, target_laps, time_limit_seconds)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6)
     RETURNING *`,
    [
      competitionId,
      stageType,
      ordinal,
      options.qualification_mode || null,
      options.target_laps || null,
      options.time_limit_seconds || null,
    ]
  );

  for (const g of groups) {
    const { rows: [grp] } = await client.query(
      `INSERT INTO groups (stage_id, group_number) VALUES ($1, $2) RETURNING *`,
      [stage.id, g.group_number]
    );
    for (let i = 0; i < g.slots.length; i++) {
      const subjectId = g.slots[i];
      const seed = g._seeds ? g._seeds[i] : null;
      // По умолчанию участники в `slots` — pilot_id; team-вариант обрабатывает caller.
      await client.query(
        `INSERT INTO group_participants
           (group_id, pilot_id, team_id, slot, seed)
         VALUES ($1, $2, $3, $4, $5)`,
        [grp.id, g._isTeam ? null : subjectId, g._isTeam ? subjectId : null, i + 1, seed]
      );
    }
  }
  return stage;
}

// ─── GET stages for a competition ────────────────────────────────────────────
router.get('/competitions/:id/stages', authenticate, async (req, res) => {
  try {
    const { rows: stages } = await pool.query(
      `SELECT s.*,
              (SELECT json_agg(json_build_object(
                  'id', g.id,
                  'group_number', g.group_number,
                  'participants', (
                    SELECT json_agg(json_build_object(
                        'id', gp.id, 'slot', gp.slot, 'seed', gp.seed,
                        'pilot_id', gp.pilot_id, 'team_id', gp.team_id,
                        'pilot_first_name', p.first_name,
                        'pilot_last_name', p.last_name,
                        'pilot_team', p.team,
                        'team_name', t.name,
                        'finish_place', gp.finish_place, 'points', gp.points,
                        'attendance_status', gp.attendance_status,
                        'replaced_pilot_id', gp.replaced_pilot_id,
                        'replaced_team_id', gp.replaced_team_id,
                        'qualification_total_laps', gp.qualification_total_laps,
                        'qualification_total_time_ms', gp.qualification_total_time_ms,
                        'qualification_best_lap_ms', gp.qualification_best_lap_ms
                    ) ORDER BY gp.slot)
                      FROM group_participants gp
                      LEFT JOIN pilots p ON p.id = gp.pilot_id
                      LEFT JOIN teams t ON t.id = gp.team_id
                     WHERE gp.group_id = g.id)
              ) ORDER BY g.group_number)
                FROM groups g WHERE g.stage_id = s.id) AS groups
         FROM stages s
        WHERE s.competition_id = $1
        ORDER BY s.ordinal`,
      [req.params.id]
    );
    res.json(stages);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

// ─── POST start qualification ────────────────────────────────────────────────
// Body: { admitted_pilot_ids: [number], group_size?: 4|8 }
router.post('/competitions/:id/stages/qualification',
  authenticate, authorize('admin', 'chief_judge'),
  async (req, res) => {
    const { admitted_pilot_ids, group_size } = req.body;
    if (!Array.isArray(admitted_pilot_ids) || admitted_pilot_ids.length === 0) {
      return res.status(400).json({ error: 'admitted_pilot_ids[] is required' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const comp = await loadCompetition(req.params.id);
      if (!comp) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Competition not found' });
      }

      // Существующий quals-этап → отказываем (надо явно удалить).
      const { rows: existing } = await client.query(
        `SELECT id FROM stages WHERE competition_id = $1 AND stage_type = 'qualification'`,
        [req.params.id]
      );
      if (existing.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'qualification_already_exists' });
      }

      const configuredGroupSize = group_size ?? comp.race_group_size ?? 4;
      const gs = normalizeGroupSize(configuredGroupSize);
      const qualificationConfig = normalizeQualificationConfig(req.body);
      const groups = drawQualificationGroups(admitted_pilot_ids, { groupSize: gs });

      const stage = await persistStage(
        client,
        req.params.id,
        'qualification',
        groups,
        qualificationConfig
      );
      await client.query('COMMIT');
      res.status(201).json({ stage, groups });
    } catch (err) {
      await client.query('ROLLBACK');
      const status = isClientStageError(err) ? 400 : 500;
      (console.error(err), res.status(status).json({ error: status === 400 || status === 404 || status === 409 ? err.message : 'Internal Server Error' }));
    } finally {
      client.release();
    }
  }
);

// ─── POST advance to next stage ──────────────────────────────────────────────
// Тело: { from_stage_type?, ranked_qualifiers?: [pilot_id...] }
//
// Логика:
//   from='qualification' → buildFirstKnockout(rankedQualifiers, system, playoffSize, category)
//   from=knockout       → buildNextKnockout(prevGroups results)
//
// Если `ranked_qualifiers` не передан и from='qualification' — пытаемся собрать
// автоматически из результатов вылетов квалификации (Phase 5+).
router.post('/competitions/:id/stages/advance',
  authenticate, authorize('admin', 'chief_judge'),
  async (req, res) => {
    const { from_stage_type, ranked_qualifiers } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const comp = await loadCompetition(req.params.id);
      if (!comp) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Competition not found' });
      }
      if (!comp.race_system_code || !comp.discipline_category) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'competition_missing_discipline_or_race_system',
        });
      }
      if (!comp.playoff_size) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'competition_missing_playoff_size' });
      }
      if (comp.discipline_category === 'class' && comp.race_system_code === 'four_of_eight') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'four_of_eight_only_supported_for_simulator' });
      }

      let result;
      if (from_stage_type === 'qualification' || !from_stage_type) {
        const rankedQualifiers = Array.isArray(ranked_qualifiers) && ranked_qualifiers.length
          ? ranked_qualifiers
          : await loadQualificationRanking(client, req.params.id);
        result = buildFirstKnockout({
          rankedQualifiers,
          system:           comp.race_system_code,
          playoffSize:      comp.playoff_size,
          category:         comp.discipline_category,
        });
      } else {
        // Load prev stage groups + placements.
        const { rows: prevStage } = await client.query(
          `SELECT id FROM stages WHERE competition_id = $1 AND stage_type = $2`,
          [req.params.id, from_stage_type]
        );
        if (!prevStage.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: `previous stage ${from_stage_type} not found` });
        }
        const { rows: groupRows } = await client.query(
          `SELECT g.id, g.group_number,
                  COALESCE(json_agg(
                    json_build_object(
                      'place', gp.finish_place,
                      'pilot_id', COALESCE(gp.pilot_id, gp.team_id)
                    )
                    ORDER BY gp.finish_place
                  ) FILTER (WHERE gp.finish_place IS NOT NULL), '[]'::json) AS placements
             FROM groups g
             LEFT JOIN group_participants gp ON gp.group_id = g.id
            WHERE g.stage_id = $1
            GROUP BY g.id, g.group_number
            ORDER BY g.group_number`,
          [prevStage[0].id]
        );
        try {
          assertCompletePlacements(groupRows, from_stage_type, comp.race_system_code);
        } catch (err) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: err.message,
          });
        }
        result = buildNextKnockout({
          prevGroups:     groupRows,
          prevStageType:  from_stage_type,
          system:         comp.race_system_code,
          category:       comp.discipline_category,
        });
      }

      // Reject if next stage already exists.
      const { rows: dup } = await client.query(
        `SELECT id FROM stages WHERE competition_id = $1 AND stage_type = $2`,
        [req.params.id, result.stage_type]
      );
      if (dup.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `${result.stage_type}_already_exists` });
      }

      const stage = await persistStage(client, req.params.id, result.stage_type, result.groups);
      await client.query('COMMIT');
      res.status(201).json({ stage, groups: result.groups, stage_type: result.stage_type });
    } catch (err) {
      await client.query('ROLLBACK');
      const status = isClientStageError(err) ||
        err.message === 'qualification_stage_not_found' ||
        /^not enough qualifiers/.test(err.message)
        ? 400
        : 500;
      (console.error(err), res.status(status).json({ error: status === 400 || status === 404 || status === 409 ? err.message : 'Internal Server Error' }));
    } finally {
      client.release();
    }
  }
);

// GET /api/stages/:id/scores — points + tie detection per §5.17.
router.get('/stages/:id/scores', authenticate, async (req, res) => {
  try {
    const scored = await computeStageScores(req.params.id);
    if (!scored) return res.status(404).json({ error: 'Stage not found' });
    res.json(scored);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

// GET /api/stages/:id/leaderboard — spectator-facing standings across all groups.
router.get('/stages/:id/leaderboard', authenticate, async (req, res) => {
  try {
    const board = await computeStageLeaderboard(req.params.id);
    if (!board) return res.status(404).json({ error: 'Stage not found' });
    res.json(board);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

// ─── GET single stage / group ────────────────────────────────────────────────
router.get('/stages/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM stages WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const { rows: groups } = await pool.query(
      `SELECT g.*,
              (SELECT json_agg(json_build_object(
                  'id', gp.id, 'slot', gp.slot, 'seed', gp.seed,
                  'pilot_id', gp.pilot_id, 'team_id', gp.team_id,
                  'pilot_first_name', p.first_name,
                  'pilot_last_name', p.last_name,
                  'pilot_team', p.team,
                  'team_name', t.name,
                  'finish_place', gp.finish_place, 'points', gp.points,
                  'attendance_status', gp.attendance_status,
                  'replaced_pilot_id', gp.replaced_pilot_id,
                  'replaced_team_id', gp.replaced_team_id,
                  'qualification_total_laps', gp.qualification_total_laps,
                  'qualification_total_time_ms', gp.qualification_total_time_ms,
                  'qualification_best_lap_ms', gp.qualification_best_lap_ms
              ) ORDER BY gp.slot)
                 FROM group_participants gp
                 LEFT JOIN pilots p ON p.id = gp.pilot_id
                 LEFT JOIN teams t ON t.id = gp.team_id
                WHERE gp.group_id = g.id) AS participants
         FROM groups g WHERE g.stage_id = $1 ORDER BY g.group_number`,
      [req.params.id]
    );
    res.json({ ...rows[0], groups });
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.get('/groups/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM groups WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const { rows: participants } = await pool.query(
      `SELECT gp.*,
              p.first_name AS pilot_first_name,
              p.last_name AS pilot_last_name,
              p.team AS pilot_team,
              t.name AS team_name
         FROM group_participants gp
         LEFT JOIN pilots p ON p.id = gp.pilot_id
         LEFT JOIN teams t ON t.id = gp.team_id
        WHERE gp.group_id = $1
        ORDER BY gp.slot`,
      [req.params.id]
    );
    res.json({ ...rows[0], participants });
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

// PATCH /api/group-participants/:id
// Body: { finish_place, points, attendance_status, qualification_total_laps,
//         qualification_total_time_ms, qualification_best_lap_ms }
router.patch('/group-participants/:id',
  authenticate, authorize('admin', 'chief_judge'),
  async (req, res) => {
    const {
      finish_place,
      points,
      attendance_status,
      qualification_total_laps,
      qualification_total_time_ms,
      qualification_best_lap_ms,
    } = req.body;
    const updates = [];
    const values  = [];
    if (finish_place !== undefined) { values.push(finish_place); updates.push(`finish_place = $${values.length}`); }
    if (points !== undefined)       { values.push(points);       updates.push(`points = $${values.length}`); }
    if (attendance_status !== undefined) {
      if (!['present', 'no_show', 'replaced'].includes(attendance_status)) {
        return res.status(400).json({ error: 'attendance_status_invalid' });
      }
      values.push(attendance_status);
      updates.push(`attendance_status = $${values.length}`);
    }
    if (qualification_total_laps !== undefined) {
      values.push(qualification_total_laps);
      updates.push(`qualification_total_laps = $${values.length}`);
    }
    if (qualification_total_time_ms !== undefined) {
      values.push(qualification_total_time_ms);
      updates.push(`qualification_total_time_ms = $${values.length}`);
    }
    if (qualification_best_lap_ms !== undefined) {
      values.push(qualification_best_lap_ms);
      updates.push(`qualification_best_lap_ms = $${values.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    values.push(req.params.id);
    try {
      const { rows } = await pool.query(
        `UPDATE group_participants SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values
      );
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      res.json(rows[0]);
    } catch (err) {
      (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
    }
  }
);

// POST /api/group-participants/:id/replace
// Body: { replacement_pilot_id? }
// If replacement_pilot_id is omitted, take the next eligible pilot from the
// qualification ranking who is not already in this stage.
router.post('/group-participants/:id/replace',
  authenticate, authorize('admin', 'chief_judge'),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: targetRows } = await client.query(
        `SELECT gp.*, s.competition_id, s.id AS stage_id
           FROM group_participants gp
           JOIN groups g ON g.id = gp.group_id
           JOIN stages s ON s.id = g.stage_id
          WHERE gp.id = $1
          FOR UPDATE`,
        [req.params.id]
      );
      if (!targetRows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Not found' });
      }
      const target = targetRows[0];
      if (target.team_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'team_replacement_not_supported_yet' });
      }
      if (!target.pilot_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'empty_slot_cannot_be_replaced' });
      }

      let replacementPilotId = req.body.replacement_pilot_id;
      const { rows: usedRows } = await client.query(
        `SELECT pilot_id
           FROM group_participants gp
           JOIN groups g ON g.id = gp.group_id
          WHERE g.stage_id = $1 AND pilot_id IS NOT NULL`,
        [target.stage_id]
      );
      const used = new Set(usedRows.map(r => Number(r.pilot_id)));

      if (!replacementPilotId) {
        const ranked = await loadQualificationRanking(client, target.competition_id);
        replacementPilotId = ranked.find(id => !used.has(Number(id)));
      } else if (used.has(Number(replacementPilotId))) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'replacement_already_in_stage' });
      }
      if (!replacementPilotId) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'no_eligible_replacement' });
      }

      const { rows } = await client.query(
        `UPDATE group_participants
            SET replaced_pilot_id = pilot_id,
                pilot_id = $1,
                attendance_status = 'replaced',
                replacement_reason = COALESCE($2, 'no_show')
          WHERE id = $3
          RETURNING *`,
        [replacementPilotId, req.body.reason || null, target.id]
      );

      await client.query('COMMIT');
      res.json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      const status = isClientStageError(err) ||
        err.message === 'qualification_stage_not_found'
        ? 400
        : 500;
      (console.error(err), res.status(status).json({ error: status === 400 || status === 404 || status === 409 ? err.message : 'Internal Server Error' }));
    } finally {
      client.release();
    }
  }
);

module.exports = router;
