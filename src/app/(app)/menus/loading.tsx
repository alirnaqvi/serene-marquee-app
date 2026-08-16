import { SkelCard, SkelBar } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <SkelCard key={i}>
          <SkelBar w="70%" h={16} className="mb-3" />
          <SkelBar w="100%" h={11} className="mb-2" />
          <SkelBar w="90%" h={11} />
        </SkelCard>
      ))}
    </div>
  );
}
