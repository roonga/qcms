# Agent-assisted authoring

**Status:** shipped by task 041 · flag-gated, **off by default** · governed by **ADR-25**

QCMS can put a chat panel beside the form builder that drafts a form for you: describe what you want, get a proposal, look at the diff, accept it into your draft, then publish it yourself through the ordinary publish flow. Questions the proposal invented are created as unpublished drafts when you accept, so publishing them stays your decision too.

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
| `QCMS_AGENT_THINKING`                     | API               | no (default `off`)                                   | `off` or `summary`. Under `summary` the panel shows the provider's reasoning summary.           |
| `QCMS_RL_AGENT_ASSIST_WINDOW_MS` / `_MAX` | API               | no (default 10 per minute)                           | Rate limit per admin principal on the assist endpoint.                                          |

The admin app only needs the flag, and only to decide whether to render the panel. The **key never goes near the browser**: it lives in the API process's configuration, and the browser talks to the admin's own BFF route, which talks to the API, which talks to the provider.

**On the Compose stack** (`docker compose up`, `pnpm dev:up`), put the variables in the `.env` file beside `docker-compose.yml` and recreate the two containers with `docker compose up -d api admin`. The `api` service forwards all of them and the `admin` service forwards only the flag, so the key never enters the admin container. `.env.compose.example` carries a commented block to copy.

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

## 3. Local models: Ollama, and LM Studio on Windows

A locally hosted model is a first-class configuration, not a workaround. It is also the strongest privacy posture available: **with a local model, your form structure never leaves the deployment at all.**

