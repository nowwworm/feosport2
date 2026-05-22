'use strict';

// Integration tests for team relay endpoints (§5.5.8.x):
//   GET  /api/heats/:id/team-leaderboard
//   GET  /api/heats/:id/handoffs
//   POST /api/heats/:id/handoffs

const request = require('supertest');
const app = require('../src/app');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers,
  createTestCompetition, createTestPilot, createTestHeat,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Team relay API', () => {
  let chiefJudgeUser, judgeUser, pilotUser;
  let competition, heat, stage, group;
  let teamAlpha, teamBravo;
  let pilots = [];

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    chiefJudgeUser = users.find(u => u.role === 'chief_judge');
    judgeUser = users.find(u => u.role === 'judge');
    pilotUser = users.find(u => u.role === 'pilot');
  });

  beforeEach(async () => {
    competition = await createTestCompetition('Test_TeamRelay', 'qualification');

    const stageRes = await pool.query(
      `INSERT INTO stages (competition_id, stage_type, ordinal, status)
       VALUES ($1, 'qualification', 1, 'active') RETURNING *`,
      [competition.id]
    );
    stage = stageRes.rows[0];

    const groupRes = await pool.query(
      `INSERT INTO groups (stage_id, group_number) VALUES ($1, 1) RETURNING *`,
      [stage.id]
    );
    group = groupRes.rows[0];

    const teamAlphaRes = await pool.query(
      `INSERT INTO teams (name) VALUES ('Test_TR_Alpha') RETURNING *`
    );
    const teamBravoRes = await pool.query(
      `INSERT INTO teams (name) VALUES ('Test_TR_Bravo') RETURNING *`
    );
    teamAlpha = teamAlphaRes.rows[0];
    teamBravo = teamBravoRes.rows[0];

    pilots = [];
    for (let i = 0; i < 4; i++) {
      pilots.push(await createTestPilot(`Test_TR_${i}`, 'Pilot'));
    }

    // Alpha = pilots[0], pilots[1]; Bravo = pilots[2], pilots[3]
    await pool.query(
      `INSERT INTO team_members (team_id, pilot_id, role)
       VALUES ($1, $2, 'pilot'), ($1, $3, 'pilot'),
              ($4, $5, 'pilot'), ($4, $6, 'pilot')`,
      [teamAlpha.id, pilots[0].id, pilots[1].id,
       teamBravo.id, pilots[2].id, pilots[3].id]
    );

    await pool.query(
      `INSERT INTO group_participants (group_id, team_id, slot)
       VALUES ($1, $2, 1), ($1, $3, 2)`,
      [group.id, teamAlpha.id, teamBravo.id]
    );

    heat = await createTestHeat(competition.id, judgeUser.id);
    await pool.query(`UPDATE heats SET group_id = $1 WHERE id = $2`, [group.id, heat.id]);
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM relay_handoffs WHERE heat_id = $1`, [heat.id]);
    await pool.query(`DELETE FROM laps WHERE heat_id = $1`, [heat.id]);
    await pool.query(`DELETE FROM competitions WHERE name = 'Test_TeamRelay'`);
    await pool.query(`DELETE FROM team_members WHERE pilot_id IN (SELECT id FROM pilots WHERE first_name LIKE 'Test_TR_%')`);
    await pool.query(`DELETE FROM teams WHERE name LIKE 'Test_TR_%'`);
    await pool.query(`DELETE FROM pilots WHERE first_name LIKE 'Test_TR_%'`);
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  async function recordLap(pilotId, lapNumber, durationMs, valid = true) {
    await pool.query(
      `INSERT INTO laps (heat_id, pilot_id, lap_number, duration_ms, valid, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [heat.id, pilotId, lapNumber, durationMs, valid, judgeUser.id]
    );
  }

  describe('GET /api/heats/:id/team-leaderboard', () => {
    test('aggregates laps by team and ranks them', async () => {
      // Alpha: 2 laps × 10s, 2 laps × 9.5s → 4 laps, 39s total
      await recordLap(pilots[0].id, 1, 10000);
      await recordLap(pilots[0].id, 2, 10000);
      await recordLap(pilots[1].id, 1, 9500);
      await recordLap(pilots[1].id, 2, 9500);
      // Bravo: 1 lap × 11s, 2 laps × 10s → 3 laps, 31s total
      await recordLap(pilots[2].id, 1, 11000);
      await recordLap(pilots[3].id, 1, 10000);
      await recordLap(pilots[3].id, 2, 10000);

      const res = await request(app)
        .get(`/api/heats/${heat.id}/team-leaderboard`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'));

      expect(res.statusCode).toBe(200);
      expect(res.body.standings.length).toBe(2);
      // Alpha has more laps → first
      expect(res.body.standings[0].team_id).toBe(teamAlpha.id);
      expect(res.body.standings[0].total_laps).toBe(4);
      expect(res.body.standings[1].team_id).toBe(teamBravo.id);
      expect(res.body.standings[1].total_laps).toBe(3);
    });

    test('teams without laps still appear with zero laps', async () => {
      const res = await request(app)
        .get(`/api/heats/${heat.id}/team-leaderboard`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'));

      expect(res.statusCode).toBe(200);
      expect(res.body.standings.length).toBe(2);
      expect(res.body.standings.every(t => t.total_laps === 0)).toBe(true);
    });
  });

  describe('POST /api/heats/:id/handoffs', () => {
    test('chief_judge records a valid handoff', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/handoffs`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({
          team_id: teamAlpha.id,
          outgoing_pilot_id: pilots[0].id,
          incoming_pilot_id: pilots[1].id,
          exchange_window_ms: 5000,
          exchange_duration_ms: 4200,
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.handoff.valid).toBe(true);
      expect(res.body.violation_ms).toBeNull();
    });

    test('handoff over the window is recorded with violation_ms', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/handoffs`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({
          team_id: teamAlpha.id,
          outgoing_pilot_id: pilots[0].id,
          incoming_pilot_id: pilots[1].id,
          exchange_window_ms: 5000,
          exchange_duration_ms: 6300,
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.handoff.valid).toBe(false);
      expect(res.body.violation_ms).toBe(1300);
    });

    test('missing team_id returns 400', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/handoffs`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ incoming_pilot_id: pilots[1].id });
      expect(res.statusCode).toBe(400);
    });

    test('judge role denied (chief_judge+ only)', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/handoffs`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'))
        .send({
          team_id: teamAlpha.id,
          incoming_pilot_id: pilots[1].id,
        });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /api/heats/:id/handoffs', () => {
    test('lists handoffs ordered by recording time', async () => {
      await pool.query(
        `INSERT INTO relay_handoffs (heat_id, team_id, outgoing_pilot_id, incoming_pilot_id,
            exchange_window_ms, exchange_duration_ms, valid, recorded_by)
         VALUES ($1, $2, $3, $4, 5000, 4500, true, $5),
                ($1, $2, $4, $3, 5000, 5200, false, $5)`,
        [heat.id, teamAlpha.id, pilots[0].id, pilots[1].id, judgeUser.id]
      );

      const res = await request(app)
        .get(`/api/heats/${heat.id}/handoffs`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBe(2);
      expect(res.body[0].team_name).toBe('Test_TR_Alpha');
    });

    test('pilot role denied (judges-only listing)', async () => {
      const res = await request(app)
        .get(`/api/heats/${heat.id}/handoffs`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'));
      expect(res.statusCode).toBe(403);
    });
  });
});
