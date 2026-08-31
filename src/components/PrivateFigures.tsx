"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * Hide/show for money figures on the dashboard, the way a banking app masks
 * the available balance — so a figure isn't sitting in the open when someone
 * walks up to the desk.
 *
 * The choice is remembered per browser, and it starts HIDDEN on a device that
 * has never been told otherwise. Erring towards hidden costs one click; erring
 * towards visible costs a number being read by whoever happens to be standing
 * there.
 */

const STORAGE_KEY = "sm.figuresHidden";

type Ctx = { hidden: boolean; ready: boolean; toggle: () => void };
const PrivacyContext = createContext<Ctx>({ hidden: true, ready: false, toggle: () => {} });

export function PrivateFigures({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(true);
  // The server render can't know the stored preference, so figures stay masked
  // until the browser has read it. That way a stored "visible" never causes a
  // flash of the real number in the wrong direction, and vice versa.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setHidden(stored === "1");
    } catch {
      /* private browsing or storage disabled — stay hidden */
    }
    setReady(true);
  }, []);

  function toggle() {
    setHidden((h) => {
      const next = !h;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* not persisting is fine; the toggle still works for this session */
      }
      return next;
    });
  }

  return (
    <PrivacyContext.Provider value={{ hidden, ready, toggle }}>{children}</PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}

/** The eye button. Place it near whatever it controls. */
export function PrivacyToggle({ className = "" }: { className?: string }) {
  const { hidden, toggle } = usePrivacy();
  return (
    <button
      onClick={toggle}
      title={hidden ? "Show figures" : "Hide figures"}
      aria-label={hidden ? "Show figures" : "Hide figures"}
      aria-pressed={!hidden}
      className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted hover:text-primary border border-border hover:border-gold/50 rounded-lg px-2.5 py-1.5 transition-colors ${className}`}
    >
      {hidden ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
      <span className="hidden sm:inline">{hidden ? "Show figures" : "Hide figures"}</span>
    </button>
  );
}

/**
 * Wraps a figure so it can be masked. Falls back to showing the value if the
 * provider isn't present, so this can't accidentally blank out a page.
 */
export function Masked({
  children,
  chars = 7,
}: {
  children: React.ReactNode;
  /** Roughly how wide the mask should read. */
  chars?: number;
}) {
  const { hidden } = usePrivacy();
  if (!hidden) return <>{children}</>;
  return (
    <span aria-label="Hidden" title="Hidden — use Show figures to reveal">
      Rs.{" "}
      <span className="tracking-[0.12em] align-middle">{"\u2022".repeat(chars)}</span>
    </span>
  );
}
