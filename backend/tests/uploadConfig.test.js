'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveDocumentsRoot,
  ensureDir,
  MAX_UPLOAD_BYTES,
  ALLOWED_MIME,
} = require('../src/services/uploadConfig');

describe('uploadConfig', () => {
  const originalPkg = process.pkg;

  afterEach(() => {
    if (originalPkg === undefined) {
      delete process.pkg;
    } else {
      process.pkg = originalPkg;
    }
  });

  test('DOCUMENTS_ROOT has highest priority', () => {
    process.pkg = { entrypoint: 'server-bundled.js' };
    const root = resolveDocumentsRoot({
      DOCUMENTS_ROOT: 'custom-documents',
      APPDATA: 'C:\\Users\\judge\\AppData\\Roaming',
    });

    expect(root).toBe(path.resolve('custom-documents'));
  });

  test('bundled Windows app uses APPDATA/FeoSport2/uploads by default', () => {
    process.pkg = { entrypoint: 'server-bundled.js' };
    const root = resolveDocumentsRoot({
      APPDATA: 'C:\\Users\\judge\\AppData\\Roaming',
    });

    expect(root).toBe(path.join('C:\\Users\\judge\\AppData\\Roaming', 'FeoSport2', 'uploads'));
  });

  test('dev mode falls back to repository data/uploads', () => {
    delete process.pkg;
    const root = resolveDocumentsRoot({});

    expect(root.endsWith(path.join('data', 'uploads'))).toBe(true);
    expect(path.isAbsolute(root)).toBe(true);
  });

  test('ensureDir creates nested folders', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feosport-upload-config-'));
    const nested = path.join(root, 'a', 'b');

    expect(fs.existsSync(nested)).toBe(false);
    expect(ensureDir(nested)).toBe(nested);
    expect(fs.existsSync(nested)).toBe(true);

    fs.rmSync(root, { recursive: true, force: true });
  });

  test('upload limits and MIME allow-list include phase 3.5 document types', () => {
    expect(MAX_UPLOAD_BYTES).toBeGreaterThan(0);
    expect(ALLOWED_MIME.has('application/pdf')).toBe(true);
    expect(ALLOWED_MIME.has('image/png')).toBe(true);
    expect(ALLOWED_MIME.has('application/x-msdownload')).toBe(false);
  });
});
