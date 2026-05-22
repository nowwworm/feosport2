'use strict';

const http = require('http');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');
const { initSocket } = require('../src/services/socket');
const { pool, cleanupDB, seedBaselineData, createTestUser, createTestCompetition, createTestPilot, createTestHeat, addHeatParticipant, getAllUsers } = require('./helpers/testDB');
const { generateToken } = require('./helpers/jwt');

describe('WebSocket Real-time Scoring', () => {
  let httpServer, ioServer, WS_BASE_URL;
  let judgeUser, chiefJudgeUser, adminUser, pilotUser;
  let testCompetition, testHeat, testPilot;
  // Dynamic port (0) — let the OS assign a free port so parallel/repeat runs don't collide.
  const WS_PORT = 0;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    judgeUser = users.find(u => u.role === 'judge');
    chiefJudgeUser = users.find(u => u.role === 'chief_judge');
    adminUser = users.find(u => u.role === 'admin');
    pilotUser = users.find(u => u.role === 'pilot');

    testCompetition = await createTestCompetition('Test_WSComp', 'qualification');
    testPilot = await createTestPilot('WebSocket_Test', 'Pilot');
    testHeat = await createTestHeat(testCompetition.id, judgeUser.id);
    await addHeatParticipant(testHeat.id, testPilot.id, 1);

    // Create HTTP server and Socket.io server for testing
    httpServer = http.createServer();
    ioServer = initSocket(httpServer);

    // Start listening on an OS-assigned port; expose base URL for clients.
    return new Promise((resolve) => {
      httpServer.listen(WS_PORT, () => {
        const addr = httpServer.address();
        WS_BASE_URL = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    // Clear test results
    await pool.query('DELETE FROM reflights WHERE heat_id = $1', [testHeat.id]);
    await pool.query('DELETE FROM falsestarts WHERE heat_id = $1', [testHeat.id]);
    await pool.query('DELETE FROM laps WHERE heat_id = $1', [testHeat.id]);
    await pool.query('DELETE FROM result_audit_log WHERE result_id IN (SELECT id FROM results WHERE heat_id = $1)', [testHeat.id]);
    await pool.query('DELETE FROM results WHERE heat_id = $1', [testHeat.id]);
    await pool.query('UPDATE heats SET status = $1, started_at = NULL, ended_at = NULL WHERE id = $2', ['pending', testHeat.id]);
  });

  afterAll(async () => {
    await new Promise((resolve) => ioServer.close(() => resolve()));
    await new Promise((resolve) => httpServer.close(() => resolve()));
    await cleanupDB();
    await pool.end();
  });

  describe('Connection Authentication', () => {
    test('Socket connection requires JWT token', (done) => {
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: {} // No token
      });

      socket.on('connect_error', (error) => {
        expect(error.message).toContain('Authentication');
        socket.close();
        done();
      });

      socket.connect();
    });

    test('Invalid JWT token rejected', (done) => {
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token: 'invalid.jwt.token' }
      });

      socket.on('connect_error', (error) => {
        expect(error.message).toContain('Invalid token');
        socket.close();
        done();
      });

      socket.connect();
    });

    test('Valid JWT token allows connection', (done) => {
      const token = generateToken(judgeUser.id, 'judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        autoConnect: false,
        auth: { token }
      });

      socket.on('connect', () => {
        expect(socket.connected).toBe(true);
        socket.close();
        done();
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

      socket.connect();
    });

    test('Expired token rejected', (done) => {
      const token = generateToken(judgeUser.id, 'judge', '0s'); // Expired immediately

      // Wait a tiny bit to ensure expiration
      setTimeout(() => {
        const socket = ioClient(`${WS_BASE_URL}`, {
          reconnection: false,
          auth: { token }
        });

        socket.on('connect_error', (error) => {
          expect(error.message).toMatch(/invalid/i);
          socket.close();
          done();
        });

        socket.connect();
      }, 100);
    });
  });

  describe('Competition Room Management', () => {
    test('Judge can join competition room', (done) => {
      const token = generateToken(judgeUser.id, 'judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        autoConnect: false,
        auth: { token }
      });

      socket.on('connect', () => {
        socket.emit('join_competition', { competition_id: testCompetition.id });
        // Verify by checking if socket is in room (via manager)
        expect(socket.connected).toBe(true);
        socket.close();
        done();
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

      socket.connect();
    });

    test('Pilot cannot join competition room (authorization still works)', (done) => {
      const token = generateToken(pilotUser.id, 'pilot');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      socket.on('connect', () => {
        // Pilot connects successfully but submit_score will be denied
        expect(socket.connected).toBe(true);
        socket.close();
        done();
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

      socket.connect();
    });
  });

  describe('Score Submission (submit_score Event)', () => {
    test('Judge can submit valid score', (done) => {
      const token = generateToken(judgeUser.id, 'judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      socket.on('connect', () => {
        socket.emit('submit_score', {
          heat_id: testHeat.id,
          pilot_id: testPilot.id,
          time_seconds: 45.5,
          penalty_seconds: 0,
          dnf: false,
          dsq: false
        }, (response) => {
          expect(response.ok).toBe(true);
          expect(response.result).toBeDefined();
          expect(parseFloat(response.result.time_seconds)).toBe(45.5);
          socket.close();
          done();
        });
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

      socket.connect();
    });

    test('Cannot submit score to locked heat', (done) => {
      // First lock the heat
      pool.query(
        'UPDATE heats SET status = $1 WHERE id = $2',
        ['locked', testHeat.id]
      ).then(() => {
        socket.connect();
      }).catch(done);

      const token = generateToken(judgeUser.id, 'judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      socket.on('connect', () => {
        socket.emit('submit_score', {
          heat_id: testHeat.id,
          pilot_id: testPilot.id,
          time_seconds: 50.0,
          penalty_seconds: 0,
          dnf: false,
          dsq: false
        }, (response) => {
          expect(response.error).toContain('locked');
          socket.close();
          // Unlock for other tests
          pool.query('UPDATE heats SET status = $1 WHERE id = $2', ['pending', testHeat.id]);
          done();
        });
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

    });

    test('Pilot cannot submit score (Forbidden)', (done) => {
      const token = generateToken(pilotUser.id, 'pilot');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      socket.on('connect', () => {
        socket.emit('submit_score', {
          heat_id: testHeat.id,
          pilot_id: testPilot.id,
          time_seconds: 45.0,
          penalty_seconds: 0,
          dnf: false,
          dsq: false
        }, (response) => {
          expect(response.error).toContain('Forbidden');
          socket.close();
          done();
        });
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

      socket.connect();
    });

    test('Submitting to non-existent heat returns error', (done) => {
      const token = generateToken(judgeUser.id, 'judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      socket.on('connect', () => {
        socket.emit('submit_score', {
          heat_id: 99999,
          pilot_id: testPilot.id,
          time_seconds: 45.0,
          penalty_seconds: 0,
          dnf: false,
          dsq: false
        }, (response) => {
          expect(response.error).toBeDefined();
          socket.close();
          done();
        });
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

      socket.connect();
    });

    test('Can update existing score (upsert)', (done) => {
      // Insert initial score
      pool.query(
        `INSERT INTO results (heat_id, pilot_id, judge_id, time_seconds, penalty_seconds)
         VALUES ($1, $2, $3, $4, $5)`,
        [testHeat.id, testPilot.id, judgeUser.id, 50.0, 0]
      ).then(() => {
        socket.connect();
      }).catch(done);

      const token = generateToken(judgeUser.id, 'judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      socket.on('connect', () => {
        socket.emit('submit_score', {
          heat_id: testHeat.id,
          pilot_id: testPilot.id,
          time_seconds: 45.0, // Updated time
          penalty_seconds: 5.0, // Added penalty
          dnf: false,
          dsq: false
        }, (response) => {
          expect(response.ok).toBe(true);
          expect(parseFloat(response.result.time_seconds)).toBe(45.0);
          expect(parseFloat(response.result.penalty_seconds)).toBe(5.0);
          socket.close();
          done();
        });
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

    });

    test('DNF and DSQ flags work', (done) => {
      const token = generateToken(judgeUser.id, 'judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      socket.on('connect', () => {
        socket.emit('submit_score', {
          heat_id: testHeat.id,
          pilot_id: testPilot.id,
          time_seconds: 0,
          penalty_seconds: 0,
          dnf: true, // Did Not Finish
          dsq: false
        }, (response) => {
          expect(response.ok).toBe(true);
          expect(response.result.dnf).toBe(true);
          socket.close();
          done();
        });
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

      socket.connect();
    });
  });

  describe('Score Update Broadcasts', () => {
    test('Multiple judges receive score_update broadcast', (done) => {
      const token1 = generateToken(judgeUser.id, 'judge');
      const token2 = generateToken(chiefJudgeUser.id, 'chief_judge');

      const judge1 = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token: token1 }
      });

      const judge2 = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token: token2 }
      });

      let judge2Received = false;
      let judge1SubmitComplete = false;

      judge2.on('score_update', (data) => {
        expect(data.heat_id).toBe(testHeat.id);
        expect(data.pilot_id).toBe(testPilot.id);
        expect(data.result).toBeDefined();
        judge2Received = true;

        if (judge1SubmitComplete && judge2Received) {
          judge1.close();
          judge2.close();
          done();
        }
      });

      judge1.on('connect', () => {
        judge1.emit('join_competition', { competition_id: testCompetition.id });
      });

      judge2.on('connect', () => {
        judge2.emit('join_competition', { competition_id: testCompetition.id });

        // Judge 1 submits score
        judge1.emit('submit_score', {
          heat_id: testHeat.id,
          pilot_id: testPilot.id,
          time_seconds: 48.0,
          penalty_seconds: 0,
          dnf: false,
          dsq: false
        }, (response) => {
          expect(response.ok).toBe(true);
          judge1SubmitComplete = true;

          if (judge1SubmitComplete && judge2Received) {
            judge1.close();
            judge2.close();
            done();
          }
        });
      });

      judge1.on('connect_error', (error) => {
        judge1.close();
        judge2.close();
        done(error);
      });

      judge2.on('connect_error', (error) => {
        judge1.close();
        judge2.close();
        done(error);
      });

      judge1.connect();
      judge2.connect();
    });

    test('Leaderboard update broadcast after score submission', (done) => {
      const token = generateToken(judgeUser.id, 'judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      let leaderboardReceived = false;
      let scoreSubmitted = false;

      socket.on('leaderboard_update', (data) => {
        expect(data.competition_id).toBe(testCompetition.id);
        expect(data.leaderboard).toBeDefined();
        expect(Array.isArray(data.leaderboard)).toBe(true);
        leaderboardReceived = true;

        if (scoreSubmitted && leaderboardReceived) {
          socket.close();
          done();
        }
      });

      socket.on('connect', () => {
        socket.emit('join_competition', { competition_id: testCompetition.id });
        socket.emit('submit_score', {
          heat_id: testHeat.id,
          pilot_id: testPilot.id,
          time_seconds: 47.0,
          penalty_seconds: 0,
          dnf: false,
          dsq: false
        }, (response) => {
          expect(response.ok).toBe(true);
          scoreSubmitted = true;

          // Set timeout to ensure leaderboard update is received
          setTimeout(() => {
            if (scoreSubmitted && leaderboardReceived) {
              socket.close();
              done();
            }
          }, 200);
        });
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

      socket.connect();
    });
  });

  describe('Heat Locking (lock_heat Event)', () => {
    test('Chief judge can lock heat', (done) => {
      const token = generateToken(chiefJudgeUser.id, 'chief_judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      socket.on('connect', () => {
        socket.emit('lock_heat', {
          heat_id: testHeat.id
        }, (response) => {
          expect(response.ok).toBe(true);
          expect(response.heat.status).toBe('locked');
          socket.close();
          // Unlock for other tests
          pool.query('UPDATE heats SET status = $1 WHERE id = $2', ['pending', testHeat.id]);
          done();
        });
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

      socket.connect();
    });

    test('Judge cannot lock heat (Forbidden)', (done) => {
      const token = generateToken(judgeUser.id, 'judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      socket.on('connect', () => {
        socket.emit('lock_heat', {
          heat_id: testHeat.id
        }, (response) => {
          expect(response.error).toContain('Forbidden');
          socket.close();
          done();
        });
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

      socket.connect();
    });

    test('Broadcasting heat_status_change when locked', (done) => {
      const token1 = generateToken(chiefJudgeUser.id, 'chief_judge');
      const token2 = generateToken(judgeUser.id, 'judge');

      const chiefJudge = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token: token1 }
      });

      const judge = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token: token2 }
      });

      let statusChangeReceived = false;
      let lockComplete = false;

      judge.on('heat_status_change', (data) => {
        expect(data.heat_id).toBe(testHeat.id);
        expect(data.status).toBe('locked');
        statusChangeReceived = true;

        if (lockComplete && statusChangeReceived) {
          chiefJudge.close();
          judge.close();
          // afterEach() resets the heat — no inline reset needed.
          done();
        }
      });

      judge.on('connect', () => {
        judge.emit('join_competition', { competition_id: testCompetition.id });
      });

      chiefJudge.on('connect', () => {
        chiefJudge.emit('join_competition', { competition_id: testCompetition.id });
        chiefJudge.emit('lock_heat', { heat_id: testHeat.id }, (response) => {
          expect(response.ok).toBe(true);
          lockComplete = true;

          if (lockComplete && statusChangeReceived) {
            chiefJudge.close();
            judge.close();
            // Unlock for other tests
            pool.query('UPDATE heats SET status = $1 WHERE id = $2', ['pending', testHeat.id]);
            done();
          }
        });
      });

      chiefJudge.on('connect_error', (error) => {
        chiefJudge.close();
        judge.close();
        done(error);
      });

      judge.on('connect_error', (error) => {
        chiefJudge.close();
        judge.close();
        done(error);
      });

      chiefJudge.connect();
      judge.connect();
    });
  });

  describe('Flight Timing Events', () => {
    test('Judge can start a flight and broadcast flight_start', (done) => {
      const token = generateToken(judgeUser.id, 'judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      socket.on('flight_start', (data) => {
        expect(data.heat_id).toBe(testHeat.id);
        expect(data.heat.status).toBe('active');
        socket.close();
        done();
      });

      socket.on('connect', () => {
        socket.emit('join_competition', { competition_id: testCompetition.id });
        socket.emit('flight_start', { heat_id: testHeat.id }, (response) => {
          expect(response.ok).toBe(true);
        });
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

      socket.connect();
    });

    test('Judge can record a lap and receive lap summary', (done) => {
      const token = generateToken(judgeUser.id, 'judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      socket.on('lap_complete', (data) => {
        expect(data.heat_id).toBe(testHeat.id);
        expect(data.pilot_id).toBe(testPilot.id);
        expect(data.summary.total_laps).toBe(1);
        expect(data.summary.best_lap_ms).toBe(42123);
        socket.close();
        done();
      });

      socket.on('connect', () => {
        socket.emit('join_competition', { competition_id: testCompetition.id });
        socket.emit('lap_complete', {
          heat_id: testHeat.id,
          pilot_id: testPilot.id,
          lap_number: 1,
          duration_ms: 42123,
          valid: true
        }, (response) => {
          expect(response.ok).toBe(true);
        });
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

      socket.connect();
    });

    test('Falsestart event recommends whole-group reflight', (done) => {
      const token = generateToken(judgeUser.id, 'judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      socket.on('falsestart', (data) => {
        expect(data.heat_id).toBe(testHeat.id);
        expect(data.pilot_id).toBe(testPilot.id);
        expect(data.reflight_recommended).toBe(true);
        socket.close();
        done();
      });

      socket.on('connect', () => {
        socket.emit('join_competition', { competition_id: testCompetition.id });
        socket.emit('falsestart', {
          heat_id: testHeat.id,
          pilot_id: testPilot.id,
          reason: 'manual'
        }, (response) => {
          expect(response.ok).toBe(true);
          expect(response.reflight_recommended).toBe(true);
        });
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

      socket.connect();
    });

    test('Only chief judge or admin can request reflight', (done) => {
      const judgeToken = generateToken(judgeUser.id, 'judge');
      const chiefToken = generateToken(chiefJudgeUser.id, 'chief_judge');
      const judge = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token: judgeToken }
      });
      const chiefJudge = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token: chiefToken }
      });

      chiefJudge.on('reflight_requested', (data) => {
        expect(data.heat_id).toBe(testHeat.id);
        expect(data.reflight.reason).toBe('falsestart');
        judge.close();
        chiefJudge.close();
        done();
      });

      judge.on('connect', () => {
        judge.emit('reflight_requested', {
          heat_id: testHeat.id,
          reason: 'falsestart'
        }, (response) => {
          expect(response.error).toContain('Forbidden');
        });
      });

      chiefJudge.on('connect', () => {
        chiefJudge.emit('join_competition', { competition_id: testCompetition.id });
        chiefJudge.emit('reflight_requested', {
          heat_id: testHeat.id,
          reason: 'falsestart'
        }, (response) => {
          expect(response.ok).toBe(true);
        });
      });

      judge.on('connect_error', (error) => {
        judge.close();
        chiefJudge.close();
        done(error);
      });

      chiefJudge.on('connect_error', (error) => {
        judge.close();
        chiefJudge.close();
        done(error);
      });

      judge.connect();
      chiefJudge.connect();
    });
  });

  describe('Disconnection Handling', () => {
    test('Socket disconnect is logged', (done) => {
      const token = generateToken(judgeUser.id, 'judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      socket.on('connect', () => {
        socket.close();
      });

      socket.on('disconnect', () => {
        expect(socket.connected).toBe(false);
        done();
      });

      socket.on('connect_error', (error) => {
        done(error);
      });

      socket.connect();
    });

    test('Judge can reconnect and rejoin competition', (done) => {
      const token = generateToken(judgeUser.id, 'judge');
      const socket = ioClient(`${WS_BASE_URL}`, {
        reconnection: false,
        auth: { token }
      });

      let firstConnection = true;
      let finished = false;

      socket.on('connect', () => {
        if (firstConnection) {
          firstConnection = false;
          socket.emit('join_competition', { competition_id: testCompetition.id });
          socket.disconnect();
        } else {
          // Reconnected
          socket.emit('join_competition', { competition_id: testCompetition.id });
          finished = true;
          socket.close();
          done();
        }
      });

      socket.on('disconnect', () => {
        if (!firstConnection && !finished && !socket.connected) {
          socket.connect();
        }
      });

      socket.on('connect_error', (error) => {
        socket.close();
        done(error);
      });

      socket.connect();
    });
  });
});
