import { redirect } from "next/navigation";

export default async function MatchesPage({ params }: { params: Promise<{ workspaceId: string }> }) { const { workspaceId } = await params; redirect(`/app/${workspaceId}/exceptions`); }
