import { SkelBar, SkelCard } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="max-w-lg">
      <SkelBar w={120} h={22} className="mb-5" />
      <SkelCard>
        <SkelBar w="40%" h={13} className="mb-3" />
        <SkelBar w="100%" h={13} className="mb-2" />
        <SkelBar w="100%" h={13} />
      </SkelCard>
    </div>
  );
}
