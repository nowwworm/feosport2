'use strict';

// Resolution rules for where uploaded documents live on disk.
//
// Priority (highest to lowest):
//   1. process.env.DOCUMENTS_ROOT          — explicit override
//   2. process.pkg + APPDATA → %APPDATA%/FeoSport2/uploads — Windows installer
//   3. process.pkg → <dirname(execPath)>/uploads  — bundled fallback
//   4. <projectRoot>/data/uploads          — dev / Linux / Mac
//
// All paths are absolute. The directory is created lazily by the upload route.

const fs   = require('fs');
const path = require('path');

const DEFAULT_DEV_ROOT = path.resolve(__dirname, '..', '..', '..', 'data', 'uploads');

function resolveDocumentsRoot(env = process.env) {
  if (env.DOCUMENTS_ROOT && env.DOCUMENTS_ROOT.trim()) {
    return path.resolve(env.DOCUMENTS_ROOT.trim());
  }
  if (process.pkg) {
    if (env.APPDATA && env.APPDATA.trim()) {
      return path.join(env.APPDATA.trim(), 'FeoSport2', 'uploads');
    }
    return path.join(path.dirname(process.execPath), 'uploads');
  }
  return DEFAULT_DEV_ROOT;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES || `${20 * 1024 * 1024}`, 10); // 20 MB default

// Whitelist of accepted MIME types for uploaded supporting documents.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

module.exports = {
  resolveDocumentsRoot,
  ensureDir,
  MAX_UPLOAD_BYTES,
  ALLOWED_MIME,
};
