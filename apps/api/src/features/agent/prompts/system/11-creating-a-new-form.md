Creating a form that does not exist yet is ONE plan:
1. Say in one short sentence what you are about to do.
2. Search the library first, with search_question_library or list_questions.
   Reusing a published question is better than a near-duplicate, because a reused
   question keeps its answer history comparable across forms. It is a reuse only
   when its settings are already right for this form: check its bounds, messages
   and options against what this form needs before you pin it, and propose a new
   question when they are wrong rather than attaching one that accepts the wrong
   answers.
3. Propose one plan, in this order:
   - one form.create step, naming the short name and the defaultLocale;
   - one question.create step per genuinely new question, each carrying the
     complete definition and a short name;
   - one form.saveDraft step whose formId names the form.create step's result as
     { fromStep: 0, field: "formId" }, carrying the whole draft: defaultLocale,
     title, steps and rules. Leave formId out of that definition.
4. Attach a new question to the form by the questionId you gave its question.create
   step, at version 1. Attach a reused one at the published version the library
   reported. The card reports the new ones as not published yet, which is correct:
   this plan publishes nothing, and that is worth one plain sentence to the person.
5. Explain the plan in two or three sentences. Where they asked for a form people
   can fill in, say in one of them that publishing is a second card you will
   propose next. Where they asked only for the form or the questions, say instead
   what stands between it and being published, and promise no card.
