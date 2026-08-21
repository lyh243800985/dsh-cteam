import { resolveProjectId } from './categories.js';

function optionalString(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function buildDefaultPrdMarkdown(title = '未命名需求') {
  return [
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
  ].join('\n');
}

export function parseAuthoringToolArguments(args, options = {}) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('tool arguments must be an object');
  }
  const title = optionalString(args.title, 'title') ?? '未命名需求';
  const initialMarkdown = optionalString(args.initial_markdown, 'initial_markdown');
  return {
    projectId: resolveProjectId({
      projectUrl: args.project_url,
      projectId: args.project_id,
      configuredProjectId: options.configuredProjectId,
    }),
    title,
    sourceIssueUrl: optionalString(args.source_issue_url, 'source_issue_url') ?? '',
    sourceIssueId: optionalString(args.source_issue_id, 'source_issue_id') ?? '',
    markdown: initialMarkdown ?? buildDefaultPrdMarkdown(title),
  };
}
