import Link from "next/link";
import { t } from "@/lib/i18n/en";
import { roleName } from "@/lib/membership/access-group-form";
import { environmentLabel } from "@/lib/environment";
import {
  explainAccess,
  type AccessCapabilities,
  type ExplanationCell,
  type GroupGrant,
} from "@/lib/membership/access-patterns";

type ExplanationSubject =
  | { readonly person: string; readonly workspace: string; readonly caption?: undefined }
  | { readonly caption: string; readonly person?: undefined; readonly workspace?: undefined };

export function AccessExplanation({
  groups,
  environments,
  capabilities,
  groupHref,
  ...subject
}: ExplanationSubject & {
  /** The groups this person is in, in this workspace. */
  readonly groups: readonly GroupGrant[];
  /** The site's environments, in its own order. */
  readonly environments: readonly string[];
  readonly capabilities: AccessCapabilities;
  readonly groupHref?: (group: GroupGrant) => string;
}) {
  const rows = explainAccess(groups, environments);
  const linkTo = capabilities.has("access.read") ? groupHref : undefined;

  return (
    <div className="min-w-0 overflow-x-auto" data-testid="qcms-access-explanation">
      <table className="w-full border-collapse text-sm">
        <caption className="pb-2 text-left text-sm font-semibold text-(--color-text)">
          {subject.caption ??
            t("access.explain.title", { person: subject.person, workspace: subject.workspace })}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-left font-medium">
              {t("access.explain.columnAction")}
            </th>
            {environments.map((environment) => (
              <th key={environment} scope="col" className="px-2 py-1 text-left font-medium">
                {environmentLabel(environment)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.role} className="border-t border-(--color-border)">
              <th scope="row" className="px-2 py-1 text-left font-normal">
                {roleName(row.role)}
              </th>
              {row.cells.map((cell) => (
                <td
                  key={cell.environments.join(" ")}
                  colSpan={cell.environments.length > 1 ? cell.environments.length : undefined}
                  className="px-2 py-1"
                >
                  <Granting cell={cell} linkTo={linkTo} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Granting({
  cell,
  linkTo,
}: {
  readonly cell: ExplanationCell;
  readonly linkTo: ((group: GroupGrant) => string) | undefined;
}) {
  if (cell.groups.length === 0) {
    return <span className="text-(--color-text-muted)">{t("access.explain.noGroup")}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-x-2">
      {cell.groups.map((group) => (
        <li key={group.id}>
          {linkTo === undefined ? (
            group.name
          ) : (
            <Link href={linkTo(group)} className="qcms-text-link">
              {group.name}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
