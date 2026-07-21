"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { User, Lock, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Supabase Auth needs an email under the hood, but most of the marquee staff
// don't have one. So staff sign in with a plain username, and we build a
// synthetic internal email from it that they never see or need to know about.
const USERNAME_DOMAIN = "staff.serenemarqueeapp.com";

function usernameToEmail(username: string): string {
  const slug = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");
  return `${slug}@${USERNAME_DOMAIN}`;
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const slug = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (!slug) {
      setError("Please enter a username using letters and numbers only.");
      return;
    }

    setLoading(true);
    const syntheticEmail = usernameToEmail(username);

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email: syntheticEmail, password });
      if (error) setError("Incorrect username or password.");
      else {
        router.push("/dashboard");
        router.refresh();
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email: syntheticEmail,
        password,
        options: { data: { full_name: fullName, username: slug } },
      });
      if (error) {
        setError(
          error.message.toLowerCase().includes("already registered")
            ? "That username is already taken — pick another."
            : error.message
        );
      } else {
        router.push("/dashboard");
        router.refresh();
      }
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

          <div className="hidden lg:block mb-6">
            <div className="font-serif text-2xl font-bold text-primary">Welcome back</div>
            <div className="text-[13px] text-muted mt-1">Sign in to manage today's bookings and ledger.</div>
          </div>

          <div className="flex gap-1.5 mb-6 text-[13px] bg-bg rounded-xl p-1 border border-border">
            <button
              className={`flex-1 py-2 rounded-lg font-semibold transition ${
                mode === "signin" ? "bg-primary text-gold-light shadow" : "text-muted hover:text-primary"
              }`}
              onClick={() => setMode("signin")}
              type="button"
            >
              Sign In
            </button>
            <button
              className={`flex-1 py-2 rounded-lg font-semibold transition ${
                mode === "signup" ? "bg-primary text-gold-light shadow" : "text-muted hover:text-primary"
              }`}
              onClick={() => setMode("signup")}
              type="button"
            >
              New Staff
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            {mode === "signup" && (
              <div>
                <label className="text-[11px] font-bold text-muted uppercase tracking-wide">Full Name</label>
                <input
                  className="w-full mt-1"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
            )}
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
            <div>
              <label className="text-[11px] font-bold text-muted uppercase tracking-wide">Password</label>
              <div className="relative mt-1">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="password"
                  className="w-full pl-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
            </div>
            {error && <div className="text-rose text-xs font-semibold bg-rose-light rounded-lg px-3 py-2">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary rounded-lg py-2.5 mt-2 flex items-center justify-center gap-1.5"
            >
              {loading ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
              {!loading && <ChevronRight size={15} strokeWidth={2.5} />}
            </button>
          </form>

          {mode === "signup" && (
            <p className="text-[11px] text-muted mt-4 leading-relaxed">
              New accounts start with staff-level access and no ledger visibility. An owner can grant
              ledger access or change roles from the Staff & Access page.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
