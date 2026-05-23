'use strict';

const request = require('supertest');
const app = require('../src/app');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers,
  createTestCompetition, createTestPilot, createTestHeat, addHeatParticipant,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');
const { verifyChain } = require('../src/services/audit');

describe('Phase 13 — audit log + sanctions', () => {
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
    competition = await createTestCompetition('Test_Audit', 'qualification');
    heat = await createTestHeat(competition.id, judgeUser.id);
    pilot = await createTestPilot('Test_Audit', 'Pilot');
    await addHeatParticipant(heat.id, pilot.id, 1);
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM audit_log WHERE competition_id = $1`, [competition.id]);
    await pool.query(`DELETE FROM protocols WHERE competition_id = $1`, [competition.id]);
    await pool.query(`DELETE FROM protests WHERE competition_id = $1`, [competition.id]);
    await pool.query(`DELETE FROM penalties WHERE competition_id = $1`, [competition.id]);
    await pool.query(`DELETE FROM competitions WHERE name = 'Test_Audit'`);
    await pool.query(`DELETE FROM pilots WHERE first_name = 'Test_Audit'`);
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  describe('chain linkage', () => {
    test('issuing a penalty appends one audit entry linked to nothing (first in chain)', async () => {
      const res = await request(app)
        .post(`/api/competitions/${competition.id}/penalties`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ penalty_type: 'oral_warning', pilot_id: pilot.id });
      expect(res.statusCode).toBe(201);

      const { rows } = await pool.query(
        `SELECT * FROM audit_log WHERE competition_id = $1 ORDER BY id`,
        [competition.id]
      );
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe('penalty.issued');
      expect(rows[0].prev_hash).toBeNull();
      expect(rows[0].this_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    test('multiple actions form an unbroken chain', async () => {
      // 1) penalty
      await request(app)
        .post(`/api/competitions/${competition.id}/penalties`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ penalty_type: 'oral_warning', pilot_id: pilot.id });

      // 2) protest filed (requires heat ended)
      await pool.query(
        `UPDATE heats SET status='completed', ended_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
        [heat.id]
      );
      await request(app)
        .post(`/api/competitions/${competition.id}/protests`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'))
        .send({ heat_id: heat.id, description: 'test protest' });

      // 3) signed protocol
      await request(app)
        .post(`/api/competitions/${competition.id}/protocols/final_standings`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'));

      const verify = await verifyChain(competition.id);
      expect(verify.ok).toBe(true);
      expect(verify.entries).toBe(3);
    });

    test('tampering with a payload mid-chain is detected by verifyChain', async () => {
      // Seed 3 entries
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post(`/api/competitions/${competition.id}/penalties`)
          .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
          .send({ penalty_type: 'oral_warning', pilot_id: pilot.id, reason: `entry ${i}` });
      }
      // Tamper with the middle one
      const { rows } = await pool.query(
        `SELECT id FROM audit_log WHERE competition_id = $1 ORDER BY id LIMIT 3`,
        [competition.id]
      );
      await pool.query(
        `UPDATE audit_log SET payload = $1 WHERE id = $2`,
        [{ tampered: true }, rows[1].id]
      );

      const verify = await verifyChain(competition.id);
      expect(verify.ok).toBe(false);
      expect(verify.broken_at).toBe(rows[1].id);
    });
  });

  describe('REST endpoints', () => {
    test('GET /api/competitions/:id/audit returns chain entries (chief only)', async () => {
      await request(app)
        .post(`/api/competitions/${competition.id}/penalties`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ penalty_type: 'oral_warning', pilot_id: pilot.id });

      const ok = await request(app)
        .get(`/api/competitions/${competition.id}/audit`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'));
      expect(ok.statusCode).toBe(200);
      expect(ok.body.length).toBe(1);
      expect(ok.body[0].actor_email).toBe(chiefJudgeUser.email);

      const denied = await request(app)
        .get(`/api/competitions/${competition.id}/audit`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'));
      expect(denied.statusCode).toBe(403);
    });

    test('POST /api/competitions/:id/audit/verify reports ok', async () => {
      await request(app)
        .post(`/api/competitions/${competition.id}/penalties`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'))
        .send({ penalty_type: 'oral_warning', pilot_id: pilot.id });

      const res = await request(app)
        .post(`/api/competitions/${competition.id}/audit/verify`)
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'));
      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('pilot sanction status', () => {
    test('clear status when pilot has no penalties and no ban', async () => {
      const res = await request(app)
        .get(`/api/pilots/${pilot.id}/sanction-status`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'));
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('clear');
      expect(res.body.penalties.total).toBe(0);
    });

    test('flagged when pilot has penalties but not banned', async () => {
      await pool.query(
        `INSERT INTO penalties (competition_id, pilot_id, penalty_type, issued_by)
         VALUES ($1, $2, 'oral_warning', $3)`,
        [competition.id, pilot.id, chiefJudgeUser.id]
      );
      const res = await request(app)
        .get(`/api/pilots/${pilot.id}/sanction-status`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'));
      expect(res.body.status).toBe('flagged');
      expect(res.body.penalties.total).toBe(1);
    });

    test('banning a pilot updates status to banned and emits audit entry', async () => {
      const banRes = await request(app)
        .patch(`/api/pilots/${pilot.id}/ban`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ banned: true, reason: 'doping' });
      expect(banRes.statusCode).toBe(200);
      expect(banRes.body.is_banned).toBe(true);

      const status = await request(app)
        .get(`/api/pilots/${pilot.id}/sanction-status`)
        .set('Authorization', authHeader(pilotUser.id, 'pilot'));
      expect(status.body.status).toBe('banned');

      // Audit entry recorded under global (competition_id null) scope.
      const { rows } = await pool.query(
        `SELECT action, target_id FROM audit_log
          WHERE competition_id IS NULL AND target_id = $1 AND action = 'pilot.banned'
          ORDER BY id DESC LIMIT 1`,
        [pilot.id]
      );
      expect(rows.length).toBe(1);

      // Cleanup: lift ban + cleanup pilot.banned audit entries for this pilot.
      await request(app)
        .patch(`/api/pilots/${pilot.id}/ban`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ banned: false });
      await pool.query(
        `DELETE FROM audit_log WHERE target_kind = 'pilot' AND target_id = $1`,
        [pilot.id]
      );
    });

    test('banning without reason returns 400', async () => {
      const res = await request(app)
        .patch(`/api/pilots/${pilot.id}/ban`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({ banned: true });
      expect(res.statusCode).toBe(400);
    });

    test('judge role cannot ban a pilot', async () => {
      const res = await request(app)
        .patch(`/api/pilots/${pilot.id}/ban`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'))
        .send({ banned: true, reason: 'x' });
      expect(res.statusCode).toBe(403);
    });
  });
});
