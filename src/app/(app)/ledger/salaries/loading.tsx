import { SkelBar, SkelStatRow, SkelTable } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div>
      <SkelStatRow count={3} />
      <SkelTable rows={7} cols={5} />
    </div>
  );
}
