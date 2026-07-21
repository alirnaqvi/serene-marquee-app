"use client";

export default function AlertModal({
  title,
  message,
  tone = "warning",
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  tone?: "warning" | "danger";
  confirmLabel?: string; // if provided, shows a second confirm button (e.g. "Cancel Booking")
  onConfirm?: () => void;
  onClose: () => void;
}) {
  const accent = tone === "danger" ? "rose" : "gold";

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div
          className={`flex items-start justify-between gap-3 px-5 py-4 border-b ${
            tone === "danger" ? "bg-rose-light border-rose/20" : "bg-gold-light border-gold/30"
          }`}
        >
          <div className={`font-bold text-sm ${tone === "danger" ? "text-rose" : "text-gold-deep"}`}>{title}</div>
          <button onClick={onClose} className="text-muted hover:text-primary text-lg leading-none shrink-0">
            &times;
          </button>
        </div>
        <div className="px-5 py-4 text-[13.5px] text-ink leading-relaxed">{message}</div>
        <div className="px-5 py-3.5 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost rounded-lg px-4 py-2 text-sm">
            Close
          </button>
          {confirmLabel && onConfirm && (
            <button
              onClick={onConfirm}
              className={`rounded-lg px-4 py-2 text-sm font-bold ${
                tone === "danger" ? "bg-rose text-white" : "btn-primary"
              }`}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
