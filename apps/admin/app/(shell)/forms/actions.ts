"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type {
  CreateFormState,
  DraftPreviewState,
  FormStatusState,
  MintLinksState,
  PreviewConditionState,
  PublishState,
  RevokeLinkState,
  SaveDraftState,
  SettingsState,
  ValidateDraftState,
} from "@/lib/forms/builder-state";
import { formIdFromSlug } from "@/lib/forms/draft";
import { t } from "@/lib/i18n/en";
import { messageForFormCode } from "@/lib/forms/errors";
import type { DraftForm } from "@/lib/forms/types";
import {
  createForm,
  previewCondition,
  previewDraft,
  publishForm,
  saveDraft,
  setFormStatus,
  updateSettings,
  validateDraft,
} from "@/lib/server/forms";
import { MAX_LINK_BATCH, mintLinks, revokeLink } from "@/lib/server/links";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The form builder's mutations (task 033).
 *
 * ## Why server actions, and why only one of them is a form post
 *
 * 032's reasoning applies unchanged: the builder holds a live document, and its failure
 * mode is a validation error that has to land on a rule **without throwing the author's
 * unsaved work away**. A redirect-back-with-a-code round trip re-renders the page from the
 * stored draft, which is precisely the state the edit that caused the error is missing
 * from. An action returns state to the same mounted component, so the document survives
 * its own rejection.
 *
 * `createFormAction` is a real `<form action={...}>` post driven by `useActionState`,
 * because creating a form is a discrete submission with a redirect at the end. The other
 * four are called **imperatively** from the builder (autosave on a debounce, validate on a
 * debounce, settings on a Save press, the bench on a Run press), so they take typed
 * arguments rather than a `FormData`. That is the same server-action mechanism either way
 * (a POST to this origin, origin-checked by Next, covered by `form-action 'self'` and the
 * SameSite session cookie); what differs is only who assembles the payload.
 *
 * Each of the four takes `formId` first so the builder page can bind it
 * (`saveDraftAction.bind(null, formId)`) and hand the builder exactly the one-argument
 * callback the component contract names. The form id therefore comes from the *route*, not
 * from the client, which is worth stating: a caller cannot aim an autosave at a different
 * form by editing the payload.
 *
 * ## Every action authenticates itself
 *
 * A server action is a POST endpoint and the `(shell)` layout does not run for one, so
 * every action here starts with `requireAdminSession()` rather than trusting that the
 * screen which rendered it was itself guarded. Same gap issue #177 recorded for
 * `settings/password/route.ts`, closed here by construction.
 *
 * ## Still a proxy (R2)
 *
 * None of these decides anything. A draft arrives already assembled by the builder and is
 * forwarded. Whether it is a legal form, whether a target is reachable, whether a pin
 * points at a published version: all the kernel's answers, returned as path-addressed
 * issues that the panel renders and anchors.
 */

/** Cap on the serialized draft, so an absurd post cannot make the BFF chew. */
const MAX_DEFINITION_BYTES = 64 * 1024;

/**
 * The state for a post this BFF could not even forward.
 *
 * It reuses the API's own code so the builder has one error path rather than two: as far
 * as the screen is concerned, a draft it could not serialize and a draft the engine
 * refused are the same event. The sentence comes from the catalog rather than from a
 * literal here (ADR-27).
 */
const MALFORMED_CODE = "INVALID_FORM_DEFINITION";

/**
 * Whether a document is small enough to forward.
 *
 * React has already deserialized the argument by the time an action body runs, so the cap
 * is applied to the bytes this app would *send* rather than to the bytes it received. It
 * still does the job it is here for: nothing unbounded leaves the BFF, and a document that
 * cannot be serialized at all (a cycle) is refused rather than thrown.
 *
 * The measurement is the **UTF-8 byte length**, not the string length: a JS string is
 * counted in UTF-16 code units, so a CJK character scores 1 against the 3 bytes it costs
 * on the wire and an astral emoji scores 2 against 4. Counting code units would therefore
 * let a localized draft through at up to three times the cap this constant names, and
 * localized content is the normal case for a questionnaire rather than an edge of it.
 */
