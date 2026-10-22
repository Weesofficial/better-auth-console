import type { AuthContext } from "better-auth";
import { defaultRoles } from "better-auth/plugins/admin/access";

/** What a console endpoint needs, in the admin plugin's permission terms. */
export type Permission = { user?: string[]; session?: string[] };

export const READ: Permission = { user: ["list", "get"], session: ["list"] };

interface AdminOptions {
  adminUserIds?: string[];
  defaultRole?: string;
  roles?: Record<string, { authorize: (request: Permission) => { success: boolean } }>;
}

/**
 * The admin plugin's own check (`hasPermission`, not exported): a listed admin
 * user id, or a role whose access control grants every permission.
 */
export function can(ctx: AuthContext, user: { id: string; role?: unknown }, permission: Permission) {
  const options = (ctx.getPlugin("admin") as { options?: AdminOptions } | null)?.options ?? {};
  if (options.adminUserIds?.includes(user.id)) return true;
  const roles = options.roles ?? (defaultRoles as unknown as NonNullable<AdminOptions["roles"]>);
  const assigned = String(user.role || options.defaultRole || "user").split(",");
  return assigned.some((role) => roles[role.trim()]?.authorize(permission).success === true);
}
