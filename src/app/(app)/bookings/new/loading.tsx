import { SkelBar, SkelCard } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkelCard>
      <SkelBar w="40%" h={22} className="mb-5" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <SkelBar key={i} h={38} />
        ))}
      </div>
    </SkelCard>
  );
}
