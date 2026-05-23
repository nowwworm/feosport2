'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ALGORITHM,
  resolveKeyMaterial,
  encryptFileInPlace,
  decryptFile,
} = require('../src/services/documentEncryption');

describe('documentEncryption', () => {
  test('requires explicit key material', () => {
    expect(() => resolveKeyMaterial({})).toThrow('document_encryption_key_missing');
  });

  test('encrypts file bytes and decrypts them back', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feosport-doc-enc-'));
    const absPath = path.join(dir, 'doc.bin');
    const plaintext = Buffer.from('passport bytes');
    fs.writeFileSync(absPath, plaintext);

    const env = {
      DOCUMENT_ENCRYPTION_SECRET: 'test-secret',
      DOCUMENT_ENCRYPTION_KEY_ID: 'test-key',
    };
    const metadata = await encryptFileInPlace(absPath, env);

    expect(metadata.encryption_algorithm).toBe(ALGORITHM);
    expect(metadata.encryption_key_id).toBe('test-key');
    expect(fs.readFileSync(absPath).equals(plaintext)).toBe(false);

    const decrypted = await decryptFile(absPath, metadata, env);
    expect(decrypted.equals(plaintext)).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
