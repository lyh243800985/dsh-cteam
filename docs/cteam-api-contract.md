# DSH CTeam API 契约

本文档记录 `dsh-cteam` 插件已经确认的 CTeam 接口。接口契约是 Provider、DSH Tool、测试和工作台 UI 的共同依据。

## 基础约定

- CTeam 地址：`https://devops.cwoa.net`
- 当前验证项目：`m68126`（仅为接口验证样本，不是插件固定项目）
- 项目 ID 不写死在解析代码或 API client 中。本地长期配置 JSON 可通过 `projectId` 指定主项目；插件挂载配置仍可通过 `projectId` 兼容覆盖。
- 工具调用显式提供 `project_id` 或包含 `/vteam/{projectId}/` 的 `project_url` 时，使用显式项目；两者同时提供时必须一致。
- 工具调用省略两个项目参数时，优先使用插件配置的 `projectId`；插件未配置时依次读取项目级 `local/local.json`、旧项目级 `.ops-local/cw-browser-login.json`、包内用户级 `local/local.json` 中的 `projectId`。
- `/ms/vteam/api/user/**` 使用 CTeam 网页登录态，Open API 的 `X-DEVOPS-ACCESS-TOKEN` 不能直接代替该登录态。认证策略优先复用浏览器 Cookie；如果拿不到浏览器 Cookie，再提示用户登录浏览器或退回旧账号密码配置。
- 插件中不得硬编码账号、密码、Cookie、Token 或项目 ID；默认项目推荐放在包内用户级 `local/local.json` 中。
- 读取类接口不需要写操作审批。创建、修改、评论、流转等写接口必须由对话中的确认表单或显式用户指令触发；调试时优先使用 dry-run。

### 项目配置

当前推荐在包内用户级长期配置中放默认项目。`local/local.json` 不强制要求
`loginUrl`、`username`、`password`：

```json
{
  "projectId": "your-project-id"
}
```

如果当前环境无法读取浏览器 Cookie，可以兼容旧方案，在同一个 JSON 中补充：

```json
{
  "projectId": "your-project-id",
  "loginUrl": "https://devops.cwoa.net/...",
  "username": "your-username",
  "password": "your-password"
}
```

插件挂载配置中的 `config.projectId` 仍然保留兼容能力，并且优先级高于
本地 JSON。后续接入人如果要切换主项目，推荐只修改
`local/local.json` 中的 `projectId`；不要修改解析器或
`cteam-client.js`。如果两个位置都没有配置 `projectId`，每次工具调用
都必须提供 `project_id` 或 `project_url`。

当工具调用显式携带 `project_id`，或 `project_url` / `demand_url` /
`issue_url` / `wiki_url` 中能解析出项目号时，插件会自动记忆该项目号：
存在当前项目目录时写入项目级 `local/local.json`，否则写入包内用户级
`local/local.json`。写入目标必须与默认项目解析优先级一致，避免写入后仍被
更高优先级配置覆盖。


验证状态：已通过真实接口请求验证。

```http
POST /ms/vteam/api/user/issue_classify/{projectId}/tree
Content-Type: application/json
```

获取完整分类树时，请求体为：

```json
[]
```

页面选中筛选条件后，请求体可能为：

```json
[
  {
    "name": "字段名",
    "value": ["字段值"]
  }
]
```

响应结构：

```json
{
  "status": 0,
  "code": 0,
  "data": [
    {
      "id": "分类节点 ID",
      "parentId": "父节点 ID",
      "name": "节点名称",
      "sort": 0,
      "createUser": "创建人",
      "createTime": "创建时间",
      "count": 0,
      "children": []
    }
  ],
  "traceId": "请求追踪 ID"
}
```

### 验证结果

- 验证日期：`2026-08-18`
- 项目：`m68126`
- 根节点数量：`11`
- 节点总数：`311`

根节点样例：

| name | id | count |
|---|---|---:|
| ITR转需求 | `d062111934b841dc9d6736d164f756f1` | 4 |
| 自动化运维中心 | `e1e79ce2717447c5949643e55bfacea1` | 761 |
| 通道服务 | `f77b24c5dfa44fe18c2ccf37159bea0f` | 1 |
| 项目定制开发 | `a00f8ae3c84f4074bab33a217164fed1` | 63 |
| 研发类story | `4e02d4f93979453097d9eeef67d0d422` | 4 |
| 标准运维原子 | `39759d9f61d844b9a6398c5ad6912324` | 4 |
| 第一次Charter | `f12e6605a358427fb2bfd2189cdfb518` | 47 |
| 中间件自动化 | `ef5783ea7b2345f2b5d9d975043a11ab` | 8 |
| 网络自动化 | `2700b4f1bb2c439a81861bca74fd7df4` | 21 |
| 工时填写 | `6077f84583c149b18153222ce19c7510` | 2 |
| 未分类 | `-1` | 9 |

