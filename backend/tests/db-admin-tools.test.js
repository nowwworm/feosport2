const { findPgAdmin } = require('../src/services/dbAdminTools');

describe('dbAdminTools', () => {
  test('prefers PGADMIN_PATH when it exists', () => {
    const env = { PGADMIN_PATH: 'D:\\Tools\\pgAdmin4.exe' };
    const existsSync = file => file === env.PGADMIN_PATH;

    expect(findPgAdmin(env, existsSync)).toBe(env.PGADMIN_PATH);
  });

  test('returns null when pgAdmin is not installed', () => {
    expect(findPgAdmin({}, () => false)).toBeNull();
  });
});
