-- Migration 001: reference tables for drone racing domain.
--
-- Source: Приказ Минспорта РФ № 1063 от 28.10.2024 «Правила вида спорта
-- "гонки дронов (беспилотных воздушных судов)"».
--
-- Read-only catalogues populated from the regulation. Tables are seeded in 002.

-- ─── DISCIPLINES (8 official disciplines, ВРВС) ──────────────────────────────
-- Раздел 1.2, таблица 2.
CREATE TABLE IF NOT EXISTS disciplines (
    id         SERIAL       PRIMARY KEY,
    code       VARCHAR(64)  NOT NULL UNIQUE, -- machine-readable: class_75mm, class_75mm_team, ...
    name_ru    VARCHAR(255) NOT NULL,        -- official Russian name from ВРВС
    -- 'class' (физический дрон) | 'simulator' (цифровой)
    category   VARCHAR(32)  NOT NULL,
    -- size class: '75mm' | '200mm' | '330mm' | NULL for simulator
    drone_class VARCHAR(32),
    is_team    BOOLEAN      NOT NULL DEFAULT false,
    sort_order INTEGER      NOT NULL DEFAULT 0
);

-- ─── RACE SYSTEMS ────────────────────────────────────────────────────────────
-- Раздел 1.4.1-1.4.2: «два из четырёх», «четыре из восьми».
CREATE TABLE IF NOT EXISTS race_systems (
    id              SERIAL      PRIMARY KEY,
    code            VARCHAR(32) NOT NULL UNIQUE, -- 'two_of_four' | 'four_of_eight'
    name_ru         VARCHAR(64) NOT NULL,
    group_size      INTEGER     NOT NULL,        -- 4 | 8
    advance_count   INTEGER     NOT NULL         -- 2 | 4
);

-- ─── RACE FORMATS ────────────────────────────────────────────────────────────
-- Раздел 5.5.9.1 / общие положения: offline / online.
CREATE TABLE IF NOT EXISTS race_formats (
    id      SERIAL      PRIMARY KEY,
    code    VARCHAR(16) NOT NULL UNIQUE, -- 'offline' | 'online'
    name_ru VARCHAR(64) NOT NULL
);

-- ─── AGE GROUPS ──────────────────────────────────────────────────────────────
-- Раздел 2.1, таблица 7.
CREATE TABLE IF NOT EXISTS age_groups (
    id        SERIAL      PRIMARY KEY,
    code      VARCHAR(32) NOT NULL UNIQUE, -- 'juniors_10_17' | 'juniors_17_25' | 'adults_14_plus'
    name_ru   VARCHAR(64) NOT NULL,
    min_age   INTEGER     NOT NULL,
    max_age   INTEGER,                     -- NULL = без верхней границы (14+)
    -- 'day_of_start' (для 10-17) | 'calendar_year' (для остальных)
    age_check VARCHAR(32) NOT NULL,
    notes     TEXT
);