版本节点样例：

```text
自动化运维中心
└─ V4.0
   id: 05fe967b7e944d1397e0a7b1f5ad81e5
   └─ 迭代二（2026.07）
      id: 88baf667bacf4b9e9e41136f7ca4367a
      ├─ 权限设计
      ├─ 通道管理
      ├─ 标签管理
      ├─ 系统设置
      ├─ 巡检场景
      └─ 安全管理
```

## 插件领域模型

Provider 不直接向 Agent 暴露 CTeam 原始响应，应转换为稳定模型：

```ts
export interface CTeamCategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  count: number;
  sort: number;
  path: string[];
  children: CTeamCategoryNode[];
}
```

`path` 由插件根据父子关系补齐，例如：

```json
["自动化运维中心", "V4.0", "迭代二（2026.07）"]
```

## Provider 与 Tool 映射

Host Provider 方法：

```ts
listDemandCategories(input: {
  projectId: string;
  filters?: Array<{ name: string; value: string[] }>;
}): Promise<CTeamCategoryNode[]>;
```

建议的 DSH Tool：

```text
cteam_list_demand_categories
```

Tool 输入：

```json
{
  "projectUrl": "https://devops.cwoa.net/devops/console/vteam/m68126/twDemand/demand?vmode=table",
  "projectId": "m68126",
  "filters": []
}
```

约束：

- `project_url` 与 `project_id` 都是可选的；两者都省略时依次使用插件配置、项目级 `local/local.json`、旧项目级 `.ops-local/cw-browser-login.json`、包内用户级 `local/local.json` 中的 `projectId`。
- 如果这些位置都未配置 `projectId`，则至少提供 `project_url` 或 `project_id`。
- 同时提供时，必须校验二者解析结果一致。
- 返回完整树，并额外提供扁平索引，便于 Agent 按名称查找节点 ID。
- 名称可能重复，Agent 选择分类时应使用完整路径或节点 ID。

## 根据分类和条件获取需求列表

验证状态：已通过 Chrome 页面请求抓取和真实接口请求验证。

```http
POST /ms/vteam/api/user/issue/{projectId}/table/DEMAND?num={page}&size={pageSize}&remember={remember}
Content-Type: application/json
```

`num` 是从 1 开始的页码。插件默认使用 `remember=false`，避免把 Agent 的临时筛选保存成用户的页面筛选状态。

无分类筛选时的基础请求体：

```json
[
  { "name": "exclude", "value": [] },
  { "name": "classify_tree_strategy", "value": ["true"] }
]
```

按分类节点筛选时，必须使用字段名 `demandClassify`：

```json
[
  {
    "name": "demandClassify",
    "value": ["d062111934b841dc9d6736d164f756f1"]
  },
  { "name": "exclude", "value": [] },
  { "name": "classify_tree_strategy", "value": ["true"] }
]
```

其他筛选条件追加在 `demandClassify` 与两个基础字段之间：

```json
{ "name": "priority", "value": ["CENTRAL"] }
```

已发现的筛选名包括：

```text
modelTypeId
priority
state
status
createUser
createTime
label
dispatch_project
dispatch
version
```

响应分页结构：

```text
data.header
data.records.content
data.records.totalElements
data.records.totalPages
data.records.number
data.records.size
```

`data.records.number` 是从 0 开始的 Spring Page 页码，插件对外转换为从 1 开始。

每条记录的字段位于 `record.property`。插件稳定输出 `id`、`number`、`title`、优先级、状态、工作项类型、父工作项、关注/完成/过期状态、分派状态，并在 `fields` 中保留所有返回字段的标准化值。

### 验证结果

- 验证日期：`2026-08-18`
- 项目：`m68126`
- 分类：`ITR转需求`
- 分类 ID：`d062111934b841dc9d6736d164f756f1`
- 分类树计数：`4`
- 列表接口 `totalElements`：`4`
- `remember=false`：验证通过

建议的 DSH Tool：

