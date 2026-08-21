---
name: cteam-wiki
description: Read CTeam wiki trees and wiki page details. Use when the user asks to view wiki categories, list wiki directories, search wiki pages, or read wiki content.
---

# CTeam Wiki

Use this skill for read-only dsh-cteam wiki work. Keep it separate from PRD
demand creation and issue/bug workflows.

## Read Wiki Tree

When the user asks to view a wiki category tree, wiki directory, or the children
under a wiki node:

- Call `cteam_list_wiki_tree`.
- Prefer passing `wiki_url` when the user gives a CTeam wiki URL; it contains
  the project ID, wiki library ID, and often the current parent wiki ID.
- If the user does not give a Wiki URL or `library_id`, call
  `cteam_list_wiki_tree` without `library_id`; the tool first calls
  `/ms/doc/api/user/doc_library/libInfo/{projectId}` to discover the library ID,
  then calls `/ms/doc/api/user/wiki/{libraryId}/tree`.
- The category/page ID comes from `/ms/doc/api/user/wiki/{libraryId}/tree`.
- Use `parent_id` for children, `include_descendants: true` for a subtree, and
  `query` for search.

## Read Wiki Content

When the user asks to view or read a specific wiki page:

- Call `cteam_get_wiki_detail`.
- Prefer `wiki_url` when available.
- The returned content is CTeam HTML and can be shown in the right-side dsh-cteam
  workbench.
