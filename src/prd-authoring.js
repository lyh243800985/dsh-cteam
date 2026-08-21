import { defineTool } from '@deepseek-ai/dsh-tools';
import { parseAuthoringToolArguments } from './authoring.js';
import {
  PROJECT_ID_PARAMETER_DESCRIPTION,
  PROJECT_PARAMETER_DESCRIPTION,
} from './common.js';
import { resolveDefaultProjectId } from './project-config.js';

export const CTEAM_PRD_AUTHORING_PRESENTATION_MARKER = 'dsh-cteam-prd-authoring-v1:';

export function presentPrdAuthoringResult(_args, result) {
  if (result.isError || result.meta === undefined) return undefined;
  return {
    card: 'generic',
    title: result.meta.title || 'CTeam PRD authoring',
    content: [{
      type: 'text',
      text: `${CTEAM_PRD_AUTHORING_PRESENTATION_MARKER}${JSON.stringify(result.meta)}`,
    }],
  };
}

export function createAuthoringWorkspace(value) {
  const workspaceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    ...value,
    workspaceId,
  };
}

function renderPrdAuthoring(value) {
  return [
    `CTeam PRD authoring workspace for project ${value.projectId}`,
    `title=${value.title}`,
    value.workspaceId ? `workspace_id=${value.workspaceId}` : undefined,
    value.sourceIssueId ? `source_issue_id=${value.sourceIssueId}` : undefined,
    '',
    'The right details panel should now show the split Markdown editor/preview.',
  ].filter((line) => line !== undefined).join('\n');
}

export function createPrdAuthoringTool(config = {}) {
  return defineTool({
    name: 'cteam_open_prd_authoring',
    description: 'Open the dsh-cteam PRD authoring workspace in the right details panel. Use this for /cteam-prd-authoring or when the user asks to enter PRD writing mode. This tool does not use Browser/CDP and does not submit to CTeam.',
    parameters: {
      project_url: {
        type: 'string',
        description: PROJECT_PARAMETER_DESCRIPTION,
      },
      project_id: {
        type: 'string',
        description: PROJECT_ID_PARAMETER_DESCRIPTION,
      },
      title: {
        type: 'string',
        description: 'PRD title or requirement name. Defaults to 未命名需求.',
      },
      initial_markdown: {
        type: 'string',
        description: 'Optional initial Markdown source for the editor. If omitted, a PRD template is used.',
      },
      source_issue_url: {
        type: 'string',
        description: 'Optional source CTeam issue/demand URL this PRD is based on.',
      },
      source_issue_id: {
        type: 'string',
        description: 'Optional source CTeam issue/demand ID this PRD is based on.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          markdown: { type: 'string', required: true },
          workspaceId: { type: 'string', required: true },
          sourceIssueUrl: { type: 'string', required: true },
          sourceIssueId: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderPrdAuthoring(value) }],
      presentationMeta: (_args, value) => value,
    },
    presentResult: presentPrdAuthoringResult,
    timeoutMs: config.timeoutMs ?? 30_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parsed = parseAuthoringToolArguments(args, {
        configuredProjectId: resolveDefaultProjectId(config, exec),
      });
      return createAuthoringWorkspace(parsed);
    },
  });
}
