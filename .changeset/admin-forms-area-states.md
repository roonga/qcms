---
"@roonga/qcms-db": minor
"create-qcms-app": minor
---

Task 103: the admin forms-area states by role.

- Forms disables New form with the reason for a caller without Edit forms, tags read-only rows and says where Edit forms comes from, and names the workspace when the caller can see no form in it. A form opens read only, with the reason, for a caller without Edit forms.
- Availability disables Close and Reopen with "Needs Publish forms in <environment>." Responses says why they are not available in the environment and where the caller does hold View responses. Erase names Erase responses and its group. A masked endpoint URL says the query string is hidden.
- On a site whose only environment is `prod`, with second approval on, the Publish wizard's last step reads "Request publish to prod" and says nothing is frozen until it is approved. The Publish tab shows the held request pending to its requester, with no Approve, and to another holder of Publish forms in `prod` with the draft it would publish, "Approve and publish" and "Reject", and each refusal in words.
- The wizard's confirm control names its destinations: "Publish to test".
- `GET /admin/forms/{id}/publish-requests` gives `requestedByName` and `decidedByName`, display names only, to the requester and to a holder of Publish forms for prod in the form's workspace, and null to anyone else. The panel names both after an approval and names the requester and workspace in the re-check refusal.
- `GET /admin/me/access` lists each workspace's suspended places under `suspended`, apart from the grants. Responses says "Your View responses in <environment> is suspended until a Workspace administrator re-confirms it." with a link to My access.
- A View forms holder gets the Rules tab read only, as on Edit form. The approver's summary counts the changes since the last version. A workspace holding only suspended places is tagged Suspended in the workspace switcher and on My access, and its forms list says the access is suspended.
- `@roonga/qcms-db` adds `listSuspendedGrantsForUser` and `listDisplayNames`.
