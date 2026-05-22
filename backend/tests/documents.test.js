'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const crypto = require('crypto');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feosport-docs-'));
process.env.DOCUMENTS_ROOT = tmpRoot;

const request = require('supertest');
const app = require('../src/app');
const {
  pool, cleanupDB, seedBaselineData, getAllUsers,
  createTestPilot,
} = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Documents API', () => {
  let adminUser, judgeUser;
  let pilot;
  const createdFiles = [];

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    adminUser = users.find(u => u.role === 'admin');
    judgeUser = users.find(u => u.role === 'judge');
  });

  beforeEach(async () => {
    pilot = await createTestPilot('Test_Doc', 'Owner');
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM documents WHERE pilot_id IN (SELECT id FROM pilots WHERE first_name LIKE 'Test_Doc%')`);
    await pool.query(`DELETE FROM pilots WHERE first_name LIKE 'Test_Doc%'`);
  });

  afterAll(async () => {
    for (const f of createdFiles) {
      try { fs.unlinkSync(f); } catch { /* */ }
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    await cleanupDB();
    await pool.end();
  });

  function makeFakePdf(bytes = 'fake pdf content for unit test') {
    const tmp = path.join(os.tmpdir(), `upload-src-${crypto.randomBytes(4).toString('hex')}.pdf`);
    fs.writeFileSync(tmp, bytes);
    createdFiles.push(tmp);
    return tmp;
  }

  test('POST /api/documents — uploads pdf for pilot', async () => {
    const src = makeFakePdf('passport scan bytes');
    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .field('doc_type', 'passport')
      .field('pilot_id', String(pilot.id))
      .attach('file', src);

    expect(res.statusCode).toBe(201);
    expect(res.body.doc_type).toBe('passport');
    // file_size_bytes is BIGINT — pg returns it as a string.
    expect(Number(res.body.file_size_bytes)).toBeGreaterThan(0);
    expect(res.body.file_hash_sha256).toMatch(/^[a-f0-9]{64}$/);

    // File should physically exist under tmpRoot.
    const absPath = path.join(tmpRoot, res.body.file_path);
    expect(fs.existsSync(absPath)).toBe(true);
  });

  test('POST /api/documents — recorded sha256 matches the bytes', async () => {
    const bytes = 'medical clearance valid until 2027';
    const src = makeFakePdf(bytes);
    const expected = crypto.createHash('sha256').update(bytes).digest('hex');

    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .field('doc_type', 'medical_clearance')
      .field('pilot_id', String(pilot.id))
      .field('valid_until', '2027-12-31')
      .attach('file', src);

    expect(res.statusCode).toBe(201);
    expect(res.body.file_hash_sha256).toBe(expected);
  });

  test('POST /api/documents — rejects disallowed mime type', async () => {
    const exe = path.join(os.tmpdir(), `bad-${Date.now()}.exe`);
    fs.writeFileSync(exe, 'MZ\x90\x00\x03'); // PE-ish header
    createdFiles.push(exe);

    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .field('doc_type', 'passport')
      .field('pilot_id', String(pilot.id))
      .attach('file', exe, { contentType: 'application/x-msdownload' });

    expect(res.statusCode).toBe(415);
  });

  test('POST /api/documents — rejects unknown doc_type', async () => {
    const src = makeFakePdf();
    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .field('doc_type', 'random_paper')
      .field('pilot_id', String(pilot.id))
      .attach('file', src);

    expect(res.statusCode).toBe(400);
  });

  test('POST /api/documents — requires at least one owner', async () => {
    const src = makeFakePdf();
    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .field('doc_type', 'passport')
      .attach('file', src);

    expect(res.statusCode).toBe(400);
  });

  test('POST /api/documents — requires authentication', async () => {
    const src = makeFakePdf();
    const res = await request(app)
      .post('/api/documents')
      .field('doc_type', 'passport')
      .field('pilot_id', String(pilot.id))
      .attach('file', src);

    expect(res.statusCode).toBe(401);
  });

  test('GET /api/documents?pilot_id=… — filters', async () => {
    const src = makeFakePdf();
    await request(app).post('/api/documents')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .field('doc_type', 'passport').field('pilot_id', String(pilot.id))
      .attach('file', src);

    const res = await request(app)
      .get(`/api/documents?pilot_id=${pilot.id}`)
      .set('Authorization', authHeader(judgeUser.id, 'judge'));

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(1);
  });

  test('GET /api/documents/:id/download — streams the same bytes', async () => {
    const bytes = 'small content payload to verify integrity';
    const src = makeFakePdf(bytes);
    const created = await request(app)
      .post('/api/documents')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .field('doc_type', 'passport').field('pilot_id', String(pilot.id))
      .attach('file', src);

    const dl = await request(app)
      .get(`/api/documents/${created.body.id}/download`)
      .set('Authorization', authHeader(judgeUser.id, 'judge'))
      .buffer().parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end',  () => cb(null, Buffer.concat(chunks)));
      });

    expect(dl.statusCode).toBe(200);
    expect(dl.body.toString()).toBe(bytes);
  });

  test('DELETE /api/documents/:id — admin removes record + file', async () => {
    const src = makeFakePdf();
    const created = await request(app)
      .post('/api/documents')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .field('doc_type', 'passport').field('pilot_id', String(pilot.id))
      .attach('file', src);

    const absPath = path.join(tmpRoot, created.body.file_path);
    expect(fs.existsSync(absPath)).toBe(true);

    const del = await request(app)
      .delete(`/api/documents/${created.body.id}`)
      .set('Authorization', authHeader(adminUser.id, 'admin'));
    expect(del.statusCode).toBe(200);
    expect(fs.existsSync(absPath)).toBe(false);
  });

  test('DELETE /api/documents/:id — judge cannot delete', async () => {
    const src = makeFakePdf();
    const created = await request(app)
      .post('/api/documents')
      .set('Authorization', authHeader(adminUser.id, 'admin'))
      .field('doc_type', 'passport').field('pilot_id', String(pilot.id))
      .attach('file', src);

    const del = await request(app)
      .delete(`/api/documents/${created.body.id}`)
      .set('Authorization', authHeader(judgeUser.id, 'judge'));
    expect(del.statusCode).toBe(403);
  });
});
