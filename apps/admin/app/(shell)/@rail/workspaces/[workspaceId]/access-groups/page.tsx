import { WorkspacesRailSlot } from "@/components/membership/workspaces-rail-slot";
import { subViewOf } from "@/lib/membership/workspace-views";

export default async function WorkspaceSectionRailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ workspaceId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  return (
    <WorkspacesRailSlot
      selected={{ workspaceId, section: "access-groups" }}
      sub={subViewOf(await searchParams)}
    />
  );
}
