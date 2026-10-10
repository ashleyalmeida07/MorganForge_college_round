import { Suspense, use } from "react";
import RequestDetailClient from "./RequestDetailClient";

export const instant = false;

function RequestDetailLoader({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = use(params);
  return <RequestDetailClient pda={pda} />;
}

export default function RequestDetailPage({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen w-full items-center justify-center bg-slate-50">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
        </div>
      }
    >
      <RequestDetailLoader params={params} />
    </Suspense>
  );
}