function withinCap(document: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(document), "utf8") <= MAX_DEFINITION_BYTES;
  } catch {
    return false;
  }
}

/** Read a required string form field. */
function readText(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === "string" ? raw : "";
}

/**
 * Create a form identity and its empty first draft, then open the builder on it.
 *
 * The title travels to the builder in the query string rather than in the create call,
 * and that is the API's shape rather than an oversight: `POST /forms` takes an identity
 * (`formId`, `slug`, `defaultLocale`), while the title belongs to the *definition*. The
 * builder page seeds the working draft's title from that parameter, and the first autosave
 * is what stores it.
 */
export async function createFormAction(
  _previous: CreateFormState,
  formData: FormData,
): Promise<CreateFormState> {
  const session = await requireAdminSession();
  const slug = readText(formData, "slug").trim();
  const title = readText(formData, "title").trim();
  const defaultLocale = readText(formData, "defaultLocale").trim();
  const formId = formIdFromSlug(slug);
  const submitted = { slug, title, defaultLocale };

  // Two distinct failures, kept distinct: a slug that yields no id and a blank default
  // locale are different mistakes on different fields, and the catalog already has a
  // sentence for each. Collapsing them would tell an author with an empty locale box that
  // their (perfectly good) slug is invalid, and would leave `INVALID_DEFAULT_LOCALE`
  // mapped but unreachable from this screen.
  if (formId === "") {
    return {
      status: "error",
      code: "INVALID_FORM_ID",
      message: messageForFormCode("INVALID_FORM_ID"),
      submitted,
    };
  }
  if (defaultLocale === "") {
    return {
      status: "error",
      code: "INVALID_DEFAULT_LOCALE",
      message: messageForFormCode("INVALID_DEFAULT_LOCALE"),
      submitted,
    };
  }

  const result = await createForm(session, { formId, slug, defaultLocale });
  if (!result.ok) {
    return { status: "error", code: result.code, message: result.message, submitted };
  }
  revalidatePath("/forms");
  // Outside the guard above on purpose: `redirect` signals by throwing, so it must not
  // sit anywhere a `catch` could swallow it.
  redirect(`/forms/${encodeURIComponent(result.data.formId)}?title=${encodeURIComponent(title)}`);
}

/**
 * Autosave the working draft (022's advisory semantics).
 *
 * An inconsistent draft saves fine and comes back with the issues that would block a
 * publish, so a `saved` status carrying a non-empty `issues` list is the normal case
 * rather than a contradiction.
 */
export async function saveDraftAction(formId: string, draft: DraftForm): Promise<SaveDraftState> {
  const session = await requireAdminSession();
  if (!withinCap(draft)) {
    return {
      status: "error",
      issues: [],
      code: MALFORMED_CODE,
      message: messageForFormCode(MALFORMED_CODE),
    };
  }

  const result = await saveDraft(session, formId, draft);
  if (!result.ok) {
    return { status: "error", issues: result.issues, code: result.code, message: result.message };
  }
  revalidatePath("/forms");
  revalidatePath(`/forms/${formId}`);
  return { status: "saved", issues: result.data.issues };
}

/**
 * Dry-run the draft against the publish rules, without saving it.
 *
 * This is where the backward-target and cycle findings come from: the kernel's
 * `analyzeRuleGraph` runs inside the same compile the publish path uses, so
 * `RULE_BACKWARD_TARGET` and `RULE_CYCLE` arrive here with no extra endpoint and no
 * second implementation of the analysis in this app (there could not be one - the admin
 * takes no `@qcms/core` value import at all).
 */
export async function validateDraftAction(
  formId: string,
  draft: DraftForm,
): Promise<ValidateDraftState> {
  const session = await requireAdminSession();
  if (!withinCap(draft)) {
    return {
      status: "error",
      valid: false,
      issues: [],
      message: messageForFormCode(MALFORMED_CODE),
    };
  }

  const result = await validateDraft(session, formId, draft);
  if (!result.ok) {
    return { status: "error", valid: false, issues: result.issues, message: result.message };
  }
  return { status: "ok", valid: result.data.valid, issues: result.data.issues };
}

