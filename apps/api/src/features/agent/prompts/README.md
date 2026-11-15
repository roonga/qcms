# The assistant's prompt text

The prose the model is sent lives here as Markdown: the system prompt's sections, each
tool's description and each action kind's description. `prompts.generated.ts` is built
from those files and is the only thing the TypeScript imports, so that text is a reading
rather than a diff of string concatenation.

A turn also sends text this folder does not hold: the argument descriptions inside the
Zod schemas in `../tools/` and `../actions/`, which every `.describe()` call writes, and
the per-turn screen facts `../assistant.ts` assembles. `rendered/` is the whole as-sent
view, so what the model receives can be reviewed in one place whichever half it came
from.

## What each file is

| Path                   | What it is                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system/NN-<name>.md`  | One section of the system prompt. The number is its position; the assembled prompt is these files joined by one blank line.                             |
| `tools/<tool-name>.md` | One tool's description, as the provider's tool schema carries it. The file stem is the tool name in `tools/registry.ts`.                                |
| `actions/<kind>.md`    | One action kind's description, shown to the model in the propose tool's schema. The file stem is the kind a proposed step names.                        |
| `prompts.generated.ts` | Generated. Do not edit it: edit the Markdown and regenerate.                                                                                            |
| `rendered/`            | The as-sent view, written by the tests: the assembled system prompt, every tool with its description and advertised JSON schema, and every action kind. |

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
This README and `rendered/` are outside the hash: one is documentation, the other is
output.

`rendered/` moves on its own whenever the as-sent view changes, including a change to a
schema's `.describe()` text that no file here mentions. Regenerate it with
`pnpm exec vitest run --project qcms-api src/features/agent/prompts.test.ts -u` and read
the diff: it is the review of what the model will actually receive.

`pnpm check:prompts` fails when the generated module is stale, when the recorded hash
does not match these sources, and when the hash moved without the version. `pnpm test`
holds the sections the person is spoken to through (everything before the domain
contracts) to the avoid-words list in `../system-prompt.ts`, and every file here to the
no-em-dash rule.
