import { PageContainer } from "@/components/layout/Footer";
import { SkeletonLine, SkeletonPanel } from "@/components/system/States";

export default function Loading() {
  return (
    <PageContainer>
      <div className="py-14">
        <SkeletonLine width="10rem" />
        <div className="mt-6">
          <SkeletonLine width="60%" className="h-8" />
        </div>
        <div className="mt-4">
          <SkeletonLine width="40%" />
        </div>
        <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SkeletonPanel lines={4} label="LOADING RECORD" />
          <SkeletonPanel lines={4} label="LOADING RECORD" />
        </div>
      </div>
    </PageContainer>
  );
}
