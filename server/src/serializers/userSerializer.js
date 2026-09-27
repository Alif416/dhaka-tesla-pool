/**
 * Shapes a user row for a response. `password_hash` never appears here or anywhere else.
 * @param {{ id: string, name: string, email: string, role: string }} user
 * @returns {{ id: string, name: string, email: string, role: string }}
 */
export function serializeUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
