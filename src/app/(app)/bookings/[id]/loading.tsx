import { SkelBar, SkelCard } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="max-w-3xl">
      <SkelBar w={80} h={16} className="mb-4" />
      <SkelCard>
        <SkelBar w="50%" h={22} className="mb-4" />
        {Array.from({ length: 8 }).map((_, i) => (
          <SkelBar key={i} h={14} className="mb-3" />
        ))}
      </SkelCard>
    </div>
  );
}