```text
cteam_list_demands
```

Tool 输入样例：

```json
{
  "project_id": "m68126",
  "category_id": "d062111934b841dc9d6736d164f756f1",
  "filters": [
    { "name": "priority", "value": ["CENTRAL"] }
  ],
  "page": 1,
  "page_size": 20,
  "remember": false
}
```

## 获取缺陷列表

验证状态：已通过真实接口请求验证。

缺陷列表和需求列表共用同一组表格接口，只是 `classify` 段改为 `BUG`：

```http
POST /ms/vteam/api/user/issue/{projectId}/table/BUG?num={page}&size={pageSize}&remember={remember}
Content-Type: application/json
```

插件默认请求体：

```json
[
  { "name": "exclude", "value": [] },
  { "name": "classify_tree_strategy", "value": ["true"] }
]
```

可以追加任意 CTeam 查询字段，例如 `priority`、`state`、`status`、
`createUser`、`createTime`、`label`、`dispatch_project`、`dispatch`、
`version`、`modelTypeId` 或快捷筛选器里的 `relation`。

### 验证结果

- 验证日期：`2026-08-18`
- 项目：`m68126`
- 接口：`POST /ms/vteam/api/user/issue/m68126/table/BUG?num=1&size=5&remember=false`
- 总数：`4343`
- 第一条样例：`p176_7557`，`【国际化】自动巡检指标库脚本测试时有中文显示`，状态 `新`，优先级 `中`

建议的 DSH Tool：

```text
cteam_list_bugs
```

Tool 输入样例：

```json
{
  "project_id": "m68126",
  "filters": [
    { "name": "relation", "value": ["CREATED"] }
  ],
  "page": 1,
  "page_size": 20,
  "remember": false
}
```

## 获取个人/团队筛选器与可查询字段

验证状态：已通过真实接口请求验证。

快捷筛选器：

```http
GET /ms/vteam/api/user/issue_select/{projectId}/{selectType}
```

`selectType` 必须按工作项类型区分：

| issue_type | selectType |
|---|---|
| `DEMAND` | `DEMAND_SELECT` |
| `BUG` | `BUG_SELECT` |
| `TASK` | `TASK_SELECT` |

`BOARD_SELECT` 是看板筛选器，不等同于需求/缺陷表格筛选器。用它读取
BUG 会只看到 `我创建`、`我参与` 等通用项，拿不到缺陷页里的
`国际化缺陷`、`4.0版本` 等团队筛选器。

可用于列表查询的字段：

```http
GET /ms/vteam/api/user/issue_field/{projectId}/query_filters?classify={DEMAND|BUG|TASK}
```

`issue_select` 返回的 `condition` 是 JSON 字符串，插件会解析为
`conditions`，并按 `scope` 拆成：

- `scope=0`：个人筛选器
- `scope=1`：团队筛选器

### 验证结果

- 验证日期：`2026-08-18`
- 项目：`m68126`
- BUG 快捷筛选器：`12` 个，`selectType=BUG_SELECT`
- BUG 个人筛选器：`我创建`、`我关注`、`我分派`、`前端缺陷修复`、`缺陷率`
- BUG 团队筛选器：`国际化缺陷`、`4.0版本`、`版本待修复缺陷`、`v3.1缺陷统计`、`v3.2缺陷统计`、`2.7全量测试`、`待修复`
- BUG 查询字段：`37` 个
- DEMAND 快捷筛选器：`5` 个，`selectType=DEMAND_SELECT`
- DEMAND 个人筛选器：`我创建`、`我参与`、`我关注`、`我分派`
- DEMAND 团队筛选器：`青海电力`
- DEMAND 查询字段：`53` 个
- 查询字段样例：`modelTypeId`、`priority`、`state`、`status`、`createUser`、`createTime`、`label`、`dispatch_project`、`dispatch`、`version`

建议的 DSH Tool：

```text
cteam_list_issue_filters
```

Tool 输入样例：

```json
{
  "project_id": "m68126",
  "issue_type": "BUG"
}
```

## 获取单个需求详情与评论

验证状态：已通过 CTeam 微前端资源和真实接口请求验证。

微前端入口 `/vteam/` 加载 `/vteam/vteam.0fce57c1da7a72515b42.min.js`，其中详情方法为：

```js
GET vteam/api/user/issue/{projectId}/{issueId}
```

浏览器网关实际请求：

