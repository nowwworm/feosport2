const path      = require('path');
const fs        = require('fs');
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

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
const consentRoutes     = require('./routes/consents');
const stageRoutes       = require('./routes/stages');
const sanctionRoutes    = require('./routes/sanctions');
const protocolRoutes    = require('./routes/protocols');
const auditRoutes       = require('./routes/audit');

const app = express();

// За Railway/Heroku/Render-прокси: реальный IP, secure cookies, rate-limit по X-Forwarded-For.
app.set('trust proxy', 1);

app.use(helmet());

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

// Brute-force guard on credentials endpoint. Disabled under NODE_ENV=test so the
// auth suite can hammer /login without hitting the cap.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 0 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many login attempts, please try again later' },
});

app.use('/api/auth/login',   loginLimiter);
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
app.use('/api/consents',     consentRoutes);
app.use('/api',              stageRoutes); // /competitions/:id/stages, /stages/:id, /groups/:id, /group-participants/:id
app.use('/api',              sanctionRoutes); // /competitions/:id/penalties, /competitions/:id/protests, /protests/:id
app.use('/api',              protocolRoutes); // /competitions/:id/protocols, /protocols/:id
app.use('/api',              auditRoutes);    // /competitions/:id/audit, /pilots/:id/sanction-status, /pilots/:id/ban

app.get(['/healthz', '/api/healthz'], (_req, res) => res.json({ status: 'ok' }));

// ── Frontend SPA (одно-сервисный деплой: Railway / standalone Docker) ────────
// Если рядом собранный фронт — отдаём статикой, для нематченых не-/api путей
// возвращаем index.html (SPA history-mode). API и socket.io пропускаем дальше.
const FRONTEND_DIST = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

module.exports = app;
