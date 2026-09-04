import { PageContainer } from "@/components/layout/Footer";
import { LedgerSkeleton, SkeletonLine } from "@/components/system/States";

export default function OrdersLoading() {
  return (
    <PageContainer>
      <div className="py-14">
        <SkeletonLine width="8rem" />
        <div className="mt-6">
          <SkeletonLine width="22rem" className="h-8" />
        </div>
        <div className="mt-10">
          <LedgerSkeleton rows={7} />
        </div>
      </div>
    </PageContainer>
  );
}
