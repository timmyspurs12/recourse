import { PageContainer } from "@/components/layout/Footer";
import { SkeletonPanel } from "@/components/system/States";

export default function OrderDetailLoading() {
  return (
    <PageContainer>
      <div className="flex flex-col gap-4 py-10">
        <SkeletonPanel lines={5} label="LOADING TRANSACTION RECORD" />
        <SkeletonPanel lines={2} label="LOADING STATE PATH" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]">
          <div className="flex flex-col gap-4">
            <SkeletonPanel lines={6} label="LOADING AGREEMENT" />
            <SkeletonPanel lines={4} label="LOADING EVIDENCE" />
          </div>
          <SkeletonPanel lines={5} label="LOADING INDEX" />
        </div>
      </div>
    </PageContainer>
  );
}