/** The keys the settings patch may carry (ADR-24 tier 2, task 026). */
interface SettingsPatch {
  readonly challengeRequired?: boolean;
  readonly minSubmitMs?: number | null;
}

/**
 * Patch the per-form abuse-control settings.
 *
 * The body is a **partial** patch and the route's schema refuses an empty one, so the
 * outgoing object is rebuilt from the two keys this app knows rather than forwarded as it
 * arrived: a key the panel did not touch is absent, `minSubmitMs: null` is kept because
 * `null` is a value ("use the deployment's floor") rather than an omission, and a patch
 * that ends up carrying neither key becomes a state here instead of a 400 from the API.
 */
export async function updateSettingsAction(
  formId: string,
  patch: SettingsPatch,
): Promise<SettingsState> {
  const session = await requireAdminSession();
  const outgoing: SettingsPatch = {
    ...(patch.challengeRequired === undefined
      ? {}
      : { challengeRequired: patch.challengeRequired }),
    ...(patch.minSubmitMs === undefined ? {} : { minSubmitMs: patch.minSubmitMs }),
  };
  if (Object.keys(outgoing).length === 0) {
    return { status: "error", message: messageForFormCode("INVALID_FORM_SETTINGS") };
  }

  const result = await updateSettings(session, formId, outgoing);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(`/forms/${formId}`);
  return {
    status: "saved",
    settings: result.data.settings,
    challengeEnforceable: result.data.challengeEnforceable,
  };
}

/** What the rule test bench sends: the unsaved draft, one rule, and hypothetical answers. */
interface PreviewRequest {
  readonly draft: DraftForm;
  readonly ruleId: string;
  readonly answers: Readonly<Record<string, unknown>>;
}

/**
 * Evaluate one rule's condition against hypothetical answers (read-only preview).
 *
 * SEC-13 / ADR-34: the `answers` payload is answer-shaped, so it is **never logged**,
 * never stored, and never echoed back in a message. It is forwarded to the API, a verdict
 * comes back, and the verdict is all that is returned. That is also why the failure path
 * returns a catalog sentence rather than anything derived from the request.
 */
export async function previewConditionAction(
  formId: string,
  input: PreviewRequest,
): Promise<PreviewConditionState> {
  const session = await requireAdminSession();
  if (!withinCap(input)) {
    return { status: "error", message: messageForFormCode(MALFORMED_CODE) };
  }

  const result = await previewCondition(session, formId, {
    definition: input.draft,
    ruleId: input.ruleId,
    answers: input.answers,
  });
  if (!result.ok) return { status: "error", message: result.message };
  const { outcome, reason, references } = result.data;
  return reason === undefined
    ? { status: "ok", outcome, references }
    : { status: "ok", outcome, reason, references };
}

// --- publish, preview, lifecycle and secure links (task 034) ----------------

/**
 * Publish the stored draft: freeze a version (022's aggregate).
 *
 * The draft is **not** sent. Publish reads the stored one on purpose - it is the only
 * operation here that writes something immutable, and freezing a document the server has
 * never seen persisted would make "what was published" a claim about a browser tab. The
 * builder autosaves before opening the confirm dialog, which is what makes those the same
 * document.
 *
 * A 422 is not an error state: it is the kernel's full issue list, which the screen turns
 * into a work list anchored to the offending rule, step or pin.
 */
export async function publishFormAction(formId: string): Promise<PublishState> {
  const session = await requireAdminSession();
  const result = await publishForm(session, formId);
  if (!result.ok) {
    if (result.issues.length > 0) {
      return { status: "rejected", issues: result.issues, message: result.message };
    }
    return { status: "error", message: result.message };
  }
  revalidatePath("/forms");
  revalidatePath(`/forms/${formId}`);
  return {
    status: "published",
    version: result.data.version,
    publishedAt: result.data.publishedAt,
  };
}

/** What the preview pane sends: the draft on screen, and the answers walked in with. */
interface DraftPreviewRequest {
  readonly draft: DraftForm;
  readonly answers: Readonly<Record<string, unknown>>;
}

