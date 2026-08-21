import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDemandFromSubmissionTool,
} from '../src/index.js';
import {
  buildDemandCreateBody,
  demandUrl,
  markdownToCteamHtml,
  normalizeCreatedIssue,
  replaceImagePlaceholders,
  selectDemandModel,
  uploadedFileId,
} from '../src/submission.js';

test('converts Markdown paragraphs, headings, and images to CTeam HTML', () => {
  assert.equal(
    markdownToCteamHtml('# 标题\n\n第一行\n第二行\n\n![截图](cteam-pasted-image://one)'),
    '<h1>标题</h1><p>第一行<br>第二行</p><p><img src="cteam-pasted-image://one" alt="截图" style="max-width:100%;" contenteditable="false"></p>',
  );
});

test('escapes unsafe Markdown text before building HTML', () => {
  assert.equal(
    markdownToCteamHtml('## <script>\nA & B'),
    '<h2>&lt;script&gt;</h2><p>A &amp; B</p>',
  );
});

test('replaces pasted image placeholders with CTeam download URLs', () => {
  assert.equal(
    replaceImagePlaceholders(
      '正文\n![图](cteam-pasted-image://abc)',
      'm68126',
      [{ placeholder: 'cteam-pasted-image://abc', fileId: 'file-1' }],
    ),
    '正文\n![图](/ms/vteam/api/user/file/m68126/download/file-1)',
  );
});

test('selects the project Story demand model when available', () => {
  const model = selectDemandModel({
    issueModelTypes: [{
      typeClassify: 'DEMAND',
      issueModelTypes: [
        { id: 'epic-model', typeId: 'epic-type', typeName: 'Epic', templateId: 'epic-template', apply: true },
        { id: 'story-model', typeId: 'story-type', typeName: 'Story', templateId: 'story-template', apply: true },
      ],
    }],
  });

  assert.deepEqual(model, {
    modelTypeId: 'story-model',
    typeId: 'story-type',
    typeName: 'Story',
    templateId: 'story-template',
  });
});

test('builds the CTeam demand create body used by the web form', () => {
  const body = buildDemandCreateBody({
    title: '新增巡检指标库',
    categoryId: 'category-id',
    descMarkdown: '# 用户故事',
    model: {
      modelTypeId: 'story-model',
      typeId: 'story-type',
      typeName: 'Story',
      templateId: 'story-template',
    },
    fields: {
      priority: 'URGENT',
      version: 'V4.0',
      developers: ['zhangsan', 'lisi'],
      '3Q3brZUOok': 'YES',
    },
    fieldDefinitions: [
      { id: 'priority', name: 'priority', label: '优先级', type: 'SELECT' },
      { id: 'version', fieldId: 'version-field', name: 'version', label: '版本', type: 'SELECT' },
      { id: 'developers', fieldId: '4501', name: 'developers', label: '开发人员', type: 'USER' },
      { id: '3Q3brZUOok', fieldId: 'compat-field', name: '3Q3brZUOok', label: '是否向下兼容', type: 'RADIO' },
    ],
  });

  assert.equal(body.title, '新增巡检指标库');
  assert.equal(body.desc, '# 用户故事');
  assert.equal(body.editorType, 'MARKDOWN');
  assert.equal(body.modelTypeId, 'story-model');
  assert.equal(body.demandClassify, 'category-id');
  assert.equal(body.priority, 'URGENT');
  assert.equal(body.parentId, '');
  assert.deepEqual(body.fileVO, []);
  assert.deepEqual(body.labelId, []);
  assert.deepEqual(body.instanceValue.find((field) => field.fieldId === 'compat-field'), {
    fieldId: 'compat-field',
    value: 'YES',
  });
  assert.deepEqual(body.instanceValue.find((field) => field.fieldId === 'version-field'), {
    fieldId: 'version-field',
    value: 'V4.0',
  });
  assert.deepEqual(body.instanceValue.find((field) => field.fieldId === '4501'), {
    fieldId: '4501',
    value: 'zhangsan,lisi',
  });
  assert.equal(Object.hasOwn(body, 'property'), false);
  assert.equal(Object.hasOwn(body, 'dynamicFields'), false);
});

test('keeps empty template fields in CTeam instanceValue', () => {
  const body = buildDemandCreateBody({
    title: '标题',
    categoryId: '-1',
    descMarkdown: '# 用户故事',
    fields: {
      version: '64a0585441d94500b2e9135b38083149',
    },
    fieldDefinitions: [
      { id: 'version', fieldId: 'version-field', name: 'version', label: '版本', type: 'SELECT' },
      { id: 'developers', fieldId: '4501', name: 'developers', label: '开发人员', type: 'USER' },
    ],
  });

  assert.deepEqual(body.instanceValue, [
    { fieldId: 'version-field', value: '64a0585441d94500b2e9135b38083149' },
    { fieldId: '4501', value: '' },
  ]);
});

