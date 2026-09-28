import { randomInt } from "crypto";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/types";

/** The signed-in person and their role, read on the server. */
export async function currentStaff(): Promise<{ id: string; role: Role; fullName: string } | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("role, full_name").eq("id", user.id).single();
  if (!data) return null;
  return { id: user.id, role: data.role as Role, fullName: data.full_name };
}

/**
 * A temporary password that is easy to read out over the phone: no 0/O or
 * 1/l/I, grouped as xxxx-xxxx-xx. About 50 bits of randomness from the
 * operating system's secure generator — and it only lives 24 hours.
 */
export function temporaryPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = letters + digits;
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(letters), pick(digits), ...Array.from({ length: 8 }, () => pick(all))];
  // shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const s = chars.join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

export { canResetPasswordOf } from "@/lib/auth";
