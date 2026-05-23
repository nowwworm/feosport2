-- Migration 020: document encryption metadata (§13.4).
--
-- New uploads are encrypted at rest with AES-256-GCM. Existing rows can remain
-- unencrypted until re-uploaded or migrated by an offline re-encryption task.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS encryption_algorithm VARCHAR(32);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS encryption_key_id     VARCHAR(128);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS encryption_iv         TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS encryption_auth_tag   TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_encryption_key
    ON documents(encryption_key_id)
    WHERE encryption_key_id IS NOT NULL;