Any OpenAI-protocol server works the same way (Ollama, vLLM, LM Studio, llama.cpp's server). Ollama first because it is the shortest path; [LM Studio](#lm-studio-on-windows-with-wsl2-or-docker) after it, because the Windows and WSL2 route it implies has two steps nothing else in this guide needs and both are easy to lose an evening to.

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

### LM Studio, on Windows with WSL2 or Docker

LM Studio is the same `openai-compatible` provider as everything above, and its server needs no key. What is different is not QCMS, it is the network: LM Studio runs as a Windows application, and the thing configuring QCMS is usually not Windows.

1. **Load a model that really does function calling.** The assist loop is entirely tool-driven: the model searches the question library, proposes questions, proposes the draft and asks for validation, all as tool calls. A model that emits prose instead of a tool call produces no proposal, so you see the "assistant did not propose a draft" state on every turn and it looks like the feature is broken. It is not. Use a recent instruct model in the 14B class or above whose card claims function calling, and check the claim rather than the size: a small model with tool support beats a large one without it here, because the loop has no prose path to fall back on.

2. **Start the server and turn on Serve on Local Network.** LM Studio's developer server binds `127.0.0.1` by default, which is reachable only from Windows itself. WSL2 in its default NAT mode is a different machine to that socket, and so is a container: from either one, `127.0.0.1:1234` is your own loopback and nothing answers. The toggle rebinds the listener to `0.0.0.0`. Windows will raise a firewall prompt the first time; allow it for private networks, or the rebind changes nothing you can observe.

3. **Pick the address for where the API actually runs.** Two different answers, and reading them off the wrong machine is the usual dead end:

   | The API process runs in      | `QCMS_AGENT_BASE_URL`                                                                                           |
   | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
   | Windows itself               | `http://localhost:1234/v1`                                                                                      |
   | WSL2, directly               | `http://<Windows host gateway IP>:1234/v1` - the `default via` address from `ip route show default` inside WSL2 |
   | A container (Docker Desktop) | `http://host.docker.internal:1234/v1`                                                                           |

   No `QCMS_AGENT_API_KEY` in any of the three. The gateway address WSL2 reports is an RFC-1918 private address and `host.docker.internal` is named outright, so all three satisfy the local-endpoint rule in §3 step 2 and the key requirement is relaxed.

4. **From Compose, set the variables in `.env` and name the host gateway.** The `api` service forwards every `QCMS_AGENT_*` variable and the `admin` service forwards the flag (§1), so the settings go in `.env` beside `docker-compose.yml`:

   ```dotenv
   QCMS_FLAG_AGENT_AUTHORING=openai-compatible
   QCMS_AGENT_BASE_URL=http://host.docker.internal:1234/v1
   QCMS_AGENT_MODEL=your-loaded-model-id
   ```

   Docker Desktop resolves `host.docker.internal` on its own. Docker Engine on Linux does not, so there the `api` service also needs the host gateway named, in a local override file:

   ```yaml
   services:
     api:
       extra_hosts:
         - "host.docker.internal:host-gateway"
   ```

   The container route is the one worth reaching for first on Windows, and not only because Compose is how this repository ships: Docker Desktop forwards `host.docker.internal` to the Windows host for you, so it works whether or not step 2's toggle is on, while the direct WSL2 route depends on it entirely. If a turn fails from WSL2 but succeeds from the container, the toggle is the thing to check.

5. **Use the model id LM Studio publishes, not the file name.** `GET http://<address>:1234/v1/models` lists them; `QCMS_AGENT_MODEL` takes an `id` from that list verbatim.

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

Counts are logged per turn (input tokens, output tokens, step count, provider, prompt version); the panel does not show them. Content is never logged.

---

## 5. The system prompt

The prompt lives at `apps/api/src/features/agent/system-prompt.ts`, is committed to the repository, and carries a version number that travels with every logged turn. **Prompt changes are reviewed like code**, because a prompt describing a DSL the kernel no longer speaks produces confidently wrong proposals.

It is assembled from the kernel's own exports where the kernel exposes a list (question types, the semantics version), and a test asserts that every rule operator the prompt names parses and that no operator the kernel accepts is missing.

---

## 6. How a turn actually runs

1. You type a description. The admin posts it to its own BFF route, which forwards it to `POST /admin/forms/{id}/draft/assist` with your admin session.
2. The API builds the bounded context described above and starts one bounded tool loop against the configured provider.
3. Progress streams back as server-sent events, and the turn is visibly alive from its first second.
   - **The reply arrives in chat bubbles as it is written**, rendered as a small, safe subset of Markdown: bold, italic, inline code and lists, never raw HTML and never an image. A link survives as a link only when it points at an admin page and carries no query string and no fragment; anything else, including an external URL, is shown as its text. A route handler is never a link target, so the assistant's prose cannot start the response export download.
   - **Each tool step gets a row in plain words**, such as "Searching the question library", and the row appears when the model **starts** streaming the call rather than when the call is complete. A step is marked Done only when the API reports that the call worked; one that errored or that the server refused is Failed, and one still open when the turn ends (an error, a lost connection) is "Did not finish". No error text from a tool or the provider is shown.
   - **Prose keeps the boundaries the model wrote it in**, so a sentence before a tool call and the explanation after it are two bubbles with the step row between them. The system prompt asks for one sentence before the first tool call, and a short note whenever the plan changes, so the middle of a long turn is narrated rather than silent.
   - **The assistant's mark carries the working state**: its visor glows while a turn runs, next to a status the panel also announces in words, so movement is never the only signal. Under reduced motion the glow is static.
   - **Stop** sits in the composer while a turn runs. It ends the turn and the upstream call; nothing is left billing.
   - **A keep-alive comment goes out through any silent stretch longer than 15 seconds**, so a proxy's idle timeout does not cut a long tool-calling turn. If your ingress has an idle timeout shorter than that, raise it.
   - **The thinking disclosure** appears when the provider's reasoning summary is forwarded (section 1, `QCMS_AGENT_THINKING`).
4. When the loop ends, **the server runs the publish validation itself** over the proposed draft and attaches both of its advisory lists: the issues that would block a publish, and the warnings that would not. The panel is never handed an unvalidated proposal.
5. You see a proposal card with a diff of steps, questions and rules against your current draft, the validation result, and the Accept and Discard buttons together at its foot. The assistant's explanation is shown once, in the conversation, and the card refers to it. It is the same verdict, from the same kernel call, that the builder's own validation panel would show for that draft, so accepting a proposal never changes what you are told about it. The card moves your keyboard focus to itself only if you were already in the panel: a turn finishing while you are editing the form never takes your caret away. Accept and Discard each leave a line in the conversation saying what happened, and focus lands on it.
6. **Accept into draft** saves the proposal through the builder's own autosave and live validation; nothing bypasses them. When the proposal introduced new questions, that save also creates them (below).
7. The draft is marked "includes agent-assisted changes". The mark is sticky and shows on the builder and on the publish confirmation, so whoever publishes knows what they are signing.
8. You publish, or not, exactly as you would for a hand-authored form.

### What happens to questions the agent invented

A proposal can pin questions that are not in your library yet, and accepting it **creates them as unpublished drafts** in the question library alongside the form draft.

That is the "a human publishes" half of the rule, and it is what makes the advice you are given performable. The accepted draft pins those questions, the validation panel says they are pinned but not published, and the fix is the one it names: open the question in the library, review the definition the agent wrote, and publish it. Do that for each one and the pins resolve. Nothing is published on your behalf.

Three things worth knowing:

- **Each proposed definition faces the same validation a hand-authored question faces**, including the authoring rules the schema itself does not carry. If one is refused, the whole accept is refused and **nothing** is saved - not the draft, not the other questions - and the error names which question and why. Fix the proposal (or ask the assistant to) and accept again.
- **Question ids are never reused (R6).** A proposal that reaches for an id your library has used before, even for a question you deprecated, is refused for that reason.
- **The library slug is derived from the question id** when the proposal does not name one: `q_first_name` becomes `first-name`. If that slug is already taken the accept is refused rather than silently renamed.
- **The created question drafts outlive a discarded form draft.** Discarding the draft removes the form draft and its agent-assisted mark; it does not remove the questions, because they are ordinary kernel-validated library drafts by then and a question id is never reused (R6), so deleting them could not give you the id back anyway. If you do not want them, deprecate or leave them in the library like any other draft you decided against.

Before this behaviour existed, accepting such a proposal stored a draft pinning question ids nothing had ever created, and the builder showed "Version not found" with no draft to review or publish.

---

## 7. Cost, limits and failure modes

- **You pay your provider directly.** QCMS makes one bounded tool loop per turn, capped by `QCMS_AGENT_MAX_STEPS`, and stops.
- **Thinking costs money, which is why it is off by default.** With `QCMS_AGENT_THINKING=summary` the API asks the provider for a summarized view of its reasoning, and reasoning tokens are **billed output** at your provider's output rate. The step ceiling bounds them within a turn and the per-principal rate limit bounds turns, so the exposure is bounded the same way everything else here is; what changes is the output count per turn, which the API log's per-turn record carries as `reasoningTokens`. Turn it on to see why a long tool-calling turn is doing what it is doing, and leave it off otherwise.
  - The setting controls **visibility, not effort**: how hard the model thinks stays at your provider's default, so turning it on does not make the model think more, only show what it thought.
  - **The text is never kept.** It is not logged, not stored, not written to an audit row, not exported in telemetry, and not sent back as part of the next turn. Only the token count is logged, and it appears as `[REDACTED]` because the logger redacts any key containing `token`. With `off` it is dropped even when a provider volunteers it, which the newer reasoning models do.
  - The admin never learns the setting. The panel shows a Thinking disclosure because reasoning events arrived, so flipping the variable needs an API restart and nothing else.
- **Rate limited per admin principal** on the assist endpoint. The panel shows the retry-after.
- **Closing the panel or the tab aborts the upstream call** rather than leaving it running.
- Failure states are shown explicitly rather than silently: provider unreachable or misconfigured, rate limited, the model refused, the model ran out of output room, the model proposed nothing, the draft changed underneath the conversation, and an attempted tool call refused.
- **A tool call the model got wrong is not a failed turn.**
  Models malform a call and correct themselves on the next step, and a smaller local model does it on most real turns.
  The loop hands the failure back as that call's result and carries on, so a turn that recovered still ends with its proposal.
  The API log's per-turn record carries a `toolErrors` count, which is where to look when a model seems slow: several failed calls means it is spending its step budget learning the schema.
  The one tool failure that does stop a turn is an attempt at a verb outside the allowlist, and that is deliberate.
- **A refused verb ends the turn at the step that asked for it**, rather than spending the rest of `QCMS_AGENT_MAX_STEPS`.
  The refusal itself is unchanged: the same message, once, and no proposal.
  What changed is the bill, because until this was fixed the loop kept asking after the answer was settled, and a model that reached for `publish` on every step was billed for a full budget of round trips to be refused eight times over.
- **A provider that will not serve your account is its own state, separate from one that is having a bad minute.** They need opposite responses - wait, or go and fix something - and one message cannot give both, so the panel says "try again shortly" only when the provider indicated the failure is transient. When it indicated otherwise (an exhausted balance, a revoked key, a model your account cannot call) the panel says so and points you at the provider account instead. It quotes nothing the provider wrote: no vendor message, no error code, no link. Your provider's own dashboard is where the specifics live, and the API log records the turn with the provider id, whether it was retryable and the HTTP status.

---

## 8. Conversation memory

The conversation is the memory, and it lasts as long as the panel does. Nothing is stored server-side between turns, and there is no cross-session memory (deliberately out of scope for 041).