```http
GET /ms/vteam/api/user/issue/{projectId}/{issueId}
```

响应结构：

```json
{
  "status": 0,
  "code": 0,
  "data": {
    "property": {
      "id": {
        "id": "id",
        "label": "id",
        "name": "id",
        "type": "SELECT",
        "source": "IssueDomainFieldObject",
        "value": "需求 ID",
        "displayValue": "需求 ID",
        "editable": false,
        "required": false,
        "flowField": false
      },
      "desc": {
        "label": "描述",
        "name": "desc",
        "type": "TEXT",
        "value": "Markdown 正文",
        "displayValue": "Markdown 正文"
      }
    },
    "files": [],
    "delete": false
  },
  "traceId": "请求追踪 ID"
}
```

评论接口随单据详情一起读取：

```http
GET /ms/vteam/api/user/issue_comment/{projectId}/{issueId}
```

评论响应结构：

```json
{
  "status": 0,
  "code": 0,
  "data": [
    {
      "id": "评论 ID",
      "projectId": "m68126",
      "createUser": "用户名",
      "createTime": "2026-08-17 15:59:35",
      "comment": "<p>评论 HTML</p>",
      "parentId": "",
      "issueId": "需求 ID",
      "nodeId": "4149",
      "nodeName": "待规划",
      "nextId": "",
      "nextName": "",
      "assignProjectId": "",
      "children": []
    }
  ],
  "traceId": "请求追踪 ID"
}
```

正文或评论中的图片也属于单据详情。插件会从 Markdown 图片语法和 HTML
`<img>` 标签中提取图片：

```markdown
![enter image description here](/ms/vteam/api/user/file/m68126/download/a0439951f1c7482eb710ab46c0cc6569)
```

同一网页登录态可直接下载图片：

```http
GET /ms/vteam/api/user/file/{projectId}/download/{fileId}
```

工具默认把图片下载到：

```text
.temp/dsh-cteam/{issueId}/{index}-{fileId}.{ext}
```

可通过 `download_images=false` 只返回图片链接，不落盘。

`property` 同时包含领域字段和动态字段。插件对外稳定输出：

```ts
export interface CTeamDemandDetail {
  id: string;
  number: string;
  title: string;
  desc: string;
  editorType: string;
  typeClassify: string;
  priority: string;
  priorityName: string;
  stateId: string;
  stateName: string;
  modelTypeId: string;
  modelTypeName: string;
  demandClassifyId: string;
  demandClassifyName: string;
  parentId: string;
  assignId: string;
  createUser: string;
  createUserName: string;
  createTime: string;
  updateUser: string;
  updateUserName: string;
  updateTime: string;
  fileId: string;
  deleted: boolean;
  follow: boolean;
  finished: boolean;
  expired: boolean;
  dispatch: string;
  dispatchName: string;
  files: Array<{ id: string; name: string; url: string; raw: unknown }>;
  fields: Record<string, {
    id: string;
    name: string;
    label: string;
    type: string;
    source: string;
    value: string;
    displayValue: string;
    editable: boolean;
    required: boolean;
    flowField: boolean;
  }>;
}

export interface CTeamDemandComment {
  id: string;
  projectId: string;
  issueId: string;
  parentId: string;
  createUser: string;
  createTime: string;
  commentHtml: string;
  nodeId: string;
  nodeName: string;
  nextId: string;
  nextName: string;
  assignProjectId: string;
  children: CTeamDemandComment[];
}

export interface CTeamDemandImage {
  source: 'description' | 'comment';
  sourceId: string;
  index: number;
  alt: string;
  url: string;
  projectId: string;
  fileId: string;
  downloaded: boolean;
  localPath: string;
  contentType: string;
  bytes: number;
}
```

### 验证结果

- 验证日期：`2026-08-18`
- 项目：`m68126`
- 接口：`GET /ms/vteam/api/user/issue/m68126/{issueId}`
- 响应：`status=0`，`data.property` 包含 `id`、`number`、`title`、`desc`、`priority`、`state`、`demandClassify`、`createUser`、`createTime` 等字段
- 评论接口：`GET /ms/vteam/api/user/issue_comment/m68126/{issueId}`，验证到含评论样本 `p176_7549` 返回 `comment` HTML、创建人、创建时间和节点状态
- 图片下载：验证样本 `p176_7512`（`2332e83462d94474b45f84f450ad5d52`）正文包含 3 张 Markdown 图片，3 个 `/ms/vteam/api/user/file/m68126/download/{fileId}` 均返回 PNG 并成功落盘
- 同组页面接口还包括：
  - `GET /ms/vteam/api/user/issue_log/{projectId}/{issueId}`
  - `GET /ms/vteam/api/user/issue/{projectId}/children/{issueId}`

