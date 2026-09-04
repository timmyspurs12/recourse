import { PageContainer } from "@/components/layout/Footer";
import { SkeletonLine, SkeletonPanel } from "@/components/system/States";

export default function DemoLoading() {
  return (
    <PageContainer>
      <div className="py-14">
        <SkeletonLine width="12rem" />
        <div className="mt-6">
          <SkeletonLine width="28rem" className="h-8" />
        </div>
        <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <SkeletonPanel lines={6} label="LOADING TRANSACTION" />
          <SkeletonPanel lines={8} label="LOADING RUN" />
        </div>
      </div>
    </PageContainer>
  );
}
