'use strict';

// Integration test for the 500ms-throttled leaderboard broadcast triggered
// by lap_complete events. Verifies (a) lap_complete now triggers an emit
// and (b) bursts of laps coalesce into at most two emits per window
// (one immediate + one trailing-edge).

const http = require('http');
const { io: ioClient } = require('socket.io-client');
const { initSocket, _resetLeaderboardThrottle } = require('../src/services/socket');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers,
  createTestCompetition, createTestPilot, createTestHeat, addHeatParticipant,
} = require('./helpers/testDB');
const { generateToken } = require('./helpers/jwt');

describe('Leaderboard WS throttle (500ms)', () => {
  let httpServer, ioServer, WS_BASE_URL;
  let judgeUser;
  let competition, heat, pilot;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    judgeUser = users.find(u => u.role === 'judge');

    httpServer = http.createServer();
    ioServer = initSocket(httpServer);
    await new Promise((resolve) => {
      httpServer.listen(0, () => {
        WS_BASE_URL = `http://localhost:${httpServer.address().port}`;
        resolve();
      });
    });
  });

  beforeEach(async () => {
    _resetLeaderboardThrottle();
    competition = await createTestCompetition('Test_LBWS', 'qualification');
    heat = await createTestHeat(competition.id, judgeUser.id);
    pilot = await createTestPilot('LBWS', 'Pilot');
    await addHeatParticipant(heat.id, pilot.id, 1);
  });

  afterEach(async () => {
    _resetLeaderboardThrottle();
    await pool.query('DELETE FROM laps WHERE heat_id = $1', [heat.id]);
    await pool.query('DELETE FROM competitions WHERE name = $1', ['Test_LBWS']);
    await pool.query('DELETE FROM pilots WHERE first_name = $1', ['LBWS']);
  });

  afterAll(async () => {
    await new Promise((resolve) => ioServer.close(() => resolve()));
    await new Promise((resolve) => httpServer.close(() => resolve()));
    await cleanupDB();
    await pool.end();
  });

  function connectClient(user, role) {
    const token = generateToken(user.id, role);
    const sock = ioClient(WS_BASE_URL, { reconnection: false, auth: { token } });
    return sock;
  }

  test('lap_complete triggers a leaderboard_update', (done) => {
    const sock = connectClient(judgeUser, 'judge');
    sock.on('connect', () => {
      sock.emit('join_competition', { competition_id: competition.id });
      sock.on('leaderboard_update', (payload) => {
        try {
          expect(payload.competition_id).toBe(competition.id);
          expect(Array.isArray(payload.leaderboard)).toBe(true);
          sock.close();
          done();
        } catch (err) {
          sock.close();
          done(err);
        }
      });
      setTimeout(() => {
        sock.emit('lap_complete', {
          heat_id: heat.id,
          pilot_id: pilot.id,
          lap_number: 1,
          duration_ms: 11000,
        });
      }, 50);
    });
  }, 5000);

  test('burst of lap_completes coalesces into at most two emits per 500ms window', (done) => {
    const sock = connectClient(judgeUser, 'judge');
    let updates = 0;
    sock.on('connect', () => {
      sock.emit('join_competition', { competition_id: competition.id });
      sock.on('leaderboard_update', () => { updates += 1; });

      setTimeout(() => {
        // Fire 5 lap_complete events rapidly within the 500ms window
        for (let i = 1; i <= 5; i++) {
          sock.emit('lap_complete', {
            heat_id: heat.id,
            pilot_id: pilot.id,
            lap_number: i,
            duration_ms: 10000 + i * 100,
          });
        }
      }, 50);

      setTimeout(() => {
        try {
          // One immediate + at most one trailing emit
          expect(updates).toBeGreaterThanOrEqual(1);
          expect(updates).toBeLessThanOrEqual(2);
          sock.close();
          done();
        } catch (err) {
          sock.close();
          done(err);
        }
      }, 900);
    });
  }, 5000);
});
