'use strict';

// RBAC catalogue for the full judging panel (§Раздел VI правил).
//
// Идея: вместо того чтобы в каждом маршруте писать список ролей вручную,
// перечислены действия (actions) и группы ролей. authorize-middleware
// можно использовать как `authorize(...rolesFor('record_lap'))`, либо новый
// `requirePermission('record_lap')`.
//
// Унаследованная модель: admin и chief_judge всегда входят в любую группу,
// `judge` (legacy generic) приравнен к группе любого судьи — старые тесты и
// устоявшиеся клиенты продолжают работать без изменений.

// ─── Role groups (composition by capability) ────────────────────────────────
const ALWAYS = ['admin', 'chief_judge'];

const ROLE_GROUPS = {
  // Главсудья + заместитель
  chief: dedup([...ALWAYS, 'deputy_chief_judge']),

  // Секретариат: подписи протоколов, ведение зачёта
  secretariat: dedup([...ALWAYS, 'chief_secretary', 'deputy_secretary']),

  // Зона пилотов (старт): фальстарт, контроль ВЭС, попадание в группу
  pilot_zone: dedup([...ALWAYS, 'pilot_zone_judge', 'judge']),

  // Технический контроль: проверка дронов, инспекции
  tech: dedup([...ALWAYS, 'tech_control_judge', 'tech_director', 'judge']),

  // Пит-зона / эстафеты — специализация, generic `judge` не покрывает
  pit: dedup([...ALWAYS, 'pit_judge', 'senior_pit_judge']),

  // Хронометраж: круги, старт/финиш вылета
  chronometer: dedup([...ALWAYS, 'chronometer_judge', 'judge']),

  // Информатор / диктор: read-only поверхность спектатора
  informer: dedup([...ALWAYS, 'informer_judge', 'judge', 'chief_secretary', 'deputy_secretary']),

  // Врач: read-only участники + протоколы инцидентов
  medical: dedup([...ALWAYS, 'competition_doctor']),

  // Любой судейский персонал (для общих read-only запросов)
  any_judge: dedup([
    ...ALWAYS,
    'judge',
    'deputy_chief_judge', 'chief_secretary', 'deputy_secretary',
    'pilot_zone_judge', 'tech_control_judge', 'senior_pit_judge', 'pit_judge',
    'chronometer_judge', 'informer_judge', 'tech_director', 'competition_doctor',
  ]),
};

// ─── Action catalogue — what each action needs ──────────────────────────────
const PERMISSIONS = {
  // Heat lifecycle
  'flight.start':            ROLE_GROUPS.chronometer,
  'flight.end':              ROLE_GROUPS.chronometer,
  'heat.lock':               ROLE_GROUPS.chief,

  // Chronometer
  'lap.record':              ROLE_GROUPS.chronometer,

  // Pilot zone (start)
  'falsestart.record':       ROLE_GROUPS.pilot_zone,
  'reflight.request':        ROLE_GROUPS.chief,

  // Scoring
  'score.submit':            dedup([...ROLE_GROUPS.chronometer, ...ROLE_GROUPS.chief]),
  'score.edit':              ROLE_GROUPS.chief,

  // Sanctions
  'penalty.issue':           ROLE_GROUPS.chief,
  'protest.resolve':         ROLE_GROUPS.chief,

  // Team relay
  'relay.handoff':           ROLE_GROUPS.pit,

  // Simulator
  'simulator.disconnect':    ROLE_GROUPS.chief,

  // Stages / groups (running the tournament)
  'stages.manage':           ROLE_GROUPS.chief,
  'group_participants.edit': ROLE_GROUPS.chief,

  // Protocols
  'protocol.sign':           dedup([...ROLE_GROUPS.chief, ...ROLE_GROUPS.secretariat]),

  // Read-only views
  'heat.read':               ROLE_GROUPS.any_judge,
  'leaderboard.read':        null, // any authenticated
};

function dedup(arr) {
  return Array.from(new Set(arr));
}

function can(role, action) {
  if (!role) return false;
  const allowed = PERMISSIONS[action];
  if (allowed === null) return true; // null = open to any authenticated
  if (allowed === undefined) return false;
  return allowed.includes(role);
}

function rolesFor(action) {
  const allowed = PERMISSIONS[action];
  if (allowed === null) return []; // empty = no restriction
  if (allowed === undefined) return ALWAYS; // unknown action → admin/chief only
  return allowed;
}

function rolesIn(...groups) {
  return dedup(groups.flatMap(g => ROLE_GROUPS[g] || []));
}

module.exports = {
  ROLE_GROUPS,
  PERMISSIONS,
  can,
  rolesFor,
  rolesIn,
};
