---
"create-qcms-app": minor
---

Task 100: the admin Site configuration area and its Accounts screens.

- A Site configuration item in the top bar, for Site administrators only, opens Accounts: the directory with search, status and Site administrator filters, New account, and an account page with what the account holds in every workspace.
- The account page resends an unclaimed account's link, resets a password or second factor, disables and reactivates. Disabling or resetting a Site administrator asks for the step-up in the same dialog and is held for another Site administrator where one exists. No act deletes an account.
- `GET /admin/accounts/{id}` reads one account for that page, Site administrators only.
