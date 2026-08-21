# dsh-cteam

`dsh-cteam` 是 DeepSeek Harness 的 CTeam 集成插件。插件复用本地网页登录态，提供 CTeam 需求、缺陷、Wiki 的读取、右侧工作台编辑、以及二次确认后的写入能力。

## 当前能力总览

当前共有 16 个工具入口：

```text
cteam_open_prd_authoring
cteam_list_demand_categories
cteam_list_demands
cteam_get_demand_detail
cteam_confirm_prd_submission
cteam_create_demand_from_submission
cteam_submit_prd_demand
cteam_list_bugs
cteam_list_issue_filters
cteam_get_issue_detail
cteam_get_issue_transitions
cteam_list_wiki_tree
cteam_get_wiki_detail
cteam_submit_wiki_markdown
cteam_upload_wiki_markdown
cteam_import_wiki_markdown
```

当前内置 4 个 skill：

```text
cteam-prd-authoring
cteam-prd-submit
cteam-wiki
cteam-wiki-submit
```

## 需求读取

`cteam_list_demand_categories` 用于获取需求分类树。

`cteam_list_demands` 用于获取需求列表，支持分页、按分类 `category_id` 筛选，以及追加 CTeam 字段筛选。

`cteam_get_demand_detail` 用于读取单个需求详情。结果包含基础字段、描述内容、评论、附件元数据，以及描述和评论中的图片。图片默认下载到 `.temp/dsh-cteam/<issue-id>/`。

## PRD 编辑与需求创建

PRD 写作是独立的右侧工作台模式。普通需求详情、缺陷详情、Wiki 详情仍然是只读展示。

`cteam_open_prd_authoring` 用于打开右侧 PRD 工作台。默认模板如下：

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

右侧工作台依赖浏览器缓存保存草稿状态，不再静默创建本地 `.md` 文件。上传成功后，结果卡片会询问是否下载一份 Markdown 副本。上传成功前，图片可能仍然只是浏览器本地占位，不适合自动写成本地副本。

`cteam_confirm_prd_submission` 用于打开对话中的需求提交确认表单。它会读取右侧当前 PRD 草稿，让用户选择需求分类，并填写 CTeam 创建需求所需字段。选择框、多选框、日期、人员等字段会尽量使用专门控件。这个工具只收集表单，不写入 CTeam。

`cteam_submit_prd_demand` 是当前主要的需求创建入口。它会打开确认表单，表单期间锁定右侧编辑态；用户确认后上传粘贴图片，替换 Markdown 图片链接为 CTeam 文件下载地址，转换 Markdown 为 CTeam HTML，并调用 CTeam 创建需求接口。

`cteam_create_demand_from_submission` 是较底层的创建工具，用于消费已经确认过的提交 payload。

当前只支持创建新的线上需求，不支持修改已经创建的线上需求。用户仍然可以在本地右侧工作台继续修改草稿，修改完成后再创建一条新需求。

## 缺陷与通用单据读取

`cteam_list_bugs` 用于获取缺陷/BUG 列表，支持分页和 CTeam 字段筛选。

`cteam_list_issue_filters` 用于获取快捷筛选器和筛选字段元数据。需求和缺陷的筛选器在 CTeam 中是分开的，因此调用时需要明确类型，例如 `DEMAND_SELECT` 或 `BUG_SELECT`。工具同时支持个人筛选器和团队筛选器。

`cteam_get_issue_detail` 用于读取通用单据详情，包括描述、评论、字段、附件和内嵌图片。

`cteam_get_issue_transitions` 用于只读发现单据流转逻辑。它会读取当前状态、可流转目标节点、操作标识、流转必填字段、候选人员/角色、字段选项，以及页面提交时的大致 body 结构。当前插件还没有真正执行缺陷流转。

## Wiki 读取与 Markdown 导入

Wiki 属于 CTeam 文档前端。插件先通过下面接口发现当前项目的 Wiki 库：

```text
GET /ms/doc/api/user/doc_library/libInfo/{projectId}
```

