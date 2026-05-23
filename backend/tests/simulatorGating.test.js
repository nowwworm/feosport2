'use strict';

// Integration test for simulator-aware code paths:
//   * GET /api/heats/:id/channel-conflicts skips physical channel check
//     for simulator competitions (no video channels in software races).

const request = require('supertest');
const app = require('../src/app');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers,
  createTestCompetition, createTestPilot, createTestHeat, addHeatParticipant,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Simulator discipline gating', () => {
  let judgeUser;
  let simCompetition, classCompetition, simHeat, classHeat;
  let pilots = [];
  let simulatorDisciplineId, classDisciplineId;
  let channelR1;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    judgeUser = users.find(u => u.role === 'judge');

    const { rows: discRows } = await pool.query(
      `SELECT id, code, category FROM disciplines
        WHERE code IN ('simulator', 'class_75mm') ORDER BY code`
    );
    classDisciplineId     = discRows.find(d => d.code === 'class_75mm').id;
    simulatorDisciplineId = discRows.find(d => d.code === 'simulator').id;

    const { rows: chs } = await pool.query(
      `SELECT id FROM video_channels WHERE code = 'R1'`
    );
    channelR1 = chs[0];
  });

  beforeEach(async () => {
    simCompetition = await createTestCompetition('Test_Sim_Sim', 'qualification');
    classCompetition = await createTestCompetition('Test_Sim_Class', 'qualification');

    await pool.query(
      `UPDATE competitions SET discipline_id = $1 WHERE id = $2`,
      [simulatorDisciplineId, simCompetition.id]
    );
    await pool.query(
      `UPDATE competitions SET discipline_id = $1 WHERE id = $2`,
      [classDisciplineId, classCompetition.id]
    );

    simHeat   = await createTestHeat(simCompetition.id,   judgeUser.id);
    classHeat = await createTestHeat(classCompetition.id, judgeUser.id);

    pilots = [];
    for (let i = 0; i < 2; i++) {
      const p = await createTestPilot(`Test_SimGate_${i}`, 'Pilot');
      pilots.push(p);
      await addHeatParticipant(simHeat.id,   p.id, i + 1);
      await addHeatParticipant(classHeat.id, p.id, i + 1);
    }

    // Give both class pilots the same channel so the physical heat WOULD conflict.
    for (const p of pilots) {
      await pool.query(
        `INSERT INTO drones (pilot_id, drone_class, video_channel_id, is_active,
                             has_failsafe, has_prop_guards)
         VALUES ($1, '75mm', $2, true, true, true)`,
        [p.id, channelR1.id]
      );
    }
  });

  afterEach(async () => {
    await pool.query(
      `DELETE FROM drones WHERE pilot_id IN
         (SELECT id FROM pilots WHERE first_name LIKE 'Test_SimGate_%')`
    );
    await pool.query(`DELETE FROM competitions WHERE name LIKE 'Test_Sim_%'`);
    await pool.query(`DELETE FROM pilots WHERE first_name LIKE 'Test_SimGate_%'`);
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  test('simulator competition skips channel-conflicts check', async () => {
    const res = await request(app)
      .get(`/api/heats/${simHeat.id}/channel-conflicts`)
      .set('Authorization', authHeader(judgeUser.id, 'judge'));

    expect(res.statusCode).toBe(200);
    expect(res.body.skipped).toBe(true);
    expect(res.body.reason).toBe('simulator');
    expect(res.body.conflicts).toEqual([]);
    expect(res.body.assignments).toEqual([]);
  });

  test('class competition still detects channel conflicts', async () => {
    const res = await request(app)
      .get(`/api/heats/${classHeat.id}/channel-conflicts`)
      .set('Authorization', authHeader(judgeUser.id, 'judge'));

    expect(res.statusCode).toBe(200);
    expect(res.body.skipped).toBeUndefined();
    expect(res.body.conflicts.length).toBe(1);
    expect(res.body.conflicts[0].pilots.sort((a, b) => a - b))
      .toEqual([pilots[0].id, pilots[1].id].sort((a, b) => a - b));
  });
});
