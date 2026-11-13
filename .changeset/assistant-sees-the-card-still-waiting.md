---
"create-qcms-app": patch
---

The assistant is now told when a card it put up is still waiting to be confirmed.

Nothing about a proposal is stored between turns, and the conversation sent upstream held the
dialogue and each confirmed card's report only. A card the person had not acted on was in
neither, so the model read a conversation in which it had proposed nothing and proposed the
same work again: a ten-step plan answered with a second, near-identical ten-step plan.

The browser is the only holder of that fact, so it now sends one `proposal` turn naming the
waiting card's step kinds, derived from the card on screen each time a turn goes out. It
carries no arguments and no content: what the card covers is already in the assistant's own
words above it. The prompt's rule about a waiting card now names that turn, and says that
being asked to get on with it is not a new request.
