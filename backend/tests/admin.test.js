'use strict';

const request = require('supertest');
const app = require('../src/app');
const { pool, cleanupDB, seedBaselineData, getAllUsers } = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Admin Functions', () => {
  let adminUser, judgeUser;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    adminUser = users.find(u => u.role === 'admin');
    judgeUser = users.find(u => u.role === 'judge');
  });

  afterEach(async () => {
    // Clear test users
    await pool.query('DELETE FROM users WHERE email LIKE $1', ['test_admin_%@feosport.local']);
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  describe('GET /api/admin/users', () => {
    test('Admin can list all users', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(4); // baseline users
    });

    test('Non-admin cannot list users', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(403);
    });

    test('Unauthenticated request returns 401', async () => {
      const res = await request(app)
        .get('/api/admin/users');

      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/admin/users', () => {
    test('Admin can create new user', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          email: 'test_admin_newuser@feosport.local',
          password: 'password123',
          role: 'judge'
        });

      expect([200, 201]).toContain(res.statusCode);
      if (res.statusCode === 200 || res.statusCode === 201) {
        expect(res.body).toHaveProperty('id');
        expect(res.body.email).toBe('test_admin_newuser@feosport.local');
      }
    });

    test('Non-admin cannot create user', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .set('Authorization', authHeader(judgeUser.id, 'judge'))
        .send({
          email: 'test_admin_denied@feosport.local',
          password: 'password123',
          role: 'pilot'
        });

      expect(res.statusCode).toBe(403);
    });

    test('Duplicate email returns 409', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          email: 'admin@feosport.local', // already exists
          password: 'password123',
          role: 'judge'
        });

      expect(res.statusCode).toBe(409);
    });

    test('Short password returns 400', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          email: 'test_admin_shortpwd@feosport.local',
          password: '123',
          role: 'judge'
        });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/admin/users/:id', () => {
    test('Admin can update another user role', async () => {
      const users = await getAllUsers();
      const targetUser = users.find(u => u.role === 'judge' && u.email !== 'judge@feosport.local');

      if (!targetUser) {
        // Create one if doesn't exist
        const createRes = await request(app)
          .post('/api/admin/users')
          .set('Authorization', authHeader(adminUser.id, 'admin'))
          .send({
            email: 'test_admin_changeRole@feosport.local',
            password: 'password123',
            role: 'judge'
          });

        if (createRes.statusCode !== 201 && createRes.statusCode !== 200) {
          return;
        }
      }

      const allUsers = await getAllUsers();
      const user = allUsers.find(u => u.email === 'test_admin_changeRole@feosport.local') || allUsers.find(u => u.role === 'judge');

      const res = await request(app)
        .patch(`/api/admin/users/${user.id}`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          role: 'chief_judge'
        });

      expect([200, 204]).toContain(res.statusCode);
    });

    test('Admin cannot change own role', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${adminUser.id}`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          role: 'pilot'
        });

      expect(res.statusCode).toBe(403);
    });

    test('Admin cannot deactivate self', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${adminUser.id}`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          is_active: false
        });

      expect(res.statusCode).toBe(403);
    });

    test('Non-admin cannot update users', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${judgeUser.id}`)
        .set('Authorization', authHeader(judgeUser.id, 'judge'))
        .send({
          role: 'admin'
        });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /api/admin/db/status', () => {
    test('Returns PostgreSQL connection status', async () => {
      const res = await request(app)
        .get('/api/admin/db/status')
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('ok');
      expect(res.body).toHaveProperty('connection');
      expect(res.body.connection).toHaveProperty('host');
      expect(res.body.connection).toHaveProperty('database');
    });

    test('Reports baseline users count', async () => {
      const res = await request(app)
        .get('/api/admin/db/status')
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('baselineUsers');
      expect(res.body.baselineUsers).toBeGreaterThanOrEqual(4); // 4 baseline users
    });

    test('Non-admin cannot access db status', async () => {
      const res = await request(app)
        .get('/api/admin/db/status')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/admin/db/pgadmin/start', () => {
    test('Admin can attempt to start pgAdmin', async () => {
      const res = await request(app)
        .post('/api/admin/db/pgadmin/start')
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect([200, 404]).toContain(res.statusCode);
      expect(res.body).toHaveProperty('ok');
    });

    test('Non-admin cannot start pgAdmin', async () => {
      const res = await request(app)
        .post('/api/admin/db/pgadmin/start')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(403);
    });

    test('Returns helpful error when pgAdmin not found', async () => {
      const res = await request(app)
        .post('/api/admin/db/pgadmin/start')
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      if (res.statusCode === 404) {
        expect(res.body).toHaveProperty('error');
        expect(res.body.error.toLowerCase()).toContain('pgadmin');
      }
    });
  });

  describe('POST /api/admin/demo-data', () => {
    test('Admin can generate showcase demo data', async () => {
      const res = await request(app)
        .post('/api/admin/demo-data')
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('competition_name', 'Кубок Севастополя 2025');
      expect(res.body.summary).toMatchObject({
        teams: 4,
        pilots: 16,
        applications: 4,
        penalties: 2,
        protests: 1,
        protocols: 4,
      });

      const competitions = await pool.query(
        'SELECT id FROM competitions WHERE name = $1',
        ['Кубок Севастополя 2025']
      );
      expect(competitions.rowCount).toBe(1);
    });

    test('Non-admin cannot generate demo data', async () => {
      const res = await request(app)
        .post('/api/admin/demo-data')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(403);
    });
  });
});
