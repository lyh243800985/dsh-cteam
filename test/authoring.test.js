import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDefaultPrdMarkdown,
  parseAuthoringToolArguments,
} from '../src/authoring.js';
import { apply } from '../src/index.js';

test('builds a default PRD markdown draft', () => {
  const markdown = buildDefaultPrdMarkdown('巡检指标库');
  assert.match(markdown, /^# 用户故事/u);
  assert.match(markdown, /# 需求描述/u);
  assert.match(markdown, /# 原型/u);
  assert.match(markdown, /# 测试建议/u);
  assert.match(markdown, /# 其他备注（可选）$/u);
});

test('uses the CTeam PRD default template exactly', () => {
  assert.equal(buildDefaultPrdMarkdown('巡检指标库'), [
    '# 用户故事',
    '用户故事标准句型模板：作为XX， 我想要XX， 以便于 XX（必填）',
    '',
    '# 需求描述',
    '清楚描述需求，能让研发经理理解，可包含一些关键词（必填）',
    '',
    '# 原型',
    '交互类的用户故事要有原型；绘制原型的工具不限，但应包含主要的业务场景（用户角色、业务流程、异常情况）；对UI/UE有要求的，需要明确相关具体要求和验收条件、必要的话提供UI/UE设计，否则，研发团队将基于设计规范主导UI/UE设计（必填。接口类无UI的，说明无UI即可）',
    '',
    '# 测试建议',
    '核心业务场景用例，在什么样的情景或条件下，做了什么操作，采取了什么行动，得到了什么结果。示例：当邮件的发送者在邮件书写页面写完了邮件主体（没有加粗），选中其中的几个文字，点击加粗按钮，选中的文字粗体显示。（必填）',
    '',
    '# 其他备注（可选）',
  ].join('\n'));
});

test('parses PRD authoring arguments with configured project', () => {
  assert.deepEqual(parseAuthoringToolArguments({
    title: '巡检指标库',
    source_issue_id: 'issue-id',
  }, {
    configuredProjectId: 'm68126',
  }), {
    projectId: 'm68126',
    title: '巡检指标库',
    sourceIssueUrl: '',
    sourceIssueId: 'issue-id',
    markdown: buildDefaultPrdMarkdown('巡检指标库'),
  });
});

test('preserves provided PRD markdown draft', () => {
  assert.equal(parseAuthoringToolArguments({
    project_url: 'https://devops.cwoa.net/devops/console/vteam/m68126/twDemand/demand?vmode=table',
    initial_markdown: '# Existing',
  }).markdown, '# Existing');
});

test('registers PRD authoring and submit skills and tools', () => {
  const skills = [];
  const tools = [];
  apply({
    skills: { register: (skill) => skills.push(skill) },
    tools: { register: (tool) => tools.push(tool) },
    userQuestions: {},
  }, {
    projectId: 'm68126',
  });

  assert.deepEqual(skills.map((skill) => skill.name), [
    'cteam-prd-authoring',
    'cteam-prd-submit',
    'cteam-wiki',
    'cteam-wiki-submit',
  ]);
  assert.equal(tools.some((tool) => tool.name === 'cteam_submit_prd_demand'), true);
  assert.equal(tools.some((tool) => tool.name === 'cteam_create_demand_from_submission'), true);
  assert.equal(tools.some((tool) => tool.name === 'cteam_list_wiki_tree'), true);
  assert.equal(tools.some((tool) => tool.name === 'cteam_submit_wiki_markdown'), true);
  assert.equal(tools.some((tool) => tool.name === 'cteam_upload_wiki_markdown'), true);
  assert.equal(tools.some((tool) => tool.name === 'cteam_save_prd_authoring'), false);
});

test('authoring tool creates an isolated browser-cache workspace id', async () => {
  const tools = [];
  apply({
    skills: { register: () => {} },
    tools: { register: (tool) => tools.push(tool) },
    userQuestions: {},
  }, {
    projectId: 'm68126',
  });
  const tool = tools.find((item) => item.name === 'cteam_open_prd_authoring');

  const first = await tool.execute({ title: '巡检指标库' }, {});
  const second = await tool.execute({ title: '巡检指标库' }, {});

  assert.notEqual(first.workspaceId, second.workspaceId);
  assert.equal(first.markdown, buildDefaultPrdMarkdown('巡检指标库'));
  assert.equal(Object.hasOwn(first, 'filePath'), false);
});
