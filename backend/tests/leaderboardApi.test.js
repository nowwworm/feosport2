'use strict';

// Integration tests for spectator leaderboard REST endpoints:
//   GET /api/heats/:id/leaderboard
//   GET /api/competitions/:id/leaderboard

const request = require('supertest');
const app = require('../src/app');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers,
  createTestCompetition, createTestPilot, createTestHeat, addHeatParticipant,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Leaderboard API', () => {
  let adminUser, judgeUser, pilotUser;
  let competition, heat;
  let pilots = [];

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    adminUser = users.find(u => u.role === 'admin');
    judgeUser = users.find(u => u.role === 'judge');
    pilotUser = users.find(u => u.role === 'pilot');
  });

  beforeEach(async () => {
    competition = await createTestCompetition('Test_LB', 'qualification');
    heat = await createTestHeat(competition.id, judgeUser.id);
    pilots = [];
    for (let i = 0; i < 3; i++) {
      const p = await createTestPilot(`Test_LB_${i}`, 'Pilot');
      pilots.push(p);
      await addHeatParticipant(heat.id, p.id, i + 1);
    }
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM laps WHERE heat_id = $1`, [heat.id]);
    await pool.query(`DELETE FROM competitions WHERE name = 'Test_LB'`);
    await pool.query(`DELETE FROM pilots WHERE first_name LIKE 'Test_LB%'`);
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

  describe('GET /api/heats/:id/leaderboard', () => {
    test('returns ranked standings based on lap data', async () => {
      // pilot 0: 2 laps × 10s, pilot 1: 2 laps × 9s (faster), pilot 2: 1 lap × 8s
      await recordLap(pilots[0].id, 1, 10000);
      await recordLap(pilots[0].id, 2, 10000);
      await recordLap(pilots[1].id, 1, 9000);
      await recordLap(pilots[1].id, 2, 9000);
      await recordLap(pilots[2].id, 1, 8000);

      const res = await request(app)
        .get(`/api/heats/${heat.id}/leaderboard`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.heat_id).toBe(heat.id);
      expect(res.body.standings.length).toBe(3);
      expect(res.body.standings[0].pilot_id).toBe(pilots[1].id);
      expect(res.body.standings[0].place).toBe(1);
      expect(res.body.standings[0].total_laps).toBe(2);
      expect(res.body.standings[1].pilot_id).toBe(pilots[0].id);
      expect(res.body.standings[2].pilot_id).toBe(pilots[2].id);
    });

    test('invalid laps are excluded from totals', async () => {
      await recordLap(pilots[0].id, 1, 10000, true);
      await recordLap(pilots[0].id, 2, 5000, false);
      await recordLap(pilots[1].id, 1, 12000, true);

      const res = await request(app)
        .get(`/api/heats/${heat.id}/leaderboard`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      const p0 = res.body.standings.find(r => r.pilot_id === pilots[0].id);
      expect(p0.total_laps).toBe(1);
      expect(p0.total_time_ms).toBe(10000);
    });

    test('participants without laps appear with zero laps at bottom', async () => {
      await recordLap(pilots[0].id, 1, 10000);

      const res = await request(app)
        .get(`/api/heats/${heat.id}/leaderboard`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.body.standings[0].pilot_id).toBe(pilots[0].id);
      // last two have 0 laps each
      expect(res.body.standings[1].total_laps).toBe(0);
      expect(res.body.standings[2].total_laps).toBe(0);
    });

    test('pilot role can access (spectator-friendly endpoint)', async () => {
      const res = await request(app)
        .get(`/api/heats/${heat.id}/leaderboard`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'));
      expect(res.statusCode).toBe(200);
    });

    test('unknown heat returns 404', async () => {
      const res = await request(app)
        .get(`/api/heats/9999999/leaderboard`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/competitions/:id/leaderboard', () => {
    test('returns standings derived from heat results when stage is absent', async () => {
      // Lock heat + add results so legacy aggregator picks them up
      await pool.query(`UPDATE heats SET status = 'locked' WHERE id = $1`, [heat.id]);
      for (const p of pilots) {
        await pool.query(
          `INSERT INTO results (heat_id, pilot_id, judge_id, time_seconds)
           VALUES ($1, $2, $3, $4)`,
          [heat.id, p.id, judgeUser.id, 30 + p.id * 0.001]
        );
      }

      const res = await request(app)
        .get(`/api/competitions/${competition.id}/leaderboard`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'));

      expect(res.statusCode).toBe(200);
      expect(res.body.competition_id).toBe(competition.id);
      expect(Array.isArray(res.body.standings)).toBe(true);
      expect(res.body.standings.length).toBe(3);
    });

    test('limit query trims standings', async () => {
      await pool.query(`UPDATE heats SET status = 'locked' WHERE id = $1`, [heat.id]);
      for (const p of pilots) {
        await pool.query(
          `INSERT INTO results (heat_id, pilot_id, judge_id, time_seconds)
           VALUES ($1, $2, $3, $4)`,
          [heat.id, p.id, judgeUser.id, 30]
        );
      }

      const res = await request(app)
        .get(`/api/competitions/${competition.id}/leaderboard?limit=2`)
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect(res.statusCode).toBe(200);
      expect(res.body.standings.length).toBe(2);
    });

    test('unauthenticated request rejected', async () => {
      const res = await request(app).get(`/api/competitions/${competition.id}/leaderboard`);
      expect(res.statusCode).toBe(401);
    });
  });
});
