-- Migration 008: applications (заявки) and supporting documents.
--
-- Source: разделы 5.1 (заявки), 2.2.3 (документы для допуска), 2.6
-- (согласие родителей), Приложения 1-3 (образцы заявок).

-- ─── APPLICATIONS ────────────────────────────────────────────────────────────
-- Personal application (личная) — pilot_id заполнен, team_id = NULL.
-- Team application (командная) — team_id заполнен, pilot_id = NULL.
CREATE TABLE IF NOT EXISTS applications (
    id              SERIAL       PRIMARY KEY,
    competition_id  INTEGER      NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    pilot_id        INTEGER      REFERENCES pilots(id)  ON DELETE CASCADE,
    team_id         INTEGER      REFERENCES teams(id)   ON DELETE CASCADE,
    -- 'preliminary' (Приложение 2) | 'final' (Приложение 3)
    stage           VARCHAR(16)  NOT NULL,
    -- 'draft' → 'submitted' → 'approved' | 'rejected'
    status          VARCHAR(16)  NOT NULL DEFAULT 'draft',
    -- Подписи на финальной заявке (Приложение 3): представитель команды,
    -- руководитель региональной федерации, руководитель ОИВ, врач.
    signed_by_representative_at  TIMESTAMPTZ,
    signed_by_region_fed_at      TIMESTAMPTZ,
    signed_by_authority_at       TIMESTAMPTZ,
    signed_by_doctor_at          TIMESTAMPTZ,
    -- Платежи (5.2): фиксируем оплату заявочного взноса.
    entry_fee_paid_at            TIMESTAMPTZ,
    entry_fee_amount_rub         INTEGER,
    -- Решение комиссии по допуску (Раздел 5.3).
    decision                     VARCHAR(16),  -- 'admitted' | 'rejected' | NULL
    decision_reason              TEXT,
    decided_by                   INTEGER REFERENCES users(id),
    decided_at                   TIMESTAMPTZ,
    -- Доп. поля
    contact_email                VARCHAR(255),
    contact_phone                VARCHAR(64),
    notes                        TEXT,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT applications_subject_chk
        CHECK ((pilot_id IS NOT NULL)::int + (team_id IS NOT NULL)::int = 1),
    CONSTRAINT applications_stage_chk
        CHECK (stage IN ('preliminary', 'final')),
    CONSTRAINT applications_status_chk
        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    CONSTRAINT applications_decision_chk
        CHECK (decision IS NULL OR decision IN ('admitted', 'rejected'))
);

-- Один пилот / одна команда подают не более одной заявки на одну стадию.
CREATE UNIQUE INDEX IF NOT EXISTS applications_unique_pilot
    ON applications (competition_id, pilot_id, stage) WHERE pilot_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS applications_unique_team
    ON applications (competition_id, team_id, stage)  WHERE team_id  IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_applications_competition ON applications(competition_id);
CREATE INDEX IF NOT EXISTS idx_applications_status      ON applications(status);

DROP TRIGGER IF EXISTS trg_applications_updated ON applications;
CREATE TRIGGER trg_applications_updated
    BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── DOCUMENTS ───────────────────────────────────────────────────────────────
-- Локальное хранение файлов (по решению: оффлайн-инсталляция).
-- file_path — относительный путь от data-root (определяется конфигом).
-- Типы документов:
--   'passport'            — паспорт / документ, удостоверяющий личность (2.2.3)
--   'birth_certificate'   — свидетельство о рождении (для <14 лет)
--   'medical_clearance'   — медицинский допуск (2.2.2)
--   'medical_insurance'   — полис ОМС (2.2.3)
--   'accident_insurance'  — страховка от несчастных случаев (2.5)
--   'parental_consent'    — согласие родителей (Приложение 1)
--   'classification_book' — зачётная классификационная книжка
--   'other'               — прочее
CREATE TABLE IF NOT EXISTS documents (
    id              SERIAL       PRIMARY KEY,
    -- Один из owner-ов должен быть задан (см. constraint).
    pilot_id        INTEGER      REFERENCES pilots(id)        ON DELETE CASCADE,
    team_id         INTEGER      REFERENCES teams(id)         ON DELETE CASCADE,
    application_id  INTEGER      REFERENCES applications(id)  ON DELETE CASCADE,

    doc_type        VARCHAR(32)  NOT NULL,
    file_name       VARCHAR(255) NOT NULL,        -- оригинальное имя
    file_path       VARCHAR(512) NOT NULL,        -- путь относительно data-root
    file_size_bytes BIGINT,
    file_hash_sha256 CHAR(64),                    -- для аудита
    mime_type       VARCHAR(128),
    -- Срок действия (для мед.допуска / страховки).
    valid_until     DATE,
    uploaded_by     INTEGER      REFERENCES users(id),
    uploaded_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT documents_owner_chk
        CHECK (
            (pilot_id IS NOT NULL)::int +
            (team_id IS NOT NULL)::int +
            (application_id IS NOT NULL)::int >= 1
        ),
    CONSTRAINT documents_type_chk
        CHECK (doc_type IN (
            'passport', 'birth_certificate',
            'medical_clearance', 'medical_insurance', 'accident_insurance',
            'parental_consent', 'classification_book', 'other'
        ))
);

CREATE INDEX IF NOT EXISTS idx_documents_pilot       ON documents(pilot_id);
CREATE INDEX IF NOT EXISTS idx_documents_team        ON documents(team_id);
CREATE INDEX IF NOT EXISTS idx_documents_application ON documents(application_id);
CREATE INDEX IF NOT EXISTS idx_documents_type        ON documents(doc_type);
