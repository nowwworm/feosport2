'use strict';

const router   = require('express').Router();
const { execFile } = require('child_process');
const path     = require('path');
const bcrypt   = require('bcryptjs');
const pool     = require('../config/db');
const { getDbAdminStatus, startPgAdmin } = require('../services/dbAdminTools');
const { generateDemoData } = require('../services/demoData');
const { authenticate, authorize } = require('../middleware/auth');

// ── Все admin-маршруты требуют аутентификации ──────────────────────────────
// Авторизация задаётся per-route, потому что chief_judge имеет read-доступ
// (см. auth.test.js «Chief judge can access admin endpoints»), а write-доступ
// — только admin (см. admin.test.js «Non-admin cannot create user»).
router.use(authenticate);
const adminOnly      = authorize('admin');
const adminOrChief   = authorize('admin', 'chief_judge');

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/admin/users  — список всех пользователей
// ─────────────────────────────────────────────────────────────────────────────
router.get('/users', adminOrChief, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, r.name AS role, u.is_active, u.created_at
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.id`
    );
    res.json(rows);
  } catch (err) {
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/admin/db/status — безопасная сводка по PostgreSQL для админки
// ─────────────────────────────────────────────────────────────────────────────
router.get('/db/status', adminOnly, async (req, res) => {
  try {
    const status = await getDbAdminStatus(pool, process.env);
    res.json(status);
  } catch (err) {
    console.error('[admin/db/status]', err);
    res.status(500).json({
      ok: false,
      error: 'Не удалось получить статус PostgreSQL',
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/admin/db/pgadmin/start — открыть pgAdmin на Windows-хосте
// ─────────────────────────────────────────────────────────────────────────────
router.post('/db/pgadmin/start', adminOnly, async (req, res) => {
  try {
    const result = await startPgAdmin();
    if (!result.ok) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[admin/db/pgadmin/start]', err);
    res.status(500).json({
      ok: false,
      error: 'Не удалось запустить pgAdmin',
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/admin/demo-data — пересоздать презентационный набор данных
// ─────────────────────────────────────────────────────────────────────────────
router.post('/demo-data', adminOnly, async (req, res) => {
  try {
    const result = await generateDemoData(req.user.id);
    res.status(201).json(result);
  } catch (err) {
    console.error('[admin/demo-data]', err);
    res.status(500).json({
      ok: false,
      error: 'Не удалось сгенерировать тестовые данные',
      details: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/admin/users  — создать нового пользователя
//  Body: { email, password, role }  где role — строка: admin|chief_judge|judge|pilot
// ─────────────────────────────────────────────────────────────────────────────
router.post('/users', adminOnly, async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'email, password, role required' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  try {
    // Найдём role_id по имени
    const roleRow = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
    if (!roleRow.rows.length) {
      return res.status(400).json({ error: `Unknown role: ${role}` });
    }
    const roleId = roleRow.rows[0].id;

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, role_id)
       VALUES ($1, $2, $3)
       RETURNING id, email, role_id, is_active, created_at`,
      [email.toLowerCase().trim(), hash, roleId]
    );
    res.status(201).json({ ...rows[0], role });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    console.error('[admin/users POST]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH /api/admin/users/:id  — изменить роль и/или активность
//  Body: { role?, is_active? }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/users/:id', adminOnly, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'Invalid id' });

  // Запрет снимать права с самого себя (см. §1.5.3 — самосанкция запрещена).
  if (userId === req.user.id) {
    return res.status(403).json({ error: 'Cannot modify your own account' });
  }

  const { role, is_active, password } = req.body;
  const updates = [];
  const values  = [];

  try {
    if (role !== undefined) {
      const roleRow = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
      if (!roleRow.rows.length) return res.status(400).json({ error: `Unknown role: ${role}` });
      values.push(roleRow.rows[0].id);
      updates.push(`role_id = $${values.length}`);
    }

    if (is_active !== undefined) {
      values.push(Boolean(is_active));
      updates.push(`is_active = $${values.length}`);
    }

    if (password !== undefined && password.trim() !== '') {
      const hash = await bcrypt.hash(password, 10);
      values.push(hash);
      updates.push(`password_hash = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    values.push(userId);
    const idParam = `$${values.length}`;

    const { rows } = await pool.query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = ${idParam}
       RETURNING id, email, role_id, is_active, updated_at`,
      values
    );

    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    // Дополнить role-именем
    const roleRow = await pool.query('SELECT name FROM roles WHERE id = $1', [rows[0].role_id]);
    res.json({ ...rows[0], role: roleRow.rows[0]?.name });
  } catch (err) {
    console.error('[admin/users PATCH]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/admin/export/pilots.csv  — скачать всех пилотов в CSV
// ─────────────────────────────────────────────────────────────────────────────
router.get('/export/pilots.csv', adminOrChief, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.last_name, p.first_name, p.middle_name,
              p.birth_date, p.team, p.city, p.video_channel, p.external_id,
              to_char(p.created_at, 'YYYY-MM-DD') AS registered
       FROM pilots p
       ORDER BY p.last_name, p.first_name`
    );

    const escape = v => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = 'id,Фамилия,Имя,Отчество,Дата рождения,Команда,Город,Видеоканал,ID_CRM,Зарегистрирован';
    const lines  = rows.map(r =>
      [r.id, r.last_name, r.first_name, r.middle_name,
       r.birth_date ? r.birth_date.toISOString().slice(0,10) : '',
       r.team, r.city, r.video_channel, r.external_id, r.registered]
      .map(escape).join(',')
    );

    const csv = '﻿' + [header, ...lines].join('\r\n'); // BOM для Excel
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pilots.csv"');
    res.send(csv);
  } catch (err) {
    console.error('[admin/export/pilots.csv]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/admin/sync-formdesigner
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sync-formdesigner', adminOnly, (req, res) => {
  const script = path.resolve(__dirname, '../../scripts/sync-formdesigner.js');

  execFile('node', [script], { env: { ...process.env }, timeout: 60000 },
    (error, stdout, stderr) => {
      const log = (stdout + (stderr || '')).trim();
      const ok  = !error || error.code === 0;
      res.status(ok ? 200 : 500).json({ ok, log });
    }
  );
});

module.exports = router;
