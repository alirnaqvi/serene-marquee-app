import { SkelStatRow, SkelTable } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div>
      <SkelStatRow count={3} />
      <SkelTable rows={9} cols={6} />
    </div>
  );
}
