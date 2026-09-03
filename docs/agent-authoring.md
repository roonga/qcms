# Agent-assisted authoring

**Status:** shipped by task 041 · flag-gated, **off by default** · governed by **ADR-25**

QCMS can put a chat panel beside the form builder that drafts a form for you: describe what you want, get a proposal, look at the diff, accept it into your draft, then publish it yourself through the ordinary publish flow.

The whole feature rests on one sentence, and it is worth reading twice:

> **The agent proposes, the kernel validates, the human publishes.**

An authoring agent in QCMS is just another author. It emits the same domain JSON a person's clicks emit, through the same validation gauntlet, and it has no way to make anything live. Nothing about serving a form ever involves a model: the respondent path (`evaluateRules`, the stored compiled snapshot, the portal) is untouched and always will be (Project Goal §8, R7).

---

## 1. Turning it on

Nothing is required for a default deployment. `QCMS_FLAG_AGENT_AUTHORING` defaults to `none`, which means the assist routes are **not mounted at all** (a request 404s), no chat panel renders in the admin, and boot requires no provider key.

To enable it, set three environment variables on the **API** process, and the flag on the **admin** process:

| Variable                                  | Where             | Required                                             | Meaning                                                                                         |
| ----------------------------------------- | ----------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `QCMS_FLAG_AGENT_AUTHORING`               | API **and** admin | yes                                                  | Provider id. `none` (default), `anthropic`, `openai`, `google`, `openai-compatible`, or `fake`. |
| `QCMS_AGENT_MODEL`                        | API               | yes when enabled                                     | The provider's own model id. QCMS never interprets it.                                          |
| `QCMS_AGENT_API_KEY`                      | API               | yes when enabled, unless the base URL is local       | Your provider key. Bring your own; QCMS ships none and proxies nothing.                         |
| `QCMS_AGENT_BASE_URL`                     | API               | required for `openai-compatible`, optional otherwise | Endpoint override: a gateway, a proxy, or a local model runtime.                                |
| `QCMS_AGENT_MAX_STEPS`                    | API               | no (default 8)                                       | Hard ceiling on tool-loop steps per turn.                                                       |
| `QCMS_RL_AGENT_ASSIST_WINDOW_MS` / `_MAX` | API               | no (default 10 per minute)                           | Rate limit per admin principal on the assist endpoint.                                          |

The admin app only needs the flag, and only to decide whether to render the panel. The **key never goes near the browser**: it lives in the API process's configuration, and the browser talks to the admin's own BFF route, which talks to the API, which talks to the provider.

**Boot fails fast on a half-configuration.** Setting the flag without `QCMS_AGENT_API_KEY` (where one is required) or without `QCMS_AGENT_MODEL` stops the process with a message naming the missing variables. The message never contains a value, so a key you did set is never echoed into a log or a crash report (SEC-8).

### Rolling it back

Set `QCMS_FLAG_AGENT_AUTHORING=none` and restart. The routes disappear, the panel disappears, and nothing in any stored draft or published version depends on the feature having existed. Provenance marks on drafts remain and simply stop being added to.

---

## 2. Provider and model switching matrix

Switching provider or model is an environment change plus a restart. There is no code change, no rebuild, and no image to redeploy (ADR-24 semantics).

| `QCMS_FLAG_AGENT_AUTHORING` | Package used                | `QCMS_AGENT_MODEL` example            | `QCMS_AGENT_BASE_URL`    | Key                   |
| --------------------------- | --------------------------- | ------------------------------------- | ------------------------ | --------------------- |
| `none` _(default)_          | none                        | n/a                                   | n/a                      | none needed           |
| `anthropic` _(reference)_   | `@ai-sdk/anthropic`         | a Claude model id                     | optional (gateway/proxy) | required              |
| `openai`                    | `@ai-sdk/openai`            | an OpenAI model id                    | optional                 | required              |
| `google`                    | `@ai-sdk/google`            | a Gemini model id                     | optional                 | required              |
| `openai-compatible`         | `@ai-sdk/openai-compatible` | whatever the endpoint calls the model | **required**             | required unless local |
| `fake`                      | none (scripted)             | ignored                               | n/a                      | none needed           |

Model ids are deliberately **not** listed here. Provider catalogues change faster than this document can, and a stale default baked into the code would be worse than a variable you have to set. Take the id from your provider's current model list.

`fake` is the deterministic test provider. It makes no network call, needs no key, and is what the automated suites drive so CI can exercise the real tool loop without a provider account. It is not a production setting.

### Provider-specific capabilities

The Vercel AI SDK's per-provider options passthrough is wired through `aiSdkDraftAssistant`'s `providerOptions` argument. The system prompt is built as a deterministic, byte-identical string on every turn precisely so that providers offering prompt caching over a large frozen prefix can cache it.

---

## 3. Local models: a walkthrough with Ollama

A locally hosted model is a first-class configuration, not a workaround. It is also the strongest privacy posture available: **with a local model, your form structure never leaves the deployment at all.**

