---
name: cteam-prd-authoring
description: Enter or edit the dsh-cteam PRD authoring workspace, or handle requests to save a PRD copy from that workspace. Use for PRD writing mode, requirement PRD drafts, draft revisions, or "保存 PRD 副本". For uploading or retrying a CTeam create submission, use cteam-prd-submit.
---

# CTeam PRD Authoring

Use this skill for the dsh-cteam PRD writing workspace.

When the user asks to enter PRD writing mode, write a requirement PRD, or edit
a PRD draft:

- Treat this as a dsh-cteam authoring workflow, not a browser-page operation.
- Do not call Browser/CDP tools just to "enter PRD writing mode".
- Keep normal CTeam work-item viewing read-only. Writing mode is separate from
  the CTeam detail viewer.
- "修改需求" has two meanings in this workflow. Local PRD draft editing is
  supported and should stay in this skill. Updating an already-created CTeam
  demand online is not supported in the current PRD creation scope.
- If the user asks to enter PRD writing mode or open the authoring workspace,
  call `cteam_open_prd_authoring`. Pass `project_id` or `project_url` when known,
  and pass `title` / `initial_markdown` when the user has supplied a draft or
  requirement name.
- If the user says the draft is ready to upload, can be submitted, asks to
  create the CTeam demand, or wants to retry a failed PRD submission, switch to
  the `cteam-prd-submit` skill. Do not call `cteam_confirm_prd_submission` as
  the final upload action.
- The intended right-side workspace is split Markdown:
  editable Markdown source on one side and rendered preview with images on the
  other.
- If `cteam_open_prd_authoring` is unavailable, say that clearly and continue by
  drafting or revising the PRD Markdown in the conversation or an agreed local
  Markdown file. Do not use the browser helper as a substitute mode switch.

## Save A PRD Copy

When the user says to save a PRD copy, save a Markdown copy, or "保存一个副本":

- Do not use `Write`, shell redirection, or any filesystem tool to create a
  `.md` file automatically.
- Tell the user that because the PRD has not been uploaded to CTeam yet, pasted
  images cannot be preserved as durable CTeam image links in a local Markdown
  copy.
- The default action is browser download from the right-side workspace button
  after upload succeeds. Before upload, only browser-cache state is authoritative.
- If the user explicitly wants a local file before upload despite that image
  limitation, ask for confirmation first and make the image limitation clear.

## Default Template

When no initial Markdown is supplied, the workspace should use this exact default
PRD template:

```markdown
# 用户故事
用户故事标准句型模板：作为XX， 我想要XX， 以便于 XX（必填）

# 需求描述
清楚描述需求，能让研发经理理解，可包含一些关键词（必填）

# 原型
交互类的用户故事要有原型；绘制原型的工具不限，但应包含主要的业务场景（用户角色、业务流程、异常情况）；对UI/UE有要求的，需要明确相关具体要求和验收条件、必要的话提供UI/UE设计，否则，研发团队将基于设计规范主导UI/UE设计（必填。接口类无UI的，说明无UI即可）

# 测试建议
核心业务场景用例，在什么样的情景或条件下，做了什么操作，采取了什么行动，得到了什么结果。示例：当邮件的发送者在邮件书写页面写完了邮件主体（没有加粗），选中其中的几个文字，点击加粗按钮，选中的文字粗体显示。（必填）

# 其他备注（可选）
```

Submission is handled by `cteam-prd-submit`; this authoring skill should only
open or revise the local workspace. During submission the right-side editor is
read-only to avoid changing content mid-upload. After a successful creation, the
workspace may return to local editing for a new corrected copy, but it must not
be described as modifying the already-created CTeam demand online.
