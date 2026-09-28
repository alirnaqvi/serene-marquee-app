"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Check, Minus, KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { MIN_PASSWORD } from "@/lib/auth";

/**
 * Shown straight after signing in with a temporary password from the Admin.
 * Nothing else in the app opens until a new password is chosen (the
 * middleware enforces that), so the temporary one is never used twice.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checks = useMemo(
    () => [
      { label: `At least ${MIN_PASSWORD} characters`, ok: next.length >= MIN_PASSWORD },
      { label: "Letters and at least one number", ok: /\d/.test(next) && /[a-zA-Z]/.test(next) },
      { label: "Different from the temporary password", ok: next.length > 0 && next !== current },
      { label: "Both entries match", ok: next.length > 0 && next === confirm },
    ],
    [next, confirm, current]
  );
  const ready = current.length > 0 && checks.every((c) => c.ok);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current, next }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(out.error || "Couldn't change the password.");
      setSaving(false);
      return;
    }
    // Pick up the cleared "must change" flag before going in.
    await supabase.auth.refreshSession();
    router.push("/dashboard");
    router.refresh();
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4 py-10">
      <form onSubmit={save} className="card w-full max-w-sm">
        <div className="w-10 h-10 rounded-lg bg-gold-light text-gold-deep flex items-center justify-center mb-3">
          <KeyRound size={18} />
        </div>
        <div className="font-serif text-xl font-bold text-primary">Choose your new password</div>
        <div className="text-[12.5px] text-muted mt-1 mb-4 leading-relaxed">
          You signed in with a temporary password. Pick one only you know before carrying on.
        </div>

        <label className="text-xs font-bold text-muted uppercase">Temporary password</label>
        <input
          type={show ? "text" : "password"}
          className="w-full mt-1 mb-3"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          autoFocus
        />

        <label className="text-xs font-bold text-muted uppercase">New password</label>
        <div className="relative mt-1 mb-3">
          <input
            type={show ? "text" : "password"}
            className="w-full pr-10"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide passwords" : "Show passwords"}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        <label className="text-xs font-bold text-muted uppercase">Confirm new password</label>
        <input
          type={show ? "text" : "password"}
          className="w-full mt-1"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />

        <div className="flex flex-col gap-1 mt-3">
          {checks.map((c) => (
            <div key={c.label} className={`flex items-center gap-2 text-[11.5px] ${c.ok ? "text-gold-deep font-semibold" : "text-muted"}`}>
              {c.ok ? <Check size={13} strokeWidth={3} /> : <Minus size={13} strokeWidth={2.5} />}
              {c.label}
            </div>
          ))}
        </div>

        {error && <div className="text-rose text-xs font-semibold bg-rose-light rounded-lg px-3 py-2 mt-3">{error}</div>}

        <button type="submit" disabled={!ready || saving} className="btn-primary rounded-lg py-2.5 w-full mt-4 disabled:opacity-40">
          {saving ? "Saving…" : "Save and continue"}
        </button>
        <button type="button" onClick={signOut} className="text-[12px] text-muted hover:text-primary w-full mt-3">
          Sign out instead
        </button>
      </form>
    </div>
  );
}
