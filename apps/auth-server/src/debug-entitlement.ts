export const DEBUG_USERNAME = 'DimaTest1';

/** Account-level entitlement only; the game server still requires its deployment gate and password. */
export function isDebugEntitledUsername(username: string): boolean {
  return username.trim().toLocaleLowerCase('en-US') === DEBUG_USERNAME.toLocaleLowerCase('en-US');
}
