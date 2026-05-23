'use strict';

const request = require('supertest');
const app = require('../src/app');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers,
  createTestCompetition, createTestPilot,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Scoring API', () => {
  let judgeUser, pilotUser;
  let competition, stage, groupA, groupB;
  let raceSystemId;
  let pilots = [];

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    judgeUser = users.find(u => u.role === 'judge');
    pilotUser = users.find(u => u.role === 'pilot');

    const { rows: rsRows } = await pool.query(
      `SELECT id FROM race_systems WHERE code = 'two_of_four' LIMIT 1`
    );
    raceSystemId = rsRows[0]?.id || null;
  });

  beforeEach(async () => {
    competition = await createTestCompetition('Test_Scoring', 'qualification');
    if (raceSystemId) {
      await pool.query(
        `UPDATE competitions SET race_system_id = $1 WHERE id = $2`,
        [raceSystemId, competition.id]
      );
    }

    const stageRes = await pool.query(
      `INSERT INTO stages (competition_id, stage_type, ordinal, status)
       VALUES ($1, 'qualification', 1, 'active') RETURNING *`,
      [competition.id]
    );
    stage = stageRes.rows[0];

    const grpA = await pool.query(
      `INSERT INTO groups (stage_id, group_number) VALUES ($1, 1) RETURNING *`,
      [stage.id]
    );
    const grpB = await pool.query(
      `INSERT INTO groups (stage_id, group_number) VALUES ($1, 2) RETURNING *`,
      [stage.id]
    );
    groupA = grpA.rows[0];
    groupB = grpB.rows[0];

    pilots = [];
    for (let i = 0; i < 8; i++) {
      pilots.push(await createTestPilot(`Test_Score_${i}`, 'Pilot'));
    }

    // Group A: pilots 0..3 placing 1..4
    for (let i = 0; i < 4; i++) {
      await pool.query(
        `INSERT INTO group_participants (group_id, pilot_id, slot, finish_place)
         VALUES ($1, $2, $3, $4)`,
        [groupA.id, pilots[i].id, i + 1, i + 1]
      );
    }
    // Group B: pilots 4..7 placing 1..4
    for (let i = 0; i < 4; i++) {
      await pool.query(
        `INSERT INTO group_participants (group_id, pilot_id, slot, finish_place)
         VALUES ($1, $2, $3, $4)`,
        [groupB.id, pilots[4 + i].id, i + 1, i + 1]
      );
    }
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM competitions WHERE name = 'Test_Scoring'`);
    await pool.query(`DELETE FROM pilots WHERE first_name LIKE 'Test_Score_%'`);
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  describe('GET /api/stages/:id/scores', () => {
    test('returns per-pilot points and detects no ties when winners are unique per group', async () => {
      const res = await request(app)
        .get(`/api/stages/${stage.id}/scores`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'));

      expect(res.statusCode).toBe(200);
      expect(res.body.stage_id).toBe(stage.id);
      expect(res.body.standings.length).toBe(8);
      // Two pilots tied at 3 points (winners of each group)
      const winners = res.body.standings.filter(s => s.total_points === 3);
      expect(winners.length).toBe(2);
      const ties = res.body.ties;
      // 3-point and 2-point and 1-point and 0-point each have 2 entries → 4 tie groups
      expect(ties.length).toBe(4);
    });

    test('404 for unknown stage', async () => {
      const res = await request(app)
        .get(`/api/stages/9999999/scores`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/competitions/:id/standings', () => {
    test('aggregates all stage scores into competition-level standings', async () => {
      const res = await request(app)
        .get(`/api/competitions/${competition.id}/standings`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'));

      expect(res.statusCode).toBe(200);
      expect(res.body.competition_id).toBe(competition.id);
      expect(res.body.standings.length).toBe(8);
      // Highest scorers (winners) have 3 points
      expect(res.body.standings[0].total_points).toBe(3);
      expect(res.body.standings.at(-1).total_points).toBe(0);
    });

    test('unauthenticated request rejected', async () => {
      const res = await request(app).get(`/api/competitions/${competition.id}/standings`);
      expect(res.statusCode).toBe(401);
    });
  });
});
