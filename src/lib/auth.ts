import type { Role } from "@/types";

// Shared by the login page, the server routes and Staff & Access.

// Supabase Auth needs an email under the hood, but most of the marquee staff
// don't have one. So staff sign in with a plain username, and we build a
// synthetic internal email from it that they never see or need to know about.
export const USERNAME_DOMAIN = "staff.serenemarqueeapp.com";

export function usernameSlug(username: string): string {
  return username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");
}

export function usernameToEmail(username: string): string {
  return `${usernameSlug(username)}@${USERNAME_DOMAIN}`;
}

export const MIN_PASSWORD = 8;

/** Why a password isn't acceptable, or null if it is. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (!/\d/.test(pw)) return "Include at least one number.";
  if (!/[a-zA-Z]/.test(pw)) return "Include at least one letter.";
  return null;
}

/** How long a temporary password from the Admin stays usable. */
export const TEMP_PASSWORD_HOURS = 24;

/**
 * Who may reset whose password. The Developer can reset anyone else. The
 * Admin can reset everyone except the Admin and Developer accounts, so no one
 * can take over an account at their own level or above.
 */
export function canResetPasswordOf(actor: Role, target: Role): boolean {
  if (actor === "developer") return true;
  if (actor === "admin") return !["admin", "developer"].includes(target);
  return false;
}