test('normalizes upload and create results', () => {
  assert.equal(uploadedFileId({ data: { id: 'file-id' } }), 'file-id');
  assert.deepEqual(normalizeCreatedIssue({
    issueId: 'issue-id',
    issueNo: 'p176_1',
    title: '标题',
  }), {
    id: 'issue-id',
    number: 'p176_1',
    title: '标题',
    raw: {
      issueId: 'issue-id',
      issueNo: 'p176_1',
      title: '标题',
    },
  });
});

test('builds CTeam demand URLs', () => {
  assert.equal(
    demandUrl('https://devops.cwoa.net', 'm68126', 'issue-id'),
    'https://devops.cwoa.net/devops/console/vteam/m68126/twDemand?vmode=table&id=issue-id',
  );
});

test('rejects create when pasted image placeholders are not uploaded', async () => {
  let createCalled = false;
  const tool = createDemandFromSubmissionTool({
    projectId: 'm68126',
    loginConfigPath: './package.json',
    createAuthenticatedSession: async () => ({ fake: true }),
    fetchIssueModelProject: async () => ({}),
    createIssue: async () => {
      createCalled = true;
      return { issueId: 'issue-id' };
    },
  });

  const result = await tool.execute({
    title: '巡检指标库',
    category_id: 'category-id',
    category_path: ['自动化运维中心'],
    draft_markdown: '# 用户故事\n![截图](cteam-pasted-image://missing)',
    fields: {},
    field_definitions: [],
    images: [],
  }, {});

  assert.equal(result.succeeded, false);
  assert.equal(createCalled, false);
  assert.match(result.error, /pasted image cache missing/u);
  assert.deepEqual(result.errorDetails.missingImagePlaceholders, ['cteam-pasted-image://missing']);
});

test('returns retry arguments instead of throwing when CTeam create fails', async () => {
  const tool = createDemandFromSubmissionTool({
    projectId: 'm68126',
    loginConfigPath: './package.json',
    createAuthenticatedSession: async () => ({ fake: true }),
    fetchIssueModelProject: async () => ({
      issueModelTypes: [{
        typeClassify: 'DEMAND',
        issueModelTypes: [{
          id: 'story-model',
          typeId: 'story-type',
          typeName: 'Story',
          templateId: 'story-template',
          apply: true,
        }],
      }],
    }),
    uploadIssueFile: async () => ({ id: 'uploaded-file' }),
    createIssue: async () => {
      const error = new Error('CTeam issue create API failed: requestBody.param.illegal');
      error.status = 8800400;
      error.code = 8800400;
      error.traceId = 'trace-id';
      error.payload = {
        status: 8800400,
        code: 8800400,
        message: 'requestBody.param.illegal',
        traceId: 'trace-id',
      };
      throw error;
    },
  });

  const result = await tool.execute({
    title: '巡检指标库',
    category_id: 'category-id',
    category_path: ['自动化运维中心'],
    draft_markdown: '# 用户故事\n![截图](cteam-pasted-image://one)',
    fields: {
      priority: 'CENTRAL',
      version: 'V4.0',
      '3Q3brZUOok': 'YES',
    },
    field_definitions: [
      { id: 'priority', name: 'priority', label: '优先级', type: 'SELECT' },
      { id: 'version', fieldId: 'version-field', name: 'version', label: '版本', type: 'SELECT' },
      { id: '3Q3brZUOok', fieldId: 'compat-field', name: '3Q3brZUOok', label: '是否向下兼容', type: 'RADIO' },
    ],
    images: [{
      placeholder: 'cteam-pasted-image://one',
      alt: '截图',
      contentType: 'image/png',
      bytes: 10,
      localPath: 'C:/tmp/one.png',
    }],
  }, {});

  assert.equal(result.succeeded, false);
  assert.equal(result.dryRun, false);
  assert.match(result.error, /requestBody\.param\.illegal/u);
  assert.equal(result.errorDetails.status, 8800400);
  assert.equal(result.errorDetails.traceId, 'trace-id');
  assert.equal(result.uploadedImages[0].fileId, 'uploaded-file');
  assert.equal(result.retryArgs.title, '巡检指标库');
  assert.equal(result.retryArgs.category_id, 'category-id');
  assert.deepEqual(result.retryArgs.category_path, ['自动化运维中心']);
  assert.equal(result.retryArgs.fields.version, 'V4.0');
  assert.equal(result.retryArgs.images.length, 0);
  assert.match(result.retryArgs.draft_markdown, /\/ms\/vteam\/api\/user\/file\/m68126\/download\/uploaded-file/u);
});
