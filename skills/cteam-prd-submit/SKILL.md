---
name: cteam-prd-submit
description: Submit or retry a dsh-cteam PRD demand creation; use when the user says the PRD is ready to upload, asks to create the CTeam demand, clicks submit, asks to retry, or corrects a failed create submission field. This skill focuses on PRD demand creation, not editing existing CTeam demands.
---

# CTeam PRD Submit

Use this skill for PRD upload/create and failed-create retries. Keep it separate
from ordinary PRD drafting: `cteam-prd-authoring` opens and edits the workspace;
this skill performs the confirmation and create flow.

Current scope: optimize PRD demand creation only. Do not route requests to
update an already-created CTeam demand online into this skill; existing-demand
online modification is out of scope for now because its form/state rules are more
complex. Local PRD draft editing before another create attempt remains supported
through `cteam-prd-authoring`.

## First Create

When the user says the PRD is ready, can be uploaded, or should be created in
CTeam:

- Call `cteam_submit_prd_demand`, not `cteam_confirm_prd_submission`.
- Pass `project_id` or `project_url` when known, the PRD title when known, and a
  concise summary of the draft.
- Do not try to auto-submit from category or field values the user says in chat.
  Always use the browser confirmation form for create details. If the user wants
  to reduce repeated input, rely on the form's "沿用上一次提交信息" button, which is
  stored in browser localStorage and works across conversations in the same
  browser profile.
- Use `dry_run: true` only when the user explicitly asks for a rehearsal,
  inspection, or no real creation. If the user says to submit, upload, create,
  or clicks a create/submit confirmation, use the default real create path.
- Do not stop after `cteam_confirm_prd_submission`. That tool only collects the
  form payload; it is not the final creation step.

`cteam_submit_prd_demand` should open the conversation form, collect or reuse
the create category and fields through that form, upload pasted images if
present, convert Markdown to CTeam HTML, and call the demand create endpoint
after the user confirms.

During the create confirmation and upload, the right-side editor should be
read-only. After a successful create, the local workspace can be edited again if
the user wants to create a corrected new demand later; do not describe that as
updating the existing CTeam demand.

If `cteam_submit_prd_demand` returns `succeeded: false`, treat the returned
`requestBody` and `error` as diagnostic context only. Explain the server error
briefly, but do not ask the user to provide a single field in chat and do not
silently retry with corrected values. On the next retry, always call
`cteam_submit_prd_demand` again so the confirmation form opens and the user can
review or edit all submission values before confirming.

If the server error is a generic request-body error such as
`requestBody.param.illegal`, do not claim the create contract is known. Inspect
the returned `requestBody` and `errorDetails`; when possible, collect or compare
the real CTeam page create request before changing the payload shape.

## Retry After A Failed Create

If a create attempt fails and the user says anything like "再来一次",
"重新提交", "重新创建", "把日期改成 2026-08-15", or "那个字段换成 X":

- Call `cteam_submit_prd_demand` again.
- Let the conversation confirmation form reopen with the current PRD draft.
- The user should correct or confirm values in that form, including values they
  already mentioned in chat.
- Do not call `cteam_create_demand_from_submission` directly from chat-driven
  corrections; that bypasses the user's full confirmation step.
- For CTeam date-only fields such as `预计开始时间` and `预计结束时间`, expect
  `YYYY-MM-DD`. Do not ask for or invent a time component unless the field is
  explicitly datetime.

## Safety Boundary

Never invent CTeam fields. Use the fields already returned by the confirmation
form or by CTeam discovery tools. The create form should include both required
fields and optional fields discovered from CTeam field preview metadata. If
CTeam returns a validation error whose field cannot be mapped to a collected
field, ask for the missing value or run the relevant discovery tool before
retrying.