建议的 DSH Tool：

```text
cteam_get_demand_detail
cteam_get_issue_detail
```

Tool 输入样例：

```json
{
  "project_id": "m68126",
  "demand_id": "c5435921d2474433b568ae51224f180c"
}
```

也可以从 URL 解析：

```json
{
  "demand_url": "https://devops.cwoa.net/devops/console/vteam/m68126/twDemand/demand?vmode=table&id=c5435921d2474433b568ae51224f180c"
}
```

通用单据详情工具也可读取缺陷：

```json
{
  "issue_url": "https://devops.cwoa.net/devops/console/vteam/m68126/twBug?vmode=table&id=f214e6e75085497b9373a026014f3060",
  "issue_type": "BUG"
}
```

缺陷详情真实验证样例：`p176_7557` 返回标题、状态、优先级、`desc`、
`39` 个字段和正文中的 `1` 张 PNG 图片；图片通过同一网页登录态成功下载到
`.temp/dsh-cteam/f214e6e75085497b9373a026014f3060/`。

## 单据流转发现

验证状态：已通过 CTeam 微前端资源分析；真实接口样例已采集到缺陷
`p176_7557` 的流转结构。插件当前只暴露只读发现能力，不执行真实流转。

微前端中的相关方法包括：

```text
getFlowStateList
getFieldsByState
getAgentList
turnToNextNode
```

节点列表：

```http
GET /ms/vteam/api/user/issue_direction/{projectId}/{issueId}
```

响应中 `data.data` 是状态节点数组，节点字段包括：

```json
{
  "id": "状态 ID",
  "name": "状态名称",
  "operation": true
}
```

`operation=true` 表示页面允许当前用户操作到该节点；`operation=false`
的节点仍可能返回字段约束，但不能直接作为可执行动作。

目标状态必填字段：

```http
GET /ms/vteam/api/user/issue_direction/{projectId}/{issueId}/{nextNodeId}/field
```

响应是字段数组，字段结构与详情 `property` 字段相近：

```json
{
  "id": "字段 ID",
  "name": "字段名",
  "label": "显示名",
  "type": "SELECT",
  "required": true,
  "flowField": true
}
```

目标状态候选经办人/角色：

```http
GET /ms/vteam/api/user/issue_direction/{projectId}/{issueId}/{nextNodeId}
```

响应样例：

```json
{
  "users": [
    { "first": "linyuhan", "second": "林钰涵[linyuhan]" }
  ],
  "roles": []
}
```

字段候选值：

```http
GET /ms/vteam/api/user/issue_field_value/{projectId}/option/{fieldIdOrName}?query=
```

`SELECT`、`MULTI_SELECT`、`RADIO`、`CHECKBOX`、`USER` 等字段可通过该接口
读取候选值。验证中以下缺陷流转字段可用空 `query` 获取候选：

| field name | label | type |
|---|---|---|
| `UPJor0G5PM` | 解决措施 | `SELECT` |
| `bug_reason` | 缺陷原因 | `SELECT` |
| `bqNDIGdiWw` | 问题来源版本 | `SELECT` |
| `developers` | 开发人员 | `USER` |
| `operator_user` | 经办人 | `USER` |

真实缺陷样例：

- 验证日期：`2026-08-18`
- 项目：`m68126`
- 缺陷：`p176_7557`
- issueId：`f214e6e75085497b9373a026014f3060`
- 当前状态：`867` / `新`
- 可见目标节点：`新`、`开发中`、`拒绝`、`已转需求`

目标状态必填字段样例：

| target | operation | required fields |
|---|---:|---|
| `新` | true | 经办人 |
| `开发中` | true | 开发人员、经办人 |
| `拒绝` | true | 解决措施、缺陷原因、开发人员、问题来源版本、经办人 |
| `已转需求` | false | 开发人员、需求链接、缺陷原因、解决措施、问题来源版本、经办人 |

页面提交流转时使用：

```http
POST /ms/vteam/api/user/issue_direction/{projectId}/next
Content-Type: application/json
```

请求体形状：

