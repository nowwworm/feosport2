-- Migration 002: seed reference data from Минспорт rules.
--
-- Idempotent via ON CONFLICT DO NOTHING — safe to re-run if a future migration
-- needs to extend the same table.

-- ─── DISCIPLINES (Раздел 1.2, таблица 2) ─────────────────────────────────────
INSERT INTO disciplines (code, name_ru, category, drone_class, is_team, sort_order) VALUES
    ('class_75mm',           'класс 75 мм',                                          'class',     '75mm',  false, 10),
    ('class_75mm_team',      'класс 75 мм - командные соревнования',                 'class',     '75mm',  true,  20),
    ('class_200mm',          'класс 200 мм',                                         'class',     '200mm', false, 30),
    ('class_200mm_team',     'класс 200 мм - командные соревнования',                'class',     '200mm', true,  40),
    ('class_330mm',          'класс 330 мм',                                         'class',     '330mm', false, 50),
    ('class_330mm_team',     'класс 330 мм - командные соревнования',                'class',     '330mm', true,  60),
    ('simulator',            'технический симулятор - гонки беспилотных воздушных судов',                     'simulator', NULL,    false, 70),
    ('simulator_team',       'технический симулятор - гонки беспилотных воздушных судов - командные соревнования', 'simulator', NULL, true,  80)
ON CONFLICT (code) DO NOTHING;

-- ─── RACE SYSTEMS (Разделы 1.4.1, 1.4.2) ─────────────────────────────────────
INSERT INTO race_systems (code, name_ru, group_size, advance_count) VALUES
    ('two_of_four',   'два из четырёх',  4, 2),
    ('four_of_eight', 'четыре из восьми', 8, 4)
ON CONFLICT (code) DO NOTHING;

-- ─── RACE FORMATS ────────────────────────────────────────────────────────────
INSERT INTO race_formats (code, name_ru) VALUES
    ('offline', 'оффлайн'),
    ('online',  'онлайн')
ON CONFLICT (code) DO NOTHING;

-- ─── AGE GROUPS (Раздел 2.1, таблица 7) ──────────────────────────────────────
--
-- 10-17: возраст проверяется на день начала (мин.) + календарный год (макс.)
-- 17-25: для студентов; календарный год
-- 14+:   календарный год
INSERT INTO age_groups (code, name_ru, min_age, max_age, age_check, notes) VALUES
    ('juniors_10_17',   'юниоры и юниорки (10-17 лет)', 10, 17,   'day_of_start',  'Минимальный возраст — на день начала соревнования; максимальный — в календарный год.'),
    ('juniors_17_25',   'юниоры и юниорки (17-25 лет)', 17, 25,   'calendar_year', 'Соревнования среди студентов.'),
    ('adults_14_plus',  'мужчины и женщины',            14, NULL, 'calendar_year', '14 лет и старше.')
ON CONFLICT (code) DO NOTHING;
