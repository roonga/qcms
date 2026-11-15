# The assistant's prompt text

Every word the model is sent lives here as Markdown. `prompts.generated.ts` is built
from these files and is the only thing the TypeScript imports, so the prompt is a text
review rather than a diff of string concatenation.

## What each file is

| Path                   | What it is                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `system/NN-<name>.md`  | One section of the system prompt. The number is its position; the assembled prompt is these files joined by one blank line.      |
| `tools/<tool-name>.md` | One tool's description, as the provider's tool schema carries it. The file stem is the tool name in `tools/registry.ts`.         |
| `actions/<kind>.md`    | One action kind's description, shown to the model in the propose tools' schema. The file stem is the kind a proposed step names. |
| `prompts.generated.ts` | Generated. Do not edit it: edit the Markdown and regenerate.                                                                     |

A description is one sentence or several, wrapped for reading; the generator joins the
lines back into the single line a schema carries. A system section keeps its line breaks
exactly, because the model reads them.

## Placeholders

A system section may name a value the kernel computes, written `{{NAME}}`:
`{{AVOID_WORDS}}`, `{{QUESTION_TYPES}}`, `{{ANSWER_ENCODINGS}}`,
`{{VALIDATION_MESSAGE_KEYS}}`, `{{SEMANTICS_VERSION}}` and `{{CONDITION_OPERATORS}}`.
`buildSystemPrompt` fills each one from `@roonga/qcms-core` at runtime, so the prompt can
never name an operator or a message key the kernel does not have. A name nothing fills
fails `pnpm check:prompts`, and a description may use no placeholder at all.

## Editing

1. Edit the Markdown.
2. Run `pnpm prompts:generate`.
3. Bump `SYSTEM_PROMPT_VERSION` in `../system-prompt.ts` and record the hash the generator
   prints in `PROMPT_SOURCE_HASH` beside it.
4. Run `pnpm verify`. For a change to the scaffolded copy of these files, also run
   `pnpm qcms:sync-templates`.

The version is logged with every turn, so it is how a logged turn is tied to the text
that produced it: bump it whenever any file under `system/`, `tools/` or `actions/`
changes, including a tool description, since all of it is sent to the model each turn.
This README is not prompt text and is outside the hash.

`pnpm check:prompts` fails when the generated module is stale, when the recorded hash
does not match these sources, and when the hash moved without the version. `pnpm test`
holds the sections the person is spoken to through (everything before the domain
contracts) to the avoid-words list in `../system-prompt.ts`, and every file here to the
no-em-dash rule.
