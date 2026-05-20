require('dotenv').config();
const http = require('http');
const app  = require('./app');
const { initSocket } = require('./services/socket');

const PORT      = process.env.PORT || 4000;
const SYNC_MS   = 5 * 60 * 1000; // 5 минут

const httpServer = http.createServer(app);
initSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
  scheduleFdSync();
});

function scheduleFdSync() {
  if (!process.env.FD_EMAIL || !process.env.FD_PASSWORD) {
    console.log('[fd-sync] FD_EMAIL/FD_PASSWORD не заданы — авто-синхронизация отключена');
    return;
  }

  const { execFile } = require('child_process');
  const path         = require('path');
  const script       = path.resolve(__dirname, '../scripts/sync-formdesigner.js');

  function runSync() {
    console.log('[fd-sync] запуск синхронизации с FormDesigner...');
    execFile('node', [script], { env: process.env, timeout: 60000 }, (err, stdout) => {
      const lines = stdout.trim().split('\n').filter(l => l.startsWith('  ') || l.includes('✓') || l.includes('✗'));
      lines.forEach(l => console.log('[fd-sync]', l.trim()));
      if (err && err.code !== 0) console.error('[fd-sync] ошибка:', err.message);
    });
  }

  // Первый запуск через 30 сек после старта (дать БД подняться)
  setTimeout(() => {
    runSync();
    setInterval(runSync, SYNC_MS);
  }, 30_000);

  console.log(`[fd-sync] авто-синхронизация каждые ${SYNC_MS / 60000} мин (первый запуск через 30 сек)`);
}
