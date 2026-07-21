import { SkelBar, SkelCard } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkelCard>
      <div className="flex justify-between mb-4">
        <SkelBar w={140} h={20} />
        <SkelBar w={90} h={28} />
      </div>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 35 }).map((_, i) => (
          <SkelBar key={i} h={64} />
        ))}
      </div>
    </SkelCard>
  );
}
