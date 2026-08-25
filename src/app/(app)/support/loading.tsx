import { SkelBar, SkelTable } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div>
      <SkelBar w="30%" h={22} className="mb-5" />
      <SkelTable rows={5} cols={4} />
    </div>
  );
}
