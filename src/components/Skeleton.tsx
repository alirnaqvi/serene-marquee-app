export function SkelBar({ w = "100%", h = 14, className = "" }: { w?: string | number; h?: number; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ width: w, height: h }} />;
}

export function SkelCard({ children }: { children?: React.ReactNode }) {
  return <div className="card">{children}</div>;
}

export function SkelStatRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkelCard key={i}>
          <SkelBar w="60%" h={11} className="mb-3" />
          <SkelBar w="40%" h={26} />
        </SkelCard>
      ))}
    </div>
  );
}

export function SkelTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="card">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: rows * cols }).map((_, i) => (
          <SkelBar key={i} h={13} w={i % cols === 0 ? "80%" : "60%"} />
        ))}
      </div>
    </div>
  );
}
