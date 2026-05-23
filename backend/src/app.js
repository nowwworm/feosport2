const express = require('express');
const cors    = require('cors');

const authRoutes        = require('./routes/auth');
const competitionRoutes = require('./routes/competitions');
const heatRoutes        = require('./routes/heats');
const pilotRoutes       = require('./routes/pilots');
const webhookRoutes     = require('./routes/webhook');
const adminRoutes       = require('./routes/admin');
const referenceRoutes   = require('./routes/reference');
const teamRoutes        = require('./routes/teams');
const applicationRoutes = require('./routes/applications');
const droneRoutes       = require('./routes/drones');
const documentRoutes    = require('./routes/documents');
const stageRoutes       = require('./routes/stages');
const sanctionRoutes    = require('./routes/sanctions');

const app = express();

// ── CORS ─────────────────────────────────────────────────────────────────────
// В production/qa задай ALLOWED_ORIGINS=https://your-domain.com,https://other.com
// В dev (NODE_ENV не задан или 'development') разрешаем всё.
const IS_DEV = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';

if (IS_DEV) {
  app.use(cors());
} else {
  const rawOrigins  = (process.env.ALLOWED_ORIGINS || '').trim();
  const allowList   = rawOrigins
    ? rawOrigins.split(',').map(o => o.trim()).filter(Boolean)
    : [];

  app.use(cors({
    origin(origin, callback) {
      // Разрешаем запросы без origin (curl, мобильные, SSR, Postman)
      if (!origin) return callback(null, true);
      if (allowList.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // formdesigner может слать urlencoded

app.use('/api/auth',         authRoutes);
app.use('/api/competitions', competitionRoutes);
app.use('/api/heats',        heatRoutes);
app.use('/api/pilots',       pilotRoutes);
app.use('/api/webhook',      webhookRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/reference',    referenceRoutes);
app.use('/api/teams',        teamRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/drones',       droneRoutes);
app.use('/api/documents',    documentRoutes);
app.use('/api',              stageRoutes); // /competitions/:id/stages, /stages/:id, /groups/:id, /group-participants/:id
app.use('/api',              sanctionRoutes); // /competitions/:id/penalties, /competitions/:id/protests, /protests/:id

app.get(['/healthz', '/api/healthz'], (_req, res) => res.json({ status: 'ok' }));

module.exports = app;
