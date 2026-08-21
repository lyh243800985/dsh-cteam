---
name: cteam-wiki-submit
description: Submit, upload, retry upload, or import the current right-side Markdown/PRD draft into CTeam Wiki with a category-selection form. Use when the user says 上传到wiki, 上传到 wiki, 再试一下上传到wiki, 重试上传到wiki, 导入markdown到wiki, 导入 markdown 到 wiki, 提交到wiki, 提交到 wiki, or asks to choose a Wiki category before upload.
---

# CTeam Wiki Submit

Use this skill for interactive Markdown upload/import into CTeam Wiki.

## Required Tool

- Always call `cteam_submit_wiki_markdown` for phrases such as:
  - 上传到wiki
  - 上传到 wiki
  - 再试一下上传到wiki
  - 重试上传到 wiki
  - 再试一下上传到 wiki
  - 导入markdown到wiki
  - 导入 markdown 到 wiki
  - 提交到wiki
  - 提交到 wiki
  - 先让我选分类
  - 选择 Wiki 分类后上传
- `cteam_upload_wiki_markdown` is an equivalent alias. Prefer
  `cteam_submit_wiki_markdown`, but using the alias is also correct for upload
  wording.

## Do Not Use Read-Only Tree First

- Do not call `cteam_list_wiki_tree` before `cteam_submit_wiki_markdown` for an
  upload/import request.
- Do not answer with a plain text category list.
- Do not ask the user to type a Wiki category name or ID.

`cteam_submit_wiki_markdown` already discovers the project Wiki library, opens
the category-selection form, reads the current right-side Markdown workspace,
uploads pasted images, and imports only after the user confirms.

## Separate Histories

Wiki import history is independent from PRD/demand submission history. Never use
the PRD "沿用上一次提交信息" cache for Wiki import.