/**
 * Compile the draft on the author's screen and project it for their answers.
 *
 * SEC-13 / ADR-34 again: `answers` is answer-shaped, so it is forwarded and nothing more.
 * It is never logged here, never stored, and the failure path returns a catalog sentence
 * rather than anything derived from the request.
 *
 * Rule evaluation happens in the API, where the kernel lives. That is not a shortcut: the
 * admin imports no `@qcms/core` value at all (R2), and the portal does not evaluate rules
 * either - it renders an authoritative visible set the API computed. Running the preview
 * the same way is what makes it a preview rather than a lookalike.
 */
export async function previewDraftAction(
  formId: string,
  input: DraftPreviewRequest,
): Promise<DraftPreviewState> {
  const session = await requireAdminSession();
  if (!withinCap(input)) {
    return { status: "error", message: messageForFormCode(MALFORMED_CODE) };
  }

  const result = await previewDraft(session, formId, {
    definition: input.draft,
    answers: input.answers,
  });
  if (!result.ok) {
    if (result.issues.length > 0) {
      return { status: "rejected", issues: result.issues, message: result.message };
    }
    return { status: "error", message: result.message };
  }
  return { status: "ok", preview: result.data };
}

/**
 * Close a form to new sessions, or reopen it.
 *
 * R1 is the whole of the semantics and the dialog copy carries it: this changes what
 * happens to sessions that have not started. Every session already under way keeps its
 * pinned version and finishes normally.
 */
export async function setFormStatusAction(
  formId: string,
  action: "close" | "reopen",
): Promise<FormStatusState> {
  const session = await requireAdminSession();
  const result = await setFormStatus(session, formId, action);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/forms");
  revalidatePath(`/forms/${formId}`);
  return { status: "changed", formStatus: result.data.status };
}

/** What the mint dialog sends. `count` is bounded here as well as at the route. */
interface MintRequest {
  readonly expiresAt: string;
  readonly oneTime: boolean;
  readonly count: number;
}

/**
 * Mint one or more secure links.
 *
 * The returned URLs carry signed tokens and are bearer credentials for the form. They are
 * handed straight back to the screen that asked for them and are not logged, stored or
 * revalidated into any cache here (SEC-13). The API cannot reissue them: it stores a
 * link's state row and never its token.
 */
export async function mintLinksAction(
  formId: string,
  request: MintRequest,
): Promise<MintLinksState> {
  const session = await requireAdminSession();
  const count = Math.trunc(request.count);
  if (!Number.isFinite(count) || count < 1 || count > MAX_LINK_BATCH) {
    return { status: "error", message: t("forms.error.invalidLinkBatch", { max: MAX_LINK_BATCH }) };
  }
  if (request.expiresAt.trim() === "") {
    return { status: "error", message: messageForFormCode("LINK_EXPIRY_INVALID") };
  }

  const result = await mintLinks(session, formId, {
    expiresAt: endOfDay(request.expiresAt),
    oneTime: request.oneTime,
    count,
  });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(`/forms/${formId}/links`);
  return { status: "minted", links: result.data };
}

/**
 * Widen a calendar day to the instant it ends, in UTC.
 *
 * The mint dialog asks for a day, because "which day does this stop working" is the
 * question an author has, and a date picker is the control for it. The API wants an
 * instant. Taking the **end** of the chosen day rather than its start is the direction that
 * matches what the author was told: a link dated the 31st works on the 31st.
 *
 * The zone is UTC and the dialog's hint says so, which is the second half of the same
 * decision. Widening in the author's local zone would make the stored instant depend on the
 * machine the link was minted from - two operators picking the same day would mint links
 * that die up to a day apart - and it would contradict the links table, which renders every
 * timestamp in UTC for the same reason (`lib/i18n/format.ts`). One clock, named in the copy,
 * beats a local one nobody can see afterwards.
 *
 * A value that already carries a time is passed through untouched, so a future control
 * with finer granularity needs no change here.
 */
function endOfDay(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value;
}

/** Revoke one link. 018 refuses it from that moment; an in-flight session is unaffected. */
export async function revokeLinkAction(formId: string, linkId: string): Promise<RevokeLinkState> {
  const session = await requireAdminSession();
  const result = await revokeLink(session, formId, linkId);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(`/forms/${formId}/links`);
  return { status: "revoked", linkId: result.data.linkId };
}
