'use strict';

// Integration tests for Phase 5 helper HTTP endpoints:
//   GET  /api/heats/:id/channel-conflicts
//   POST /api/heats/:id/reflight-impact

const request = require('supertest');
const app = require('../src/app');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers,
  createTestCompetition, createTestPilot, createTestHeat, addHeatParticipant,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Phase 5 heat helpers', () => {
  let adminUser, chiefJudgeUser, judgeUser, pilotUser;
  let competition, heat;
  let pilots = [];
  let channelR1, channelR2;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    adminUser      = users.find(u => u.role === 'admin');
    chiefJudgeUser = users.find(u => u.role === 'chief_judge');
    judgeUser      = users.find(u => u.role === 'judge');
    pilotUser      = users.find(u => u.role === 'pilot');

    const { rows: chs } = await pool.query(
      `SELECT * FROM video_channels WHERE code IN ('R1', 'R2') ORDER BY code`
    );
    [channelR1, channelR2] = chs;
  });

  beforeEach(async () => {
    competition = await createTestCompetition('Test_Phase5Heat', 'qualification');
    heat = await createTestHeat(competition.id, judgeUser.id);
    pilots = [];
    for (let i = 0; i < 3; i++) {
      const p = await createTestPilot(`Test_Phase5_${i}`, 'Pilot');
      pilots.push(p);
      await addHeatParticipant(heat.id, p.id, i + 1);
    }
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM drones WHERE pilot_id IN (SELECT id FROM pilots WHERE first_name LIKE 'Test_Phase5%')`);
    await pool.query(`DELETE FROM competitions WHERE name = 'Test_Phase5Heat'`);
    await pool.query(`DELETE FROM pilots WHERE first_name LIKE 'Test_Phase5%'`);
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  async function assignDrone(pilot, channelId) {
    await pool.query(
      `INSERT INTO drones (pilot_id, drone_class, video_channel_id, is_active, has_failsafe, has_prop_guards)
       VALUES ($1, '75mm', $2, true, true, true)`,
      [pilot.id, channelId]
    );
  }

  describe('GET /api/heats/:id/channel-conflicts', () => {
    test('returns no conflicts when channels are unique', async () => {
      await assignDrone(pilots[0], channelR1.id);
      await assignDrone(pilots[1], channelR2.id);

      const res = await request(app)
        .get(`/api/heats/${heat.id}/channel-conflicts`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.heat_id).toBe(heat.id);
      expect(res.body.conflicts).toEqual([]);
    });

    test('detects collision when two pilots share a channel', async () => {
      await assignDrone(pilots[0], channelR1.id);
      await assignDrone(pilots[1], channelR1.id);
      await assignDrone(pilots[2], channelR2.id);

      const res = await request(app)
        .get(`/api/heats/${heat.id}/channel-conflicts`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.conflicts.length).toBe(1);
      expect(res.body.conflicts[0].video_channel_code).toBe('R1');
      expect(res.body.conflicts[0].pilots.sort((a, b) => a - b)).toEqual(
        [pilots[0].id, pilots[1].id].sort((a, b) => a - b)
      );
    });

    test('pilot role denied (judges/admin only)', async () => {
      const res = await request(app)
        .get(`/api/heats/${heat.id}/channel-conflicts`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'));

      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/heats/:id/reflight-impact', () => {
    test('falsestart → whole group with warning', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/reflight-impact`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ reason: 'falsestart', guilty_pilot_id: pilots[0].id });

      expect(res.statusCode).toBe(200);
      expect(res.body.whole_group).toBe(true);
      expect(res.body.warning_to).toBe(pilots[0].id);
    });

    test('post_gate_guilty_collision → excludes guilty pilot', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/reflight-impact`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ reason: 'post_gate_guilty_collision', guilty_pilot_id: pilots[1].id });

      expect(res.statusCode).toBe(200);
      expect(res.body.exclude_pilot_id).toBe(pilots[1].id);
      expect(res.body.dq_penalty).toBe('last_place');
    });

    test('own_damage → no reflight', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/reflight-impact`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ reason: 'own_damage' });

      expect(res.statusCode).toBe(200);
      expect(res.body.whole_group).toBe(false);
    });

    test('missing reason returns 400', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/reflight-impact`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({});

      expect(res.statusCode).toBe(400);
    });

    test('pilot role denied (judges/admin only)', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/reflight-impact`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'))
        .send({ reason: 'falsestart' });

      expect(res.statusCode).toBe(403);
    });
  });
});