Wiki 树、详情和导入接口使用下面前缀：

```text
/ms/doc/api/user/wiki
```

`cteam_list_wiki_tree` 是只读工具，用于查看 Wiki 分类树。它读取 `/wiki/{libraryId}/tree`，支持查看根节点、展开子节点、查看子树和搜索。省略 `library_id` 时，会先通过 `libInfo` 自动发现。

`cteam_get_wiki_detail` 用于读取单个 Wiki 内容，接口为 `/wiki/{libraryId}/{wikiId}`，内容会展示在右侧工作台。

`cteam_submit_wiki_markdown` 是主要的交互式 Wiki 导入入口。用户说“上传到 wiki”“再试一下上传到 wiki”“导入 markdown 到 wiki”“提交到 wiki”时，应走这个工具。它会打开对话表单，读取右侧当前 Markdown 草稿，自动发现 Wiki 库，展示可搜索、逐层进入的 Wiki 父级分类选择器，用户确认后再上传图片、替换图片占位并导入。

`cteam_upload_wiki_markdown` 是 `cteam_submit_wiki_markdown` 的别名，主要用于提高“上传到 wiki”这类表达的工具路由稳定性。

`cteam_import_wiki_markdown` 是较底层的程序化导入工具。只有在调用方已经明确提供 Markdown 来源和目标 Wiki 节点时使用，例如已经有 `parent_id`、`wiki_url` 或 `use_last_target`。

Wiki 导入的“沿用上次分类”和需求创建的“沿用上次提交信息”是两套独立历史，不能混用。

## 右侧工作台

Web 客户端提供一个统一的 CTeam 详情/工作台面板，用于承载：

- 只读需求详情
- 只读缺陷/通用单据详情
- 只读 Wiki 详情
- PRD Markdown 编辑和预览
- 编辑时粘贴图片预览
- 需求创建结果展示
- Wiki 导入结果展示

目标是所有 CTeam 相关右侧展示都集中在同一个面板中，避免多套页面互相抢状态。

## 登录态

插件读取本地登录配置：

```text
<DSH session cwd>/.ops-local/cw-browser-login.json
```

文件需要包含 `loginUrl`、`username`、`password`。也可以在同一个文件里配置默认项目 `projectId`：

```json
{
  "loginUrl": "https://devops.cwoa.net/...",
  "username": "your-username",
  "password": "your-password",
  "projectId": "m68126"
}
```

凭据只在 host 进程中使用，不会出现在工具结果里。

## 项目选择

插件代码不硬编码项目 ID。工具调用如果没有传 `project_id` 或 `project_url`，会先使用插件配置里的 `projectId`；如果插件配置没有写，则读取 `.ops-local/cw-browser-login.json` 里的 `projectId`。

当前推荐把默认项目放在登录态 JSON 里，这样本地只需要维护一个配置文件。显式传入 `project_id`，或传入包含 `/vteam/{projectId}/` 的 `project_url`，会覆盖默认项目。如果两者同时传入，必须指向同一个项目。

## 本地验证

```powershell
npm test
node scripts/smoke-demands.mjs "https://devops.cwoa.net/devops/console/vteam/m68126/twDemand/demand?vmode=table" "<category-id>"
node scripts/smoke-detail.mjs "https://devops.cwoa.net/devops/console/vteam/m68126/twDemand/demand?vmode=table" "<demand-id>"
node scripts/smoke-bugs.mjs "https://devops.cwoa.net/devops/console/vteam/m68126/twBug?vmode=table"
node scripts/smoke-filters.mjs "https://devops.cwoa.net/devops/console/vteam/m68126/twBug?vmode=table" BUG
node scripts/smoke-issue-detail.mjs "https://devops.cwoa.net/devops/console/vteam/m68126/twBug?vmode=table" "<issue-id>" BUG
node scripts/smoke-transitions.mjs "https://devops.cwoa.net/devops/console/vteam/m68126/twBug?vmode=table" "<issue-id>" BUG
```

接口契约补充记录见 `docs/cteam-api-contract.md`。