```json
{
  "issueId": "单据 ID",
  "nextNodeId": "目标状态 ID",
  "comment": {
    "atUser": [],
    "comment": "<p>评论 HTML</p>"
  },
  "directionFields": [
    {
      "fieldId": "字段 ID",
      "value": "字段值"
    }
  ],
  "operators": ["经办人 username"]
}
```

注意：

- `operator_user` 必填时通过 `operators` 提交，不放入 `directionFields`。
- 其他必填流转字段通过 `directionFields` 提交，使用字段 `id` 作为
  `fieldId`。
- 评论长度页面侧限制为小于 `2000`。
- 插件后续如果增加真实流转工具，必须先用只读发现结果校验目标状态、
  必填字段和候选值，再让用户明确确认后才能 POST。

建议的 DSH Tool：

```text
cteam_get_issue_transitions
```

Tool 输入样例：

```json
{
  "issue_url": "https://devops.cwoa.net/devops/console/vteam/m68126/twBug?vmode=table&id=f214e6e75085497b9373a026014f3060",
  "issue_type": "BUG",
  "include_field_options": true,
  "option_limit": 50
}
```

## 需求 PRD 创建

验证状态：上传接口、模型接口、字段选项接口已通过网页登录态验证；创建
接口路径已确认，create payload 仍需以 `dry_run` 输出和服务端响应继续
校准，不应把未确认字段结构写死为唯一契约。

```http
GET /ms/vteam/api/user/issue_model/{projectId}/project
GET /ms/vteam/api/user/issue_field/{projectId}/preview?classify=DEMAND
POST /ms/vteam/api/user/file/{projectId}/upload
POST /ms/vteam/api/user/issue/{projectId}
```

已确认的需求 Story 模型样例：

```json
{
  "modelTypeId": "385e07e47da04dfc9e5aae212c5ff0e6",
  "typeId": "93a059dc2e744c95ae88be4828916db5",
  "typeName": "Story",
  "templateId": "3d8db14b19874fec83f69719aeba3ff2"
}
```

图片与无图片使用同一条 PRD 创建流程：

1. 从右侧 PRD 工作台读取 Markdown、标题和粘贴图片占位符。
2. 通过对话确认表单收集需求分类和 CTeam 必填字段。
3. 有图片时先 `multipart/form-data` 上传文件，拿到 `fileId`。
4. 将 Markdown 中的 `cteam-pasted-image://...` 替换为
   `/ms/vteam/api/user/file/{projectId}/download/{fileId}`。
5. 将 Markdown 转为 CTeam HTML，写入创建请求的 `desc`。
6. 调用创建接口。调试阶段优先使用 `dry_run: true` 查看请求体。

当前 `cteam_submit_prd_demand` 默认收集的创建字段来自 CTeam
`issue_field/{projectId}/preview?classify=DEMAND` 字段预览接口，并叠加已
确认的创建必填字段标记，不包含虚构的 `需求类型`。`m68126` 当前返回 49
个需求字段，确认表单会展示必填字段和可填写的非必填字段：

```text
priority
parent_demand
3Q3brZUOok / 是否向下兼容
version
iteration
operator_user
developers
```

其他非必填字段包括模块、标签、需求类别、预计开始/结束时间、预估工时、
提出人、项目名称、前后端估时、交付/发布时间等，实际以字段预览接口返回
为准。

建议的 DSH Tool：

```text
cteam_submit_prd_demand
cteam_create_demand_from_submission
```

## 插件实现顺序

1. 建立 `CTeamClient`，负责登录态、请求、超时和错误映射。
2. 建立 `CTeamProvider`，实现分类树、需求列表、缺陷列表、筛选器、单据详情读取、流转发现和 PRD 创建。
3. 注册 `cteam_list_demand_categories`、`cteam_list_demands`、`cteam_get_demand_detail`、`cteam_list_bugs`、`cteam_list_issue_filters`、`cteam_get_issue_detail`、`cteam_get_issue_transitions`、`cteam_submit_prd_demand` Tool。
4. 为项目 URL 解析、树转换和重复名称编写单元测试。
5. 在 DSH 对话中先用 JSON/Markdown 卡片展示结果。
6. 后续再增加左侧分类树、需求列表联动和可编辑工作台 UI。

## 待补充接口

以下接口发现后继续追加到本文档，每个接口都必须记录验证状态和脱敏样例：

- 修改、评论需求
- 单据真实流转、评论、创建
- Wiki 分类树、Markdown 导入、内容修改
