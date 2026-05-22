export function resolveSocketUrl(envUrl) {
  const value = typeof envUrl === 'string' ? envUrl.trim() : '';
  return value || undefined;
}
