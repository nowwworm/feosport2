'use strict';

// Integration test for Phase 11 — proves that role-specific endpoints
// honor the permissions catalogue. We use the new specialized roles
// (chronometer_judge, pit_judge, pilot_zone_judge) and assert that the
// router correctly admits or denies them.

const request = require('supertest');
const app = require('../src/app');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers, createTestUser,
  createTestCompetition, createTestPilot, createTestHeat, addHeatParticipant,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Phase 11 — specialist judging roles', () => {
  let chronoUser, pilotZoneUser, pitUser, techUser, judgeUser;
  let competition, heat, pilot;
  let group, teamAlpha;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    judgeUser = users.find(u => u.role === 'judge');

    chronoUser    = await createTestUser('chrono_phase11@feo.local',    'pw_phase11', 'chronometer_judge');
    pilotZoneUser = await createTestUser('pilotzone_phase11@feo.local', 'pw_phase11', 'pilot_zone_judge');
    pitUser       = await createTestUser('pit_phase11@feo.local',       'pw_phase11', 'pit_judge');
    techUser      = await createTestUser('tech_phase11@feo.local',      'pw_phase11', 'tech_control_judge');
  });

  beforeEach(async () => {
    competition = await createTestCompetition('Test_Phase11', 'qualification');
    heat = await createTestHeat(competition.id, judgeUser.id);
    pilot = await createTestPilot('Test_Phase11', 'Pilot');
    await addHeatParticipant(heat.id, pilot.id, 1);

    // Group + team for pit handoff test
    const stageRes = await pool.query(
      `INSERT INTO stages (competition_id, stage_type, ordinal, status)
       VALUES ($1, 'qualification', 1, 'active') RETURNING *`,
      [competition.id]
    );
    const grpRes = await pool.query(
      `INSERT INTO groups (stage_id, group_number) VALUES ($1, 1) RETURNING *`,
      [stageRes.rows[0].id]
    );
    group = grpRes.rows[0];
    await pool.query(`UPDATE heats SET group_id = $1 WHERE id = $2`, [group.id, heat.id]);

    const teamRes = await pool.query(
      `INSERT INTO teams (name) VALUES ('Test_Phase11_Team') RETURNING *`
    );
    teamAlpha = teamRes.rows[0];
    await pool.query(
      `INSERT INTO group_participants (group_id, team_id, slot) VALUES ($1, $2, 1)`,
      [group.id, teamAlpha.id]
    );
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM relay_handoffs WHERE heat_id = $1`, [heat.id]);
    await pool.query(`DELETE FROM laps WHERE heat_id = $1`, [heat.id]);
    await pool.query(`DELETE FROM falsestarts WHERE heat_id = $1`, [heat.id]);
    await pool.query(`DELETE FROM teams WHERE name = 'Test_Phase11_Team'`);
    await pool.query(`DELETE FROM competitions WHERE name = 'Test_Phase11'`);
    await pool.query(`DELETE FROM pilots WHERE first_name = 'Test_Phase11'`);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE email LIKE '%_phase11@feo.local'`);
    await cleanupDB();
    await pool.end();
  });

  describe('lap recording — chronometer specialty', () => {
    test('chronometer_judge can POST a lap', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/laps`)
        .set('Authorization', authHeader(chronoUser.id, 'chronometer_judge'))
        .send({ pilot_id: pilot.id, lap_number: 1, duration_ms: 10500 });
      expect(res.statusCode).toBeLessThan(400);
    });

    test('tech_control_judge cannot post a lap', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/laps`)
        .set('Authorization', authHeader(techUser.id, 'tech_control_judge'))
        .send({ pilot_id: pilot.id, lap_number: 1, duration_ms: 10500 });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('falsestart — pilot-zone specialty', () => {
    test('pilot_zone_judge can record falsestart', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/falsestarts`)
        .set('Authorization', authHeader(pilotZoneUser.id, 'pilot_zone_judge'))
        .send({ pilot_id: pilot.id, reason: 'early start' });
      expect(res.statusCode).toBeLessThan(400);
    });

    test('chronometer_judge cannot record falsestart', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/falsestarts`)
        .set('Authorization', authHeader(chronoUser.id, 'chronometer_judge'))
        .send({ pilot_id: pilot.id });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('relay handoff — pit specialty', () => {
    test('pit_judge can record a handoff', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/handoffs`)
        .set('Authorization', authHeader(pitUser.id, 'pit_judge'))
        .send({
          team_id: teamAlpha.id,
          incoming_pilot_id: pilot.id,
        });
      expect(res.statusCode).toBe(201);
    });

    test('chronometer_judge cannot record a handoff', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/handoffs`)
        .set('Authorization', authHeader(chronoUser.id, 'chronometer_judge'))
        .send({ team_id: teamAlpha.id, incoming_pilot_id: pilot.id });
      expect(res.statusCode).toBe(403);
    });

    test('generic judge cannot record a handoff (specialty-only)', async () => {
      const res = await request(app)
        .post(`/api/heats/${heat.id}/handoffs`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'))
        .send({ team_id: teamAlpha.id, incoming_pilot_id: pilot.id });
      expect(res.statusCode).toBe(403);
    });
  });
});
