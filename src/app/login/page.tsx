"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { User, Lock, ChevronRight, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { usernameSlug, usernameToEmail } from "@/lib/auth";

/**
 * Sign in, or ask for a password reset.
 *
 * There is no sign-up here any more: logins are created by the Developer from
 * Staff & Access, and the database refuses any account made another way.
 *
 * Staff sign in with a username rather than an email address, so a reset
 * can't be emailed. "Forgot password" sends a request to the Admin, who hands
 * over a temporary password in person; it works for 24 hours and must be
 * replaced at the first sign-in.
 */
export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("expired")) {
      setError("That temporary password has expired. Use Forgot password to ask the Admin for a new one.");
    }
  }, []);

  function switchMode(next: "signin" | "forgot") {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!usernameSlug(username)) {
      setError("Enter your username using letters and numbers.");
      return;
    }
    setLoading(true);

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
      if (error) {
        setError(
          error.message.toLowerCase().includes("banned")
            ? "This login has been switched off. Speak to the Admin."
            : "Incorrect username or password."
        );
        setLoading(false);
        return;
      }
      // The middleware sends anyone on a temporary password to choose a new one.
      router.push("/dashboard");
      router.refresh();
      return;
    }

    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, note }),
      });
      const out = await res.json();
      if (out.ok) {
        setInfo(out.message);
        setNote("");
      } else setError(out.message || "Couldn't send the request. Try again.");
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex bg-bg">
      {/* Brand panel — hidden on small screens, this is the "portfolio" side */}
      <div className="hidden lg:flex lg:w-[46%] relative bg-gradient-to-br from-[#1A1712] via-[#141210] to-[#0D0B08] text-[#EAE3CC] flex-col justify-between p-14 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, #D3AF52 0, transparent 3px), radial-gradient(circle at 60% 70%, #D3AF52 0, transparent 3px), radial-gradient(circle at 85% 30%, #D3AF52 0, transparent 3px)",
            backgroundSize: "120px 120px",
          }}
        />
        <div className="relative flex items-center gap-3 fade-up">
          <img src="/logo.png" alt="Serene Marquee" className="w-11 h-11 rounded-xl ring-1 ring-gold/30" />
          <div>
            <div className="font-serif text-lg font-bold text-gold-light leading-tight">Serene Marquee</div>
            <div className="text-[10px] text-[#A99A6E] tracking-[0.2em] uppercase">Operations Suite</div>
          </div>
        </div>

        <div className="relative fade-up" style={{ animationDelay: "80ms" }}>
          <div className="font-serif text-[34px] leading-[1.25] font-semibold text-[#F4E7BE] max-w-md">
            Every booking, every rupee,
            <br />
            one calm dashboard.
          </div>
          <p className="text-[13px] text-[#A99A6E] mt-4 max-w-sm leading-relaxed">
            Diamond Hall, Gold Hall, and the Open Area — bookings, menus, payments, and staff, all
            in one place instead of a diary, a ledger, and a stack of forms.
          </p>
        </div>

        <div className="relative text-[11px] text-[#7A6E4F] fade-up" style={{ animationDelay: "140ms" }}>
          Datta Hamlet Housing Society, Abbottabad-Mansehra Road, Mansehra
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm fade-up">
          <div className="flex flex-col items-center mb-7 lg:hidden">
            <img src="/logo.png" alt="Serene Marquee" className="w-14 h-14 rounded-xl shadow mb-3" />
            <div className="font-serif text-xl font-bold text-primary">Serene Marquee</div>
            <div className="text-[10px] text-muted uppercase tracking-widest mt-0.5">Staff Operations</div>
          </div>

          <div className={mode === "signin" ? "hidden lg:block mb-6" : "hidden"}>
            <div className="font-serif text-2xl font-bold text-primary">Welcome back</div>
            <div className="text-[13px] text-muted mt-1">Sign in to manage today's bookings and ledger.</div>
          </div>

          {mode === "forgot" && (
            <div className="mb-5">
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="text-xs font-bold text-gold-deep hover:underline flex items-center gap-1"
              >
                <ArrowLeft size={13} /> Back to sign in
              </button>
              <div className="font-serif text-xl font-bold text-primary mt-3">Forgot your password?</div>
              <div className="text-[12.5px] text-muted mt-1 leading-relaxed">
                Enter your username and the Admin will be asked to reset it. They'll give you a temporary
                password in person — nobody else can see or use it.
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <div>
              <label className="text-[11px] font-bold text-muted uppercase tracking-wide">Username</label>
              <div className="relative mt-1">
                <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  className="w-full pl-9"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. ali.hamza"
                  autoCapitalize="none"
                  autoCorrect="off"
                  required
                />
              </div>
            </div>
            {mode === "signin" ? (
              <div>
              <label className="text-[11px] font-bold text-muted uppercase tracking-wide">Password</label>
              <div className="relative mt-1">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="password"
                  className="w-full pl-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>
            ) : (
              <div>
                <label className="text-[11px] font-bold text-muted uppercase tracking-wide">
                  Message for the Admin <span className="normal-case font-normal">(optional)</span>
                </label>
                <input
                  className="w-full mt-1"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. I'm at the front desk"
                  maxLength={300}
                />
              </div>
            )}
            {error && <div className="text-rose text-xs font-semibold bg-rose-light rounded-lg px-3 py-2">{error}</div>}
            {info && (
              <div className="text-[12px] text-[#6B5320] bg-gold-light border border-gold/30 rounded-lg px-3 py-2 leading-relaxed">
                {info}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary rounded-lg py-2.5 mt-2 flex items-center justify-center gap-1.5"
            >
              {loading ? "Please wait…" : mode === "signin" ? "Sign In" : "Send reset request"}
              {!loading && <ChevronRight size={15} strokeWidth={2.5} />}
            </button>
          </form>

          {mode === "signin" && (
            <div className="flex items-center justify-between mt-4 text-[12px]">
              <button type="button" onClick={() => switchMode("forgot")} className="font-semibold text-gold-deep hover:underline">
                Forgot password?
              </button>
              <span className="text-muted">New staff? Ask the Admin for a login.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
