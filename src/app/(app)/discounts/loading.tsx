import { SkelBar, SkelTable } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div>
      <div className="flex justify-between mb-4">
        <SkelBar w={160} h={22} />
        <SkelBar w={120} h={34} />
      </div>
      <SkelTable rows={8} cols={6} />
    </div>
  );
}
