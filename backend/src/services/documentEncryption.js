'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function resolveKeyMaterial(env = process.env) {
  const rawKey = env.DOCUMENT_ENCRYPTION_KEY;
  if (rawKey && rawKey.trim()) {
    const value = rawKey.trim();
    if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, 'hex');
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === 32) return decoded;
    throw new Error('DOCUMENT_ENCRYPTION_KEY must be 32 bytes as base64 or 64 hex chars');
  }

  const secret = env.DOCUMENT_ENCRYPTION_SECRET;
  if (secret && secret.trim()) {
    return crypto.createHash('sha256').update(secret.trim()).digest();
  }

  throw new Error('document_encryption_key_missing');
}

function encryptionKeyId(env = process.env) {
  return env.DOCUMENT_ENCRYPTION_KEY_ID || 'local-v1';
}

async function encryptFileInPlace(absPath, env = process.env) {
  const key = resolveKeyMaterial(env);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = await fs.readFile(absPath);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  await fs.writeFile(absPath, ciphertext);

  return {
    encryption_algorithm: ALGORITHM,
    encryption_key_id: encryptionKeyId(env),
    encryption_iv: iv.toString('base64'),
    encryption_auth_tag: authTag.toString('base64'),
  };
}

async function decryptFile(absPath, metadata, env = process.env) {
  if (!metadata?.encryption_algorithm) {
    return fs.readFile(absPath);
  }
  if (metadata.encryption_algorithm !== ALGORITHM) {
    throw new Error(`unsupported_encryption_algorithm:${metadata.encryption_algorithm}`);
  }

  const key = resolveKeyMaterial(env);
  const iv = Buffer.from(metadata.encryption_iv, 'base64');
  const authTag = Buffer.from(metadata.encryption_auth_tag, 'base64');
  const ciphertext = await fs.readFile(absPath);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = {
  ALGORITHM,
  resolveKeyMaterial,
  encryptFileInPlace,
  decryptFile,
};
