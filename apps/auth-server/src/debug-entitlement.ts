export const DEBUG_USERNAME = 'admin';

/** Account-level entitlement only; the game server also requires its deployment gate. */
export function isDebugEntitledUsername(username: string): boolean {
  return username.trim().toLocaleLowerCase('en-US') === DEBUG_USERNAME.toLocaleLowerCase('en-US');
}
