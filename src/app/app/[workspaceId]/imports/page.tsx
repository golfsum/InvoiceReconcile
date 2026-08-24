import { ImportWorkflow } from "@/components/app/import-workflow";

export default async function ImportsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return <ImportWorkflow workspaceId={workspaceId} />;
}
