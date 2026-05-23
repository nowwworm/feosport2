'use strict';

const request = require('supertest');
const app = require('../src/app');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers,
  createTestCompetition, createTestPilot, createTestHeat, addHeatParticipant,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Sanctions API (penalties + protests)', () => {
  let chiefJudgeUser, judgeUser, pilotUser, adminUser;
  let competition, heat, pilot;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    chiefJudgeUser = users.find(u => u.role === 'chief_judge');
    judgeUser      = users.find(u => u.role === 'judge');
    pilotUser      = users.find(u => u.role === 'pilot');
    adminUser      = users.find(u => u.role === 'admin');
  });

  beforeEach(async () => {
    competition = await createTestCompetition('Test_Sanct', 'qualification');
    heat = await createTestHeat(competition.id, judgeUser.id);
    pilot = await createTestPilot('Test_Sanct', 'Pilot');
    await addHeatParticipant(heat.id, pilot.id, 1);
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM protests WHERE competition_id = $1`, [competition.id]);
    await pool.query(`DELETE FROM penalties WHERE competition_id = $1`, [competition.id]);
    await pool.query(`DELETE FROM result_audit_log WHERE result_id IN (SELECT id FROM results WHERE heat_id = $1)`, [heat.id]);
    await pool.query(`DELETE FROM results WHERE heat_id = $1`, [heat.id]);
    await pool.query(`DELETE FROM competitions WHERE name = 'Test_Sanct'`);
    await pool.query(`DELETE FROM pilots WHERE first_name = 'Test_Sanct'`);
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  describe('POST /api/competitions/:id/penalties', () => {
    test('chief_judge issues oral warning', async () => {
      const res = await request(app)
        .post(`/api/competitions/${competition.id}/penalties`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({
          penalty_type: 'oral_warning',
          pilot_id: pilot.id,
          reason: 'unsafe takeoff',
          rules_clause: '5.10.2.1',
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.penalty_type).toBe('oral_warning');
      expect(res.body.pilot_id).toBe(pilot.id);
    });

    test('points_deduction requires negative points', async () => {
      const res = await request(app)
        .post(`/api/competitions/${competition.id}/penalties`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({
          penalty_type: 'points_deduction',
          pilot_id: pilot.id,
          points: 5,
        });
      expect(res.statusCode).toBe(400);
    });

    test('disqualification marks the existing result row dsq=true', async () => {
      // Seed a result first
      await pool.query(
        `INSERT INTO results (heat_id, pilot_id, judge_id, time_seconds)
         VALUES ($1, $2, $3, 45.5)`,
        [heat.id, pilot.id, judgeUser.id]
      );

      const res = await request(app)
        .post(`/api/competitions/${competition.id}/penalties`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({
          penalty_type: 'disqualification',
          pilot_id: pilot.id,
          heat_id: heat.id,
          reason: 'collision after gate 2',
        });
      expect(res.statusCode).toBe(201);

      const { rows } = await pool.query(
        `SELECT dsq FROM results WHERE heat_id = $1 AND pilot_id = $2`,
        [heat.id, pilot.id]
      );
      expect(rows[0].dsq).toBe(true);
    });

    test('judge role denied (chief_judge+ only)', async () => {
      const res = await request(app)
        .post(`/api/competitions/${competition.id}/penalties`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'))
        .send({
          penalty_type: 'oral_warning',
          pilot_id: pilot.id,
        });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('Protests workflow', () => {
    test('protest filed within 5 minutes is accepted', async () => {
      // ended 2 minutes ago
      const endedAt = new Date(Date.now() - 2 * 60 * 1000);
      await pool.query(
        `UPDATE heats SET status='completed', ended_at = $1 WHERE id = $2`,
        [endedAt, heat.id]
      );

      const res = await request(app)
        .post(`/api/competitions/${competition.id}/protests`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'))
        .send({
          heat_id: heat.id,
          subject_pilot_id: pilot.id,
          rules_clause: '5.14.3',
          description: 'Contact in start zone — request reflight.',
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('pending');
    });

    test('protest after 5-minute window is rejected with 400', async () => {
      const endedAt = new Date(Date.now() - 6 * 60 * 1000);
      await pool.query(
        `UPDATE heats SET status='completed', ended_at = $1 WHERE id = $2`,
        [endedAt, heat.id]
      );

      const res = await request(app)
        .post(`/api/competitions/${competition.id}/protests`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'))
        .send({
          heat_id: heat.id,
          description: 'too late',
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/window_expired/);
    });

    test('protest before heat ended is rejected', async () => {
      // heat.ended_at is null by default
      const res = await request(app)
        .post(`/api/competitions/${competition.id}/protests`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'))
        .send({
          heat_id: heat.id,
          description: 'premature',
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/not_ended/);
    });

    test('chief_judge resolves a pending protest', async () => {
      const { rows: protestRows } = await pool.query(
        `INSERT INTO protests (competition_id, heat_id, filed_by, description, status)
         VALUES ($1, $2, $3, 'pending review', 'pending')
         RETURNING *`,
        [competition.id, heat.id, pilotUser.id]
      );
      const protestId = protestRows[0].id;

      const res = await request(app)
        .patch(`/api/protests/${protestId}`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ status: 'upheld', resolution: 'Reflight granted.' });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('upheld');
      expect(res.body.resolved_by).toBe(chiefJudgeUser.id);
    });

    test('resolving an already-resolved protest returns 404', async () => {
      const { rows: protestRows } = await pool.query(
        `INSERT INTO protests (competition_id, filed_by, description, status, resolved_by, resolved_at)
         VALUES ($1, $2, 'already done', 'upheld', $3, NOW())
         RETURNING *`,
        [competition.id, pilotUser.id, chiefJudgeUser.id]
      );
      const res = await request(app)
        .patch(`/api/protests/${protestRows[0].id}`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ status: 'rejected' });
      expect(res.statusCode).toBe(404);
    });

    test('judge cannot resolve a protest (chief_judge+ only)', async () => {
      const { rows: protestRows } = await pool.query(
        `INSERT INTO protests (competition_id, filed_by, description, status)
         VALUES ($1, $2, 'pending review', 'pending')
         RETURNING *`,
        [competition.id, pilotUser.id]
      );
      const res = await request(app)
        .patch(`/api/protests/${protestRows[0].id}`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'))
        .send({ status: 'rejected' });
      expect(res.statusCode).toBe(403);
    });

    test('GET lists penalties and protests for the competition', async () => {
      await pool.query(
        `INSERT INTO penalties (competition_id, pilot_id, penalty_type, issued_by)
         VALUES ($1, $2, 'oral_warning', $3)`,
        [competition.id, pilot.id, chiefJudgeUser.id]
      );
      await pool.query(
        `INSERT INTO protests (competition_id, filed_by, description, status)
         VALUES ($1, $2, 'first protest', 'pending')`,
        [competition.id, pilotUser.id]
      );

      const p = await request(app)
        .get(`/api/competitions/${competition.id}/penalties`)
        .set('Authorization', authHeader(adminUser.id, 'admin'));
      const pr = await request(app)
        .get(`/api/competitions/${competition.id}/protests`)
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect(p.statusCode).toBe(200);
      expect(p.body.length).toBe(1);
      expect(pr.statusCode).toBe(200);
      expect(pr.body.length).toBe(1);
    });
  });
});
