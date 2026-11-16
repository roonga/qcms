---
"create-qcms-app": patch
---

Give the scaffolded assistant question-type recipes (issue #1270).

- 29 recipes under `src/features/agent/prompts/recipes/`, one per common question type,
  with a `question_recipes` lookup tool and the system rule that sends the model to it.
- A recipe is fetched on demand, so only the type names ride in every turn.
