import { WorkspacesRailSlot } from "@/components/membership/workspaces-rail-slot";

export default async function WorkspaceSectionRailPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <WorkspacesRailSlot selected={{ workspaceId, section: "access-groups" }} />;
}
