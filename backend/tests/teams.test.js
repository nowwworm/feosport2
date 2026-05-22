'use strict';

const request = require('supertest');
const app = require('../src/app');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers,
  createTestPilot,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Teams API', () => {
  let adminUser, chiefJudgeUser, judgeUser;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    adminUser      = users.find(u => u.role === 'admin');
    chiefJudgeUser = users.find(u => u.role === 'chief_judge');
    judgeUser      = users.find(u => u.role === 'judge');
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE name LIKE 'Test_%')`);
    await pool.query(`DELETE FROM teams WHERE name LIKE 'Test_%'`);
    await pool.query(`DELETE FROM pilots WHERE first_name LIKE 'Test_%'`);
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  test('POST /api/teams — chief_judge can create', async () => {
    const res = await request(app)
      .post('/api/teams')
      .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
      .send({ name: 'Test_Команда_Альфа', region: 'Крым' });

    expect(res.statusCode).toBe(201);
    expect(res.body.name).toBe('Test_Команда_Альфа');
    expect(res.body.region).toBe('Крым');
  });

  test('POST /api/teams — judge (without chief) cannot create', async () => {
    const res = await request(app)
      .post('/api/teams')
      .set('Authorization', authHeader(judgeUser.id, 'judge'))
      .send({ name: 'Test_NoCreate' });

    expect(res.statusCode).toBe(403);
  });

  test('POST /api/teams — empty name returns 400', async () => {
    const res = await request(app)
      .post('/api/teams')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({ name: '   ' });

    expect(res.statusCode).toBe(400);
  });

  test('POST /api/teams — duplicate external_id returns 409', async () => {
    await request(app)
      .post('/api/teams')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({ name: 'Test_First',  external_id: 'ext_team_42' });
    const dup = await request(app)
      .post('/api/teams')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .send({ name: 'Test_Second', external_id: 'ext_team_42' });

    expect(dup.statusCode).toBe(409);
  });

  describe('Team members', () => {
    let team, pilotA, pilotB, pilotC, pilotD;

    beforeEach(async () => {
      const { rows } = await pool.query(
        `INSERT INTO teams (name, region) VALUES ('Test_Roster', 'Крым') RETURNING *`
      );
      team   = rows[0];
      pilotA = await createTestPilot('Test_Pilot_A', 'Alpha');
      pilotB = await createTestPilot('Test_Pilot_B', 'Beta');
      pilotC = await createTestPilot('Test_Pilot_C', 'Gamma');
      pilotD = await createTestPilot('Test_Pilot_D', 'Delta');
    });

    test('add member with valid role', async () => {
      const res = await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ pilot_id: pilotA.id, role: 'pilot', is_captain: true });

      expect(res.statusCode).toBe(201);
      expect(res.body.is_captain).toBe(true);
    });

    test('cannot add 4th member', async () => {
      for (const p of [pilotA, pilotB, pilotC]) {
        await request(app)
          .post(`/api/teams/${team.id}/members`)
          .set('Authorization', authHeader(adminUser.id, 'admin'))
          .send({ pilot_id: p.id, role: 'pilot' });
      }
      const res = await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ pilot_id: pilotD.id, role: 'reserve' });

      expect(res.statusCode).toBe(409);
    });

    test('cannot add the same pilot twice', async () => {
      await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ pilot_id: pilotA.id, role: 'pilot' });

      const dup = await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ pilot_id: pilotA.id, role: 'reserve' });

      expect(dup.statusCode).toBe(409);
    });

    test('invalid role returns 400', async () => {
      const res = await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ pilot_id: pilotA.id, role: 'engineer' });

      expect(res.statusCode).toBe(400);
    });

    test('assigning a new captain demotes the previous one', async () => {
      await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ pilot_id: pilotA.id, role: 'pilot', is_captain: true });

      const m2 = await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ pilot_id: pilotB.id, role: 'pilot', is_captain: true });

      expect(m2.statusCode).toBe(201);

      const { rows } = await pool.query(
        `SELECT pilot_id, is_captain FROM team_members WHERE team_id = $1 ORDER BY pilot_id`,
        [team.id]
      );
      const aCap = rows.find(r => r.pilot_id === pilotA.id).is_captain;
      const bCap = rows.find(r => r.pilot_id === pilotB.id).is_captain;
      expect(aCap).toBe(false);
      expect(bCap).toBe(true);
    });

    test('GET /api/teams/:id includes members', async () => {
      await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ pilot_id: pilotA.id, role: 'pilot', is_captain: true });

      const res = await request(app)
        .get(`/api/teams/${team.id}`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.members.length).toBe(1);
      expect(res.body.members[0].first_name).toBe('Test_Pilot_A');
    });

    test('DELETE member', async () => {
      const add = await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ pilot_id: pilotA.id, role: 'pilot' });

      const del = await request(app)
        .delete(`/api/teams/${team.id}/members/${add.body.id}`)
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect(del.statusCode).toBe(200);
    });
  });
});
