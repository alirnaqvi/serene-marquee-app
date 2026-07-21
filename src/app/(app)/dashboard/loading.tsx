import { SkelStatRow, SkelTable } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div>
      <SkelStatRow count={4} />
      <SkelTable rows={5} cols={4} />
    </div>
  );
}
