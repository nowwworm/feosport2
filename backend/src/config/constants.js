'use strict';

const ROLES = {
  ADMIN: 'admin',
  CHIEF_JUDGE: 'chief_judge',
  CHIEF_SECRETARY: 'chief_secretary',
  TECH_CONTROL_JUDGE: 'tech_control_judge',
  CHRONOMETER_JUDGE: 'chronometer_judge',
  JUDGE: 'judge',
  PILOT: 'pilot',
};

const HEAT_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  LOCKED: 'locked',
};

module.exports = {
  ROLES,
  HEAT_STATUS,
};
