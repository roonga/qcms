---
"create-qcms-app": patch
---

The assistant's card shows the addresses a mint produced.

- `link.mint` hands the card every minted address, as the documented design always said it
  would; the next turn still gets only the allowlisted count, expiry and environment.
- The card lists each address with its own Copy control and a CSV download, in a bounded
  scroll region that holds a full batch of a hundred at narrow widths.
- A settled card keeps its reveal until the person hides it, even when the assistant
  proposes the next card. This covers revealed webhook secrets too.
- Hiding a reveal says plainly that it cannot be shown again.
