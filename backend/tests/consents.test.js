'use strict';

const {
  hashConsentText,
  normalizeConsentInput,
} = require('../src/services/consents');

describe('consents service', () => {
  test('hashConsentText returns stable SHA-256 without storing text', () => {
    const a = hashConsentText('Согласие на обработку персональных данных v1');
    const b = hashConsentText('Согласие на обработку персональных данных v1');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  test('normalizes accepted consent with text hash', () => {
    const c = normalizeConsentInput({
      pilot_id: 1,
      consent_type: 'personal_data_processing',
      consent_version: 'pd-v1',
      consent_text: 'legal text',
    });
    expect(c.action).toBe('accepted');
    expect(c.consent_text_hash_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('rejects invalid consent type', () => {
    expect(() => normalizeConsentInput({
      pilot_id: 1,
      consent_type: 'unknown',
      consent_version: 'v1',
      consent_text: 'legal text',
    })).toThrow('consent_type must be one of');
  });
});