Any OpenAI-protocol server works the same way (Ollama, vLLM, LM Studio, llama.cpp's server). Ollama below because it is the shortest path.

1. Install Ollama and pull a model that supports tool calling:

   ```
   ollama pull llama3.1
   ```

   Tool calling is not optional here. The assistant works by calling tools (search the library, propose a draft, validate it); a model that cannot emit tool calls will produce no proposal at all, and you will see the "assistant did not propose a draft" state every time. Check your model's card before blaming the integration.

2. Point QCMS at it. Ollama serves an OpenAI-compatible API on port 11434:

   ```
   QCMS_FLAG_AGENT_AUTHORING=openai-compatible
   QCMS_AGENT_MODEL=llama3.1
   QCMS_AGENT_BASE_URL=http://localhost:11434/v1
   ```

   No `QCMS_AGENT_API_KEY`. Configuration validation relaxes the key requirement when the base URL names a local endpoint, so you are not asked to invent a credential for a server that has none.

   "Local" means: `localhost`, `127.0.0.1`, `::1`, `0.0.0.0`, `host.docker.internal`, a hostname ending `.local`, `.localhost` or `.internal`, or a private-range IPv4 address (`10.x`, `192.168.x`, `172.16-31.x`). Anything else still requires a key, because the relaxation is about **where the payload goes**, not about which provider id you chose.

3. If the API runs in a container and Ollama runs on the host, `localhost` inside the container is the container. Use `http://host.docker.internal:11434/v1` (Docker Desktop) or the host's private address on Linux.

4. Restart the API, restart the admin with the flag set, open a form in the builder. The Assistant panel appears docked beside it.

Expect a local model to be slower and less reliable at producing a valid `FormDefinition` than a frontier hosted model. That is a quality trade, not a correctness one: the kernel validates every proposal identically whatever produced it, so a weak model wastes your time but cannot corrupt anything.

---

## 4. What the agent can and cannot do

### Can

- **Search the published question library.** It sees question _definitions_ and reuses existing questions rather than inventing near-duplicates.
- **Propose new question definitions.** They come back to you for review. Nothing is created or published by the agent.
- **Propose a draft `FormDefinition`** for the form you have open: steps, question pins, and visibility rules.
- **Run the same publish validation** the builder runs, and iterate on what it reports.

### Cannot

Not "is instructed not to". **Cannot**, structurally: these verbs do not exist on the tool surface the agent is given, so no prompt, jailbreak or model swap reaches them.

- Publish a form or a question version.
- Erase a session, or reach any erasure or retention operation.
- Mint or revoke secure links.
- Create or configure webhooks.
- Read responses, answers, submissions, sessions or exports, in any form.
- Touch any form other than the one you have open.
- Change deployment configuration, or reach the database at all.

A tool call outside the allowlist is refused server-side before dispatch and logged, and the turn that attempted it produces **no proposal at all**: a model that reached for `publish` does not get the rest of its work accepted.

### The PII boundary

**Respondent data never enters the provider payload.** This is enforced by construction rather than by policy: the object an assist turn is handed carries the current draft, a search-only view of the published question library, an advisory validation function and the conversation. There is no database handle on it, no session reader and no answer reader, so there is no code path from the agent to an answer row. The automated suite asserts this with a real submitted answer sitting in the database while a turn runs, capturing the exact bytes the provider was handed and searching them for it.

What **does** go to the provider, when you use a hosted one: your form structure (step and question titles, option labels, rules), the definitions of published questions the agent searched for, and what you type into the chat. Treat that as you would treat any other document you paste into a hosted model. If that is unacceptable for your content, use a local model, where none of it leaves the deployment.

### Token usage

Counts are logged per turn (input tokens, output tokens, step count, provider, prompt version) and shown in the panel. Content is never logged.

---

## 5. The system prompt

The prompt lives at `apps/api/src/features/forms/assist/system-prompt.ts`, is committed to the repository, and carries a version number that travels with every logged turn. **Prompt changes are reviewed like code**, because a prompt describing a DSL the kernel no longer speaks produces confidently wrong proposals.

It is assembled from the kernel's own exports where the kernel exposes a list (question types, the semantics version), and a test asserts that every rule operator the prompt names parses and that no operator the kernel accepts is missing.

---

## 6. How a turn actually runs

1. You type a description. The admin posts it to its own BFF route, which forwards it to `POST /admin/forms/{id}/draft/assist` with your admin session.
2. The API builds the bounded context described above and starts one bounded tool loop against the configured provider.
3. Progress streams back as server-sent events: a working indicator, the assistant's prose as it arrives, and which tool it is using.
4. When the loop ends, **the server runs the publish validation itself** over the proposed draft and attaches the issues. The panel is never handed an unvalidated proposal.
5. You see a diff of steps, questions and rules against your current draft, with the validation result beside it.
6. **Accept into draft** saves the proposal through the ordinary draft save. The builder's own autosave and live validation take over; nothing bypasses them.
7. The draft is marked "includes agent-assisted changes". The mark is sticky and shows on the builder and on the publish confirmation, so whoever publishes knows what they are signing.
8. You publish, or not, exactly as you would for a hand-authored form.

A proposed question that is not published yet will validate as an unpublished pin. That is correct and is reported plainly: create and publish the question, then re-accept. The agent's view of validity and the builder's are the same view.

---

## 7. Cost, limits and failure modes

- **You pay your provider directly.** QCMS makes one bounded tool loop per turn, capped by `QCMS_AGENT_MAX_STEPS`, and stops.
- **Rate limited per admin principal** on the assist endpoint. The panel shows the retry-after.
- **Closing the panel or the tab aborts the upstream call** rather than leaving it running.
- Failure states are shown explicitly rather than silently: provider unreachable or misconfigured, rate limited, the model refused, the model ran out of output room, the model proposed nothing, the draft changed underneath the conversation, and an attempted tool call refused.

---

## 8. Conversation memory

The conversation is the memory, and it lasts as long as the panel does. Nothing is stored server-side between turns, and there is no cross-session memory (deliberately out of scope for 041).
