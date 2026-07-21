import { SkelTable, SkelCard, SkelBar } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div>
      <SkelBar w={220} h={22} className="mb-5" />
      <SkelTable rows={5} cols={5} />
      <div className="mt-5">
        <SkelCard>
          <SkelBar w="30%" h={13} className="mb-3" />
          <SkelBar w="100%" h={38} />
        </SkelCard>
      </div>
    </div>
  );
}
