'use strict';

const request = require('supertest');
const app = require('../src/app');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers,
  createTestCompetition, createTestPilot, createTestHeat, addHeatParticipant,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Simulator disconnect API', () => {
  let chiefJudgeUser, judgeUser, pilotUser;
  let competition, heat, pilot;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    chiefJudgeUser = users.find(u => u.role === 'chief_judge');
    judgeUser      = users.find(u => u.role === 'judge');
    pilotUser      = users.find(u => u.role === 'pilot');
  });

  beforeEach(async () => {
    competition = await createTestCompetition('Test_SimDC', 'qualification');
    await pool.query(
      `UPDATE competitions SET simulator_max_attempts = 2 WHERE id = $1`,
      [competition.id]
    );
    heat = await createTestHeat(competition.id, judgeUser.id);
    pilot = await createTestPilot('Test_SimDC', 'Pilot');
    await addHeatParticipant(heat.id, pilot.id, 1);
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM disconnects WHERE heat_id = $1`, [heat.id]);
    await pool.query(`DELETE FROM competitions WHERE name = 'Test_SimDC'`);
    await pool.query(`DELETE FROM pilots WHERE first_name = 'Test_SimDC'`);
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  test('records a single-pilot disconnect with continue verdict', async () => {
    const res = await request(app)
      .post(`/api/heats/${heat.id}/disconnects`)
      .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
      .send({ scope: 'single', pilot_id: pilot.id, reason: 'timeout' });

    expect(res.statusCode).toBe(201);
    expect(res.body.disconnect.scope).toBe('single');
    expect(res.body.verdict.verdict).toBe('continue');
  });

  test('repeated single-pilot disconnects trigger technical_defeat at competition threshold', async () => {
    // First (1 of 2) — continue
    await request(app)
      .post(`/api/heats/${heat.id}/disconnects`)
      .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
      .send({ scope: 'single', pilot_id: pilot.id });
    // Second (2 of 2) — technical_defeat (maxAttempts=2)
    const res = await request(app)
      .post(`/api/heats/${heat.id}/disconnects`)
      .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
      .send({ scope: 'single', pilot_id: pilot.id });

    expect(res.statusCode).toBe(201);
    expect(res.body.verdict.verdict).toBe('technical_defeat');
    expect(res.body.verdict.repeat_offender_pilot_id).toBe(pilot.id);
  });

  test('group disconnect triggers replay_group', async () => {
    const res = await request(app)
      .post(`/api/heats/${heat.id}/disconnects`)
      .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
      .send({ scope: 'all' });

    expect(res.statusCode).toBe(201);
    expect(res.body.verdict.verdict).toBe('replay_group');
  });

  test('missing scope returns 400', async () => {
    const res = await request(app)
      .post(`/api/heats/${heat.id}/disconnects`)
      .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
      .send({});
    expect(res.statusCode).toBe(400);
  });

  test('judge role denied (chief_judge+ only)', async () => {
    const res = await request(app)
      .post(`/api/heats/${heat.id}/disconnects`)
      .set('Authorization', authHeader(judgeUser.id, 'judge'))
      .send({ scope: 'all' });
    expect(res.statusCode).toBe(403);
  });

  test('GET lists disconnects in occurrence order', async () => {
    await pool.query(
      `INSERT INTO disconnects (heat_id, pilot_id, scope, recorded_by)
       VALUES ($1, $2, 'single', $3), ($1, NULL, 'all', $3)`,
      [heat.id, pilot.id, chiefJudgeUser.id]
    );

    const res = await request(app)
      .get(`/api/heats/${heat.id}/disconnects`)
      .set('Authorization', authHeader(judgeUser.id, 'judge'));

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(2);
  });

  test('pilot role denied on listing', async () => {
    const res = await request(app)
      .get(`/api/heats/${heat.id}/disconnects`)
      .set('Authorization', authHeader(pilotUser.id, 'pilot'));
    expect(res.statusCode).toBe(403);
  });
});
