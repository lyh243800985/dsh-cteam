import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  flattenCategoryTree,
  parseToolArguments,
  selectCategoryNodes,
} from './categories.js';
import {
  PROJECT_ID_PARAMETER_DESCRIPTION,
  PROJECT_PARAMETER_DESCRIPTION,
  booleanOption,
  errorDetails,
  errorMessage,
  safePathPart,
  sessionCwd,
  stringOption,
} from './common.js';
import {
  createAuthenticatedSession,
  DEFAULT_BASE_URL,
  createIssue,
  downloadDemandImages,
  fetchDemandCategoryTree,
  fetchIssueFieldOptions,
  fetchIssueFieldOptionsByName,
  fetchIssueDetailWithComments,
  fetchDemandList,
  fetchIssueFilters,
  fetchIssueList,
  fetchIssueModelProject,
  fetchIssuePreviewFields,
  fetchIssueTemplateDetail,
  fetchIssueTransitionCandidates,
  fetchIssueTransitionFields,
  fetchIssueTransitionNodes,
  fetchWikiDetail,
  fetchWikiLibraryInfo,
  fetchWikiTree,
  fetchQueryFilterFields,
  importWikiMarkdown,
  resolveLoginConfigPath,
  uploadIssueFile,
} from './cteam-client.js';
import {
  buildDemandFilterBody,
  normalizeDemandPage,
  parseDemandToolArguments,
} from './demands.js';
import {
  buildIssueFilterBody,
  normalizeIssueFiltersResult,
  normalizeIssuePage,
  normalizeQueryFilterFields,
  issueSelectType,
  parseIssueListToolArguments,
} from './issues.js';
import {
  extractDemandImages,
  normalizeDemandDetail,
  normalizeDemandComments,
  parseDemandDetailToolArguments,
} from './details.js';
import {
  buildTransitionSubmitExample,
  normalizeFieldOptions,
  normalizeTransitionCandidates,
  normalizeTransitionFields,
  normalizeTransitionNodes,
  parseIssueTransitionToolArguments,
  shouldFetchFieldOptions,
} from './transitions.js';
import {
  buildDemandCreateBody,
  demandUrl,
  markdownToCteamHtml,
  normalizeCreatedIssue,
  extractPastedImagePlaceholders,
  replaceImagePlaceholders,
  selectDemandModel,
  uploadedFileId,
} from './submission.js';
import {
  createPrdAuthoringTool,
} from './prd-authoring.js';
import { resolveDefaultProjectId } from './project-config.js';
import {
  flattenWikiTree,
  getLastWikiImportTarget,
  normalizeWikiDetail,
  parseWikiDetailToolArguments,
  parseWikiImportToolArguments,
  parseWikiTreeToolArguments,
  saveLastWikiImportTarget,
  selectWikiNodes,
  wikiImportTargetFromNode,
  wikiConsoleUrl,
} from './wiki.js';

export const name = 'dsh-cteam';
export const inject = ['tools', 'skills', 'userQuestions'];

const CTEAM_DETAIL_PRESENTATION_MARKER = 'dsh-cteam-detail-v1:';
const CTEAM_SUBMISSION_PRESENTATION_MARKER = 'dsh-cteam-submission-v1:';
const CTEAM_WIKI_DETAIL_PRESENTATION_MARKER = 'dsh-cteam-wiki-detail-v1:';
const CTEAM_FORM_INTENT_KIND = 'cteam-form';
const CTEAM_WIKI_IMPORT_FORM_INTENT_KIND = 'cteam-wiki-import-form';
const DEFAULT_SUBMISSION_OPTION_LIMIT = 80;
const OPTION_BACKED_SUBMISSION_FIELD_TYPES = new Set([
  'CHECKBOX',
  'MULTI_SELECT',
  'RADIO',
  'SELECT',
  'USER',
]);
const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUNDLED_SKILL_FILES = [
  path.join(PLUGIN_ROOT, 'skills', 'cteam-prd-authoring', 'SKILL.md'),
  path.join(PLUGIN_ROOT, 'skills', 'cteam-prd-submit', 'SKILL.md'),
  path.join(PLUGIN_ROOT, 'skills', 'cteam-wiki', 'SKILL.md'),
  path.join(PLUGIN_ROOT, 'skills', 'cteam-wiki-submit', 'SKILL.md'),
];

function parseFrontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  if (!match) return undefined;
  return match[1].replace(/^['"]|['"]$/g, '');
}

function loadBundledSkill(skillPath) {
  const source = fs.readFileSync(skillPath, 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Invalid bundled skill frontmatter: ${skillPath}`);
  const [, frontmatter, content] = match;
  const skill = {
    name: parseFrontmatterValue(frontmatter, 'name'),
    description: parseFrontmatterValue(frontmatter, 'description'),
    content: content.trim(),
    source: 'bundled',
    provider: 'dsh-cteam',
    path: skillPath,
    resourceBase: {
      kind: 'directory',
      path: path.dirname(skillPath),
    },
  };
  if (!skill.name || !skill.description) {
    throw new Error(`Bundled skill requires name and description: ${skillPath}`);
  }
  return skill;
}

function registerBundledSkills(ctx) {
  for (const skillPath of BUNDLED_SKILL_FILES) {
    ctx.skills.register(loadBundledSkill(skillPath));
  }
}

function detailPresentationMeta(args, value) {
  const sourceUrl = args.demand_url ?? args.issue_url;
  return {
    ...value,
    ...(typeof sourceUrl === 'string' && sourceUrl.trim() ? { sourceUrl } : {}),
  };
}

function presentDetailResult(_args, result) {
  if (result.isError || result.meta === undefined) return undefined;
  const issue = result.meta.demand ?? result.meta.issue;
  return {
    card: 'generic',
    title: issue?.title || 'CTeam work item',
    content: [{
      type: 'text',
      text: `${CTEAM_DETAIL_PRESENTATION_MARKER}${JSON.stringify(result.meta)}`,
    }],
  };
}

const nodeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    parentId: { type: 'string', required: true },
    name: { type: 'string', required: true },
    count: { type: 'integer', required: true },
    sort: { type: 'number', required: true },
    depth: { type: 'integer', required: true },
    childCount: { type: 'integer', required: true },
    path: {
      type: 'array',
      required: true,
      items: { type: 'string' },
    },
  },
};

export function normalizeSubmissionOperation(value) {
  const operation = typeof value === 'string' && value.trim()
    ? value.trim().toLocaleLowerCase()
    : 'create';
  if (operation === 'add') return 'create';
  if (operation === 'update') return 'edit';
  return operation;
}

export function defaultDemandCreateSubmissionFields() {
  return [
    {
      id: 'priority',
      name: 'priority',
      label: '优先级',
      type: 'SELECT',
      required: false,
      optionLookupKey: 'priority',
      optionLookupMode: 'option',
      placeholder: '请选择优先级',
      defaultValue: 'CENTRAL',
    },
    {
      id: 'parent_demand',
      name: 'parent_demand',
      label: '父需求',
      type: 'TEXT',
      required: false,
      optionLookupKey: '',
      placeholder: '可填父需求编号或 ID',
    },
    {
      id: '3Q3brZUOok',
      fieldId: 'de3782cdccb5490fae66506b5f36d1f4',
      name: '3Q3brZUOok',
      label: '是否向下兼容',
      type: 'RADIO',
      required: true,
      optionLookupKey: '3Q3brZUOok',
      optionLookupMode: 'by_name',
      placeholder: '请选择是否向下兼容',
    },
    {
      id: 'version',
      fieldId: 'e0ece899e6254e8a96e97f1732f7a0ce',
      name: 'version',
      label: '版本',
      type: 'SELECT',
      required: true,
      optionLookupKey: 'version',
      optionLookupMode: 'by_name',
      placeholder: '请选择版本',
    },
    {
      id: 'iteration',
      fieldId: '4cafe1540c264a7c98fecb2cc9889ce5',
      name: 'iteration',
      label: '迭代',
      type: 'SELECT',
      required: false,
      optionLookupKey: 'iteration',
      optionLookupMode: 'by_name',
      placeholder: '请选择迭代',
    },
    {
      id: 'operator_user',
      fieldId: 'bbc31f38504142708ce77f3722b8dcb5',
      name: 'operator_user',
      label: '经办人',
      type: 'USER',
      required: false,
      optionLookupKey: 'operator_user',
      optionLookupMode: 'by_name',
      placeholder: '搜索经办人',
    },
    {
      id: 'developers',
      fieldId: '4501',
      name: 'developers',
      label: '开发人员',
      type: 'USER',
      required: false,
      multiple: true,
      optionLookupKey: 'developers',
      optionLookupMode: 'by_name',
      placeholder: '搜索开发人员',
    },
  ];
}

export function normalizeSubmissionFields(fields) {
  if (fields === undefined) return [];
  if (!Array.isArray(fields)) throw new Error('fields must be an array');
  return fields.map((field, index) => {
    if (typeof field !== 'object' || field === null || Array.isArray(field)) {
      throw new Error(`fields[${index}] must be an object`);
    }
    const id = typeof field.id === 'string' && field.id.trim() ? field.id.trim() : undefined;
    if (id === undefined) throw new Error(`fields[${index}].id is required`);
    const name = typeof field.name === 'string' && field.name.trim() ? field.name.trim() : id;
    const fieldId = typeof field.fieldId === 'string' && field.fieldId.trim()
      ? field.fieldId.trim()
      : typeof field.field_id === 'string' && field.field_id.trim()
        ? field.field_id.trim()
        : undefined;
    const label = typeof field.label === 'string' && field.label.trim() ? field.label.trim() : id;
    const type = typeof field.type === 'string' && field.type.trim() ? field.type.trim() : 'text';
    const optionLookupKey = typeof field.optionLookupKey === 'string' && field.optionLookupKey.trim()
      ? field.optionLookupKey.trim()
      : typeof field.option_lookup_key === 'string' && field.option_lookup_key.trim()
        ? field.option_lookup_key.trim()
        : typeof field.name === 'string' && field.name.trim()
          ? field.name.trim()
          : id;
    const optionLookupMode = typeof field.optionLookupMode === 'string' && field.optionLookupMode.trim()
      ? field.optionLookupMode.trim().toLocaleLowerCase()
      : typeof field.option_lookup_mode === 'string' && field.option_lookup_mode.trim()
        ? field.option_lookup_mode.trim().toLocaleLowerCase()
        : 'option';
    const options = Array.isArray(field.options) ? field.options.map((option, optionIndex) => {
      if (typeof option !== 'object' || option === null || Array.isArray(option)) {
        throw new Error(`fields[${index}].options[${optionIndex}] must be an object`);
      }
      const value = typeof option.value === 'string' ? option.value : String(option.value ?? '');
      if (!value) throw new Error(`fields[${index}].options[${optionIndex}].value is required`);
      const optionLabel = typeof option.label === 'string' && option.label.trim() ? option.label.trim() : value;
      return {
        value,
        label: optionLabel,
        ...(typeof option.description === 'string' ? { description: option.description } : {}),
      };
    }) : [];
    return {
      id,
      name,
      ...(fieldId !== undefined ? { fieldId } : {}),
      label,
      type,
      required: field.required === true,
      multiple: field.multiple === true,
      options,
      optionLookupKey,
      optionLookupMode: optionLookupMode === 'by_name' ? 'by_name' : 'option',
      ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
      ...(field.default_value !== undefined && field.defaultValue === undefined ? { defaultValue: field.default_value } : {}),
      ...(typeof field.placeholder === 'string' ? { placeholder: field.placeholder } : {}),
      ...(typeof field.optionLoadError === 'string' ? { optionLoadError: field.optionLoadError } : {}),
      ...(field.optionsTruncated === true ? { optionsTruncated: true } : {}),
      ...(Number.isInteger(field.optionTotal) ? { optionTotal: field.optionTotal } : {}),
      ...(Number.isFinite(field.sort) ? { sort: field.sort } : {}),
      ...(typeof field.defaultVisible === 'boolean' ? { defaultVisible: field.defaultVisible } : {}),
      ...(typeof field.source === 'string' && field.source.trim() ? { source: field.source.trim() } : {}),
    };
  });
}

export function submissionFieldsForOperation(operation, fields) {
  const normalized = normalizeSubmissionFields(fields);
  if (normalized.length > 0 || operation !== 'create') return normalized;
  return normalizeSubmissionFields(defaultDemandCreateSubmissionFields());
}

const EXCLUDED_CREATE_PREVIEW_FIELD_NAMES = new Set([
  'createUser',
  'createTime',
  'status',
]);

const BASE_CREATE_FIELD_NAMES_WITHOUT_TEMPLATE = new Set([
  'priority',
  'parent_demand',
  '3Q3brZUOok',
  'version',
  'iteration',
  'operator_user',
  'developers',
]);

const BASE_CREATE_FIELD_NAMES_WITH_TEMPLATE = new Set([
  'priority',
]);

const MULTIPLE_TEMPLATE_FIELD_NAMES = new Set([
  'operator_user',
  'developers',
]);

function optionLookupModeForPreviewField() {
  return 'by_name';
}

function templateFieldMultiple(rawField, name) {
  const type = String(rawField.type ?? '').toLocaleUpperCase();
  return rawField.multiple === true
    || type === 'CHECKBOX'
    || type === 'MULTI_SELECT'
    || type === 'MULTISELECT'
    || MULTIPLE_TEMPLATE_FIELD_NAMES.has(name);
}

function templateFieldToSubmissionField(rawField, sort) {
  const name = typeof rawField.name === 'string' && rawField.name.trim() ? rawField.name.trim() : '';
  const fieldId = typeof rawField.fieldId === 'string' && rawField.fieldId.trim()
    ? rawField.fieldId.trim()
    : typeof rawField.id === 'string' && rawField.id.trim()
      ? rawField.id.trim()
      : '';
  if (!name || !fieldId || EXCLUDED_CREATE_PREVIEW_FIELD_NAMES.has(name)) return null;
  return {
    id: name,
    fieldId,
    name,
    label: typeof rawField.label === 'string' && rawField.label.trim() ? rawField.label.trim() : name,
    type: typeof rawField.type === 'string' && rawField.type.trim() ? rawField.type.trim() : 'TEXT',
    required: rawField.required === true,
    multiple: templateFieldMultiple(rawField, name),
    optionLookupKey: name,
    optionLookupMode: optionLookupModeForPreviewField(rawField),
    sort,
    defaultVisible: true,
    source: 'template',
    ...(rawField.default !== undefined && rawField.default !== '' ? { defaultValue: rawField.default } : {}),
  };
}

export function mergeSubmissionFieldsWithTemplateFields(baseFields, templateFields) {
  const byName = new Map();
  const merged = [];

  const add = (field) => {
    const normalized = normalizeSubmissionFields([field])[0];
    merged.push(normalized);
    byName.set(normalized.name, normalized);
    return normalized;
  };

  for (const field of baseFields) {
    if (!BASE_CREATE_FIELD_NAMES_WITH_TEMPLATE.has(field.name)) continue;
    add({
      ...field,
      sort: Number.isFinite(field.sort) ? field.sort : 0,
      defaultVisible: true,
      source: field.source ?? 'base',
    });
  }

  for (const [index, rawField] of (Array.isArray(templateFields) ? templateFields : []).entries()) {
    if (typeof rawField !== 'object' || rawField === null || Array.isArray(rawField)) continue;
    const templateField = templateFieldToSubmissionField(rawField, index + 10);
    if (templateField === null) continue;
    const existing = byName.get(templateField.name);
    if (existing) {
      Object.assign(existing, {
        fieldId: templateField.fieldId,
        label: templateField.label,
        type: templateField.type,
        required: templateField.required,
        multiple: templateField.multiple,
        optionLookupKey: templateField.optionLookupKey,
        optionLookupMode: templateField.optionLookupMode,
        sort: templateField.sort,
        defaultVisible: true,
        source: templateField.source,
        ...(templateField.defaultValue !== undefined ? { defaultValue: templateField.defaultValue } : {}),
      });
      continue;
    }
    add(templateField);
  }

  return merged.sort((left, right) => {
    if ((left.sort ?? Number.MAX_SAFE_INTEGER) !== (right.sort ?? Number.MAX_SAFE_INTEGER)) {
      return (left.sort ?? Number.MAX_SAFE_INTEGER) - (right.sort ?? Number.MAX_SAFE_INTEGER);
    }
    return left.label.localeCompare(right.label, 'zh-Hans-CN');
  });
}

export function mergeSubmissionFieldsWithPreviewFields(baseFields, previewFields) {
  const byName = new Map();
  const byId = new Map();
  const merged = [];

  const add = (field) => {
    const normalized = normalizeSubmissionFields([field])[0];
    merged.push(normalized);
    byName.set(normalized.name, normalized);
    byId.set(normalized.id, normalized);
    if (normalized.fieldId) byId.set(normalized.fieldId, normalized);
    return normalized;
  };

  for (const field of baseFields) {
    add({
      ...field,
      defaultVisible: BASE_CREATE_FIELD_NAMES_WITHOUT_TEMPLATE.has(field.name),
      source: field.source ?? 'base',
    });
  }

  for (const rawField of Array.isArray(previewFields) ? previewFields : []) {
    if (typeof rawField !== 'object' || rawField === null || Array.isArray(rawField)) continue;
    const name = typeof rawField.name === 'string' && rawField.name.trim() ? rawField.name.trim() : '';
    const id = typeof rawField.id === 'string' && rawField.id.trim() ? rawField.id.trim() : '';
    if (!name || !id || EXCLUDED_CREATE_PREVIEW_FIELD_NAMES.has(name)) continue;
    const existing = byName.get(name) ?? byId.get(id);
    const preview = {
      id: name,
      fieldId: id,
      name,
      label: typeof rawField.label === 'string' && rawField.label.trim() ? rawField.label.trim() : name,
      type: typeof rawField.type === 'string' && rawField.type.trim() ? rawField.type.trim() : 'TEXT',
      required: rawField.required === true,
      multiple: rawField.multiple === true || String(rawField.type ?? '').toLocaleUpperCase() === 'CHECKBOX',
      optionLookupKey: name,
      optionLookupMode: optionLookupModeForPreviewField(rawField),
      sort: Number.isFinite(rawField.sort) ? rawField.sort : Number.MAX_SAFE_INTEGER,
      defaultVisible: rawField.required === true || BASE_CREATE_FIELD_NAMES_WITHOUT_TEMPLATE.has(name),
      source: 'preview',
    };
    if (existing) {
      Object.assign(existing, {
        fieldId: existing.fieldId ?? preview.fieldId,
        label: existing.label || preview.label,
        type: existing.type || preview.type,
        required: existing.required || preview.required,
        multiple: existing.multiple || preview.multiple,
        optionLookupKey: existing.optionLookupKey || preview.optionLookupKey,
        optionLookupMode: existing.optionLookupMode || preview.optionLookupMode,
        sort: existing.sort ?? preview.sort,
        defaultVisible: existing.defaultVisible === true || preview.defaultVisible === true,
        source: existing.source ?? preview.source,
      });
      continue;
    }
    add(preview);
  }

  return merged.sort((left, right) => {
    if (left.required !== right.required) return left.required ? -1 : 1;
    return (left.sort ?? Number.MAX_SAFE_INTEGER) - (right.sort ?? Number.MAX_SAFE_INTEGER);
  });
}

function submissionFieldNeedsOptions(field) {
  if (field.options.length > 0) return false;
  return OPTION_BACKED_SUBMISSION_FIELD_TYPES.has(String(field.type).toLocaleUpperCase())
    && typeof field.optionLookupKey === 'string'
    && field.optionLookupKey.trim() !== '';
}

export function toSubmissionFormOptions(data, limit) {
  const normalized = normalizeFieldOptions(data, limit);
  return {
    options: normalized.options.map((option) => ({
      value: option.value,
      label: option.displayValue || option.value,
    })),
    truncated: normalized.truncated,
    total: normalized.total,
  };
}

async function enrichSubmissionFieldsWithOptions(fields, options) {
  const limit = options.optionLimit ?? DEFAULT_SUBMISSION_OPTION_LIMIT;
  const optionCache = new Map();
  return Promise.all(fields.map(async (field) => {
    if (!submissionFieldNeedsOptions(field)) return field;
    try {
      const lookupMode = field.optionLookupMode === 'by_name' ? 'by_name' : 'option';
      const cacheKey = `${lookupMode}:${field.optionLookupKey}`;
      if (!optionCache.has(cacheKey)) {
        const fetchOptions = lookupMode === 'by_name' ? fetchIssueFieldOptionsByName : fetchIssueFieldOptions;
        optionCache.set(cacheKey, fetchOptions({
          ...options,
          fieldIdOrName: field.optionLookupKey,
        }));
      }
      const optionData = await optionCache.get(cacheKey);
      const formOptions = toSubmissionFormOptions(optionData, limit);
      return {
        ...field,
        options: formOptions.options,
        optionsTruncated: formOptions.truncated,
        optionTotal: formOptions.total,
      };
    } catch (error) {
      return {
        ...field,
        optionLoadError: error instanceof Error ? error.message : String(error),
      };
    }
  }));
}

function parseSubmissionAnswer(answer) {
  const item = answer.answers.find((entry) => entry.id === 'cteam_submission');
  if (item === undefined || typeof item.custom !== 'string' || !item.custom.trim()) {
    throw new Error('CTeam submission form returned no structured payload');
  }
  const parsed = JSON.parse(item.custom);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('CTeam submission form payload must be an object');
  }
  return parsed;
}

function parseWikiImportAnswer(answer) {
  const item = answer.answers.find((entry) => entry.id === 'cteam_wiki_import');
  if (item === undefined || typeof item.custom !== 'string' || !item.custom.trim()) {
    throw new Error('CTeam wiki import form returned no structured payload');
  }
  const parsed = JSON.parse(item.custom);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('CTeam wiki import form payload must be an object');
  }
  return parsed;
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl);
  if (match === null) throw new Error('unsupported pasted image data URL');
  return {
    contentType: match[1] || 'application/octet-stream',
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function extensionForContentType(contentType) {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/gif') return '.gif';
  if (contentType === 'image/webp') return '.webp';
  return '.bin';
}

async function persistPastedImages(images, exec) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const outputDir = path.join(
    sessionCwd(exec) ?? process.cwd(),
    '.temp',
    'dsh-cteam',
    'authoring',
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await fs.promises.mkdir(outputDir, { recursive: true });
  const saved = [];
  for (const [index, image] of images.entries()) {
    if (typeof image !== 'object' || image === null || Array.isArray(image)) continue;
    const placeholder = typeof image.url === 'string' ? image.url : '';
    const dataUrl = typeof image.dataUrl === 'string' ? image.dataUrl : '';
    if (!placeholder || !dataUrl) continue;
    const parsed = parseDataUrl(dataUrl);
    const filename = `${String(index + 1).padStart(2, '0')}-${safePathPart(placeholder.replace(/^cteam-pasted-image:\/\//u, ''), `image-${index + 1}`)}${extensionForContentType(parsed.contentType)}`;
    const localPath = path.join(outputDir, filename);
    await fs.promises.writeFile(localPath, parsed.buffer);
    saved.push({
      placeholder,
      alt: typeof image.alt === 'string' ? image.alt : '',
      contentType: parsed.contentType,
      bytes: parsed.buffer.length,
      localPath,
    });
  }
  return saved;
}

function renderSubmissionConfirmation(value) {
  const lines = [
    `CTeam ${value.operation} submission confirmed for project ${value.projectId}`,
    `title=${value.title}`,
    `category=${value.categoryPath.join(' / ')} | id=${value.categoryId}`,
    `fields=${Object.keys(value.fields).length}, images=${value.images.length}`,
    '',
    'The returned draft_markdown still contains local pasted-image placeholders. Upload images before final CTeam write and replace placeholders with /ms/vteam/api/user/file/{projectId}/download/{fileId}.',
  ];
  return lines.join('\n');
}

async function askPrdSubmissionConfirmation(args, exec, config = {}) {
  const input = parseToolArguments(args, {
    configuredProjectId: resolveDefaultProjectId(config, exec),
  });
  const operation = normalizeSubmissionOperation(args.operation);
  const loginConfigPath = resolveLoginConfigPath(
    config.loginConfigPath,
    sessionCwd(exec),
  );
  const baseOptions = {
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    loginConfigPath,
    projectId: input.projectId,
    timeoutMs: config.requestTimeoutMs ?? 20_000,
    signal: exec.signal,
  };
  const fetchIssueModelProjectFn = config.fetchIssueModelProject ?? fetchIssueModelProject;
  const fetchIssueTemplateDetailFn = config.fetchIssueTemplateDetail ?? fetchIssueTemplateDetail;
  const [tree, modelData] = await Promise.all([
    fetchDemandCategoryTree(baseOptions),
    fetchIssueModelProjectFn(baseOptions),
  ]);
  const model = selectDemandModel(modelData, {
    modelTypeId: stringOption(args.model_type_id, 'model_type_id'),
    typeId: stringOption(args.type_id, 'type_id'),
    typeName: stringOption(args.type_name, 'type_name'),
    templateId: stringOption(args.template_id, 'template_id'),
  });
  let submissionFields = submissionFieldsForOperation(operation, args.fields);
  if (operation === 'create' && !Array.isArray(args.fields)) {
    try {
      const templateDetail = await fetchIssueTemplateDetailFn({
        ...baseOptions,
        templateId: model.templateId,
        tenantId: modelData?.issueModel?.tenantId,
      });
      submissionFields = mergeSubmissionFieldsWithTemplateFields(submissionFields, templateDetail?.bind);
    } catch (templateError) {
      try {
        const previewFields = await fetchIssuePreviewFields({
          ...baseOptions,
          classify: 'DEMAND',
        });
        submissionFields = mergeSubmissionFieldsWithPreviewFields(submissionFields, previewFields);
      } catch (previewError) {
        submissionFields = submissionFields.map((field) => ({
          ...field,
          ...(field.optionLoadError === undefined
            ? { optionLoadError: `需求模板字段加载失败：${templateError instanceof Error ? templateError.message : String(templateError)}；字段预览加载失败：${previewError instanceof Error ? previewError.message : String(previewError)}` }
            : {}),
        }));
      }
    }
  }
  const enrichedFields = await enrichSubmissionFieldsWithOptions(submissionFields, {
    ...baseOptions,
    issueType: 'DEMAND',
    optionLimit: Number.isInteger(args.option_limit) && args.option_limit > 0
      ? Math.min(args.option_limit, 500)
      : DEFAULT_SUBMISSION_OPTION_LIMIT,
  });
  const categories = flattenCategoryTree(tree);
  const detail = JSON.stringify({
    version: 1,
    kind: CTEAM_FORM_INTENT_KIND,
    projectId: input.projectId,
    title: typeof args.title === 'string' ? args.title : '',
    operation,
    model,
    summary: typeof args.summary === 'string' ? args.summary : '',
    categories,
    fields: enrichedFields,
  });
  if (config.userQuestions === undefined) {
    throw new Error('cteam_confirm_prd_submission requires the userQuestions service');
  }
  const answer = await config.userQuestions.ask({
    questions: [{
      id: 'cteam_submission',
      header: 'CTeam 提交确认',
      question: '确认 PRD 草稿并补全 CTeam 必填字段',
      detail,
      options: [
        { label: '提交', description: '确认表单内容，返回给工具继续上传/创建。' },
        { label: '取消', description: '放弃本次提交确认。' },
      ],
    }],
    ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
    signal: exec.signal,
  });
  const payload = parseSubmissionAnswer(answer);
  const images = await persistPastedImages(payload.images, exec);
  return {
    projectId: input.projectId,
    operation: typeof payload.operation === 'string' ? payload.operation : 'create',
    title: typeof payload.title === 'string' && payload.title ? payload.title : (typeof args.title === 'string' ? args.title : ''),
    categoryId: typeof payload.categoryId === 'string' ? payload.categoryId : '',
    categoryPath: Array.isArray(payload.categoryPath) ? payload.categoryPath.map(String) : [],
    draftMarkdown: typeof payload.markdown === 'string' ? payload.markdown : '',
    fields: typeof payload.fields === 'object' && payload.fields !== null && !Array.isArray(payload.fields) ? payload.fields : {},
    fieldDefinitions: enrichedFields,
    images,
  };
}

export function createPrdSubmissionConfirmTool(config = {}) {
  return defineTool({
    name: 'cteam_confirm_prd_submission',
    description: 'Open a CTeam PRD submission confirmation form in the conversation. It reads the current dsh-cteam PRD authoring workspace from the browser, asks for a cascaded demand category and required fields with searchable selects/multi-selects, and returns the confirmed draft plus form values. This tool never writes to CTeam and must not be used as the final action when the user asks to upload/create; call cteam_submit_prd_demand or cteam_create_demand_from_submission for the actual create step.',
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
        description: 'Submission title shown in the confirmation form. Defaults to the current authoring title when the browser has one.',
      },
      operation: {
        type: 'string',
        description: 'Intended CTeam operation: create, edit, comment, or transition. Defaults to create.',
      },
      summary: {
        type: 'string',
        description: 'Markdown summary of what will be submitted; shown above the form.',
      },
      fields: {
        type: 'array',
        description: 'Additional required/editable CTeam fields to collect. Option-backed fields render as searchable selects; multiple=true renders searchable multi-select.',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string', required: true },
            name: { type: 'string' },
            fieldId: { type: 'string' },
            label: { type: 'string', required: true },
            type: { type: 'string' },
            required: { type: 'boolean' },
            multiple: { type: 'boolean' },
            placeholder: { type: 'string' },
            optionLookupKey: { type: 'string' },
            optionLookupMode: { type: 'string' },
            defaultValue: { type: 'string' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  value: { type: 'string', required: true },
                  label: { type: 'string', required: true },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
      },
      option_limit: {
        type: 'integer',
        description: 'Maximum option values to prefetch for each option-backed field. Defaults to 80.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          projectId: { type: 'string', required: true },
          operation: { type: 'string', required: true },
          title: { type: 'string', required: true },
          categoryId: { type: 'string', required: true },
          categoryPath: {
            type: 'array',
            required: true,
            items: { type: 'string' },
          },
          draftMarkdown: { type: 'string', required: true },
          fields: {
            type: 'object',
            required: true,
            additionalProperties: true,
            properties: {},
          },
          fieldDefinitions: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {},
            },
          },
          images: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                placeholder: { type: 'string', required: true },
                alt: { type: 'string', required: true },
                contentType: { type: 'string', required: true },
                bytes: { type: 'integer', required: true },
                localPath: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderSubmissionConfirmation(value) }],
    },
    timeoutMs: config.timeoutMs ?? 300_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return askPrdSubmissionConfirmation(args, exec, config);
    },
  });
}

function buildSubmissionRetryArgs(projectId, submission, args, markdown, images = []) {
  return {
    project_id: projectId,
    title: submission.title,
    category_id: submission.categoryId,
    category_path: submission.categoryPath,
    draft_markdown: markdown,
    fields: submission.fields,
    field_definitions: submission.fieldDefinitions,
    images,
    ...(stringOption(args.model_type_id, 'model_type_id') !== undefined ? { model_type_id: stringOption(args.model_type_id, 'model_type_id') } : {}),
    ...(stringOption(args.type_id, 'type_id') !== undefined ? { type_id: stringOption(args.type_id, 'type_id') } : {}),
    ...(stringOption(args.type_name, 'type_name') !== undefined ? { type_name: stringOption(args.type_name, 'type_name') } : {}),
    ...(stringOption(args.template_id, 'template_id') !== undefined ? { template_id: stringOption(args.template_id, 'template_id') } : {}),
  };
}

async function createDemandFromSubmissionPayload(submission, args, exec, config = {}) {
  const projectId = stringOption(submission.projectId, 'projectId') ?? stringOption(args.project_id, 'project_id') ?? resolveDefaultProjectId(config, exec);
  if (!projectId) throw new Error('projectId is required');
  const loginConfigPath = resolveLoginConfigPath(
    config.loginConfigPath,
    sessionCwd(exec),
  );
  const baseOptions = {
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    loginConfigPath,
    projectId,
    issueType: 'DEMAND',
    timeoutMs: config.requestTimeoutMs ?? 20_000,
    signal: exec.signal,
  };
  const dryRun = booleanOption(args.dry_run, false);
  const createAuthenticatedSessionFn = config.createAuthenticatedSession ?? createAuthenticatedSession;
  const fetchIssueModelProjectFn = config.fetchIssueModelProject ?? fetchIssueModelProject;
  const uploadIssueFileFn = config.uploadIssueFile ?? uploadIssueFile;
  const createIssueFn = config.createIssue ?? createIssue;
  const session = await createAuthenticatedSessionFn(baseOptions);
  const modelData = await fetchIssueModelProjectFn({ ...baseOptions, session });
  const model = selectDemandModel(modelData, {
    modelTypeId: stringOption(args.model_type_id, 'model_type_id'),
    typeId: stringOption(args.type_id, 'type_id'),
    typeName: stringOption(args.type_name, 'type_name'),
    templateId: stringOption(args.template_id, 'template_id'),
  });
  const uploadedImages = [];

  if (!dryRun) {
    for (const image of Array.isArray(submission.images) ? submission.images : []) {
      if (typeof image !== 'object' || image === null || Array.isArray(image)) continue;
      if (typeof image.localPath !== 'string' || !image.localPath) continue;
      const uploadResult = await uploadIssueFileFn({
        ...baseOptions,
        session,
        filePath: image.localPath,
        filename: path.basename(image.localPath),
        contentType: image.contentType,
      });
      uploadedImages.push({
        ...image,
        uploadResult,
        fileId: uploadedFileId(uploadResult),
      });
    }
  }

  const markdownWithImages = replaceImagePlaceholders(
    submission.draftMarkdown,
    projectId,
    uploadedImages,
  );
  const descHtml = markdownToCteamHtml(markdownWithImages);
  const requestBody = buildDemandCreateBody({
    title: submission.title,
    categoryId: submission.categoryId,
    fields: submission.fields,
    fieldDefinitions: submission.fieldDefinitions,
    model,
    descMarkdown: markdownWithImages,
  });
  const missingImagePlaceholders = extractPastedImagePlaceholders(markdownWithImages);
  if (dryRun) {
    return {
      projectId,
      dryRun: true,
      succeeded: true,
      title: submission.title,
      categoryId: submission.categoryId,
      categoryPath: submission.categoryPath,
      model,
      markdown: markdownWithImages,
      descHtml,
      requestBody,
      uploadedImages,
      issue: {
        id: '',
        number: '',
        title: submission.title,
        raw: {},
      },
      issueUrl: '',
    };
  }

  if (missingImagePlaceholders.length > 0) {
    return {
      projectId,
      dryRun: false,
      succeeded: false,
      error: `pasted image cache missing for ${missingImagePlaceholders.length} image(s); re-paste the images before creating the CTeam demand`,
      errorDetails: {
        missingImagePlaceholders,
      },
      title: submission.title,
      categoryId: submission.categoryId,
      categoryPath: submission.categoryPath,
      model,
      markdown: markdownWithImages,
      descHtml,
      requestBody,
      retryArgs: buildSubmissionRetryArgs(projectId, submission, args, markdownWithImages, []),
      uploadedImages,
      issue: {
        id: '',
        number: '',
        title: submission.title,
        raw: {},
      },
      issueUrl: '',
    };
  }

  let createdData;
  try {
    createdData = await createIssueFn({
      ...baseOptions,
      session,
      tenantId: modelData?.issueModel?.tenantId,
      body: requestBody,
    });
  } catch (error) {
    return {
      projectId,
      dryRun: false,
      succeeded: false,
      error: errorMessage(error),
      errorDetails: errorDetails(error),
      title: submission.title,
      categoryId: submission.categoryId,
      categoryPath: submission.categoryPath,
      model,
      markdown: markdownWithImages,
      descHtml,
      requestBody,
      retryArgs: buildSubmissionRetryArgs(projectId, submission, args, markdownWithImages, []),
      uploadedImages,
      issue: {
        id: '',
        number: '',
        title: submission.title,
        raw: {},
      },
      issueUrl: '',
    };
  }
  const issue = normalizeCreatedIssue(createdData);
  return {
    projectId,
    dryRun: false,
    succeeded: true,
    title: submission.title,
    categoryId: submission.categoryId,
    categoryPath: submission.categoryPath,
    model,
    markdown: markdownWithImages,
    descHtml,
    requestBody,
    uploadedImages,
    issue,
    issueUrl: demandUrl(baseOptions.baseUrl, projectId, issue.id),
  };
}

function renderDemandSubmit(value) {
  const succeeded = value.succeeded !== false;
  const lines = [
    value.dryRun
      ? `CTeam demand create dry run for project ${value.projectId}`
      : succeeded
        ? `CTeam demand created for project ${value.projectId}`
        : `CTeam demand create failed for project ${value.projectId}`,
    `title=${value.title}`,
    `category=${(value.categoryPath ?? []).join(' / ')} | id=${value.categoryId}`,
    `model=${value.model.typeName || value.model.modelTypeId}`,
    `images=${value.uploadedImages.length}`,
  ];
  if (!succeeded) {
    lines.push(
      `error=${value.error}`,
      'If the user wants to retry or correct fields after this failure, call cteam_submit_prd_demand again so the confirmation form opens and the user can review all submission values before confirming. Do not silently retry with chat-corrected values.',
    );
  } else if (!value.dryRun) {
    lines.push(
      `issue=${value.issue.number || value.issue.id}`,
      value.issueUrl,
      '上传成功。可在结果卡片中保存一份 Markdown 副本；不保存也不会影响已创建的 CTeam 需求。',
    );
  }
  return lines.join('\n');
}

function presentSubmissionResult(_args, result) {
  if (result.isError || result.meta === undefined) return undefined;
  return {
    card: 'generic',
    title: result.meta.succeeded === false
      ? 'CTeam 上传失败'
      : result.meta.dryRun
        ? 'CTeam 上传预览'
        : 'CTeam 上传成功',
    content: [{
      type: 'text',
      text: `${CTEAM_SUBMISSION_PRESENTATION_MARKER}${JSON.stringify(result.meta)}`,
    }],
  };
}

const submissionImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    placeholder: { type: 'string' },
    alt: { type: 'string' },
    contentType: { type: 'string' },
    bytes: { type: 'integer' },
    localPath: { type: 'string' },
  },
};

const demandSubmitOutputSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    projectId: { type: 'string', required: true },
    dryRun: { type: 'boolean', required: true },
    succeeded: { type: 'boolean' },
    error: { type: 'string' },
    errorDetails: {
      type: 'object',
      additionalProperties: true,
      properties: {},
    },
    title: { type: 'string', required: true },
    categoryId: { type: 'string', required: true },
    categoryPath: {
      type: 'array',
      required: true,
      items: { type: 'string' },
    },
    markdown: { type: 'string', required: true },
    descHtml: { type: 'string', required: true },
    requestBody: {
      type: 'object',
      required: true,
      additionalProperties: true,
      properties: {},
    },
    uploadedImages: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {},
      },
    },
    retryArgs: {
      type: 'object',
      additionalProperties: true,
      properties: {},
    },
    issueUrl: { type: 'string', required: true },
  },
};

const submissionPayloadParameters = {
  project_id: {
    type: 'string',
    description: PROJECT_ID_PARAMETER_DESCRIPTION,
  },
  title: {
    type: 'string',
    description: 'Confirmed CTeam demand title.',
  },
  category_id: {
    type: 'string',
    description: 'Confirmed demand category id.',
  },
  category_path: {
    type: 'array',
    items: { type: 'string' },
    description: 'Confirmed demand category path.',
  },
  draft_markdown: {
    type: 'string',
    description: 'Confirmed PRD Markdown.',
  },
  fields: {
    type: 'object',
    additionalProperties: true,
    properties: {},
    description: 'Field values returned by cteam_confirm_prd_submission.',
  },
  field_definitions: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: true,
      properties: {},
    },
    description: 'Field definitions returned by cteam_confirm_prd_submission.',
  },
  images: {
    type: 'array',
    items: submissionImageSchema,
    description: 'Persisted pasted images returned by cteam_confirm_prd_submission.',
  },
  model_type_id: {
    type: 'string',
    description: 'Optional CTeam issue model type id. Defaults to the project Story demand model.',
  },
  type_id: {
    type: 'string',
    description: 'Optional CTeam issue type id. Defaults to the project Story demand type.',
  },
  type_name: {
    type: 'string',
    description: 'Optional demand type name. Defaults to Story.',
  },
  template_id: {
    type: 'string',
    description: 'Optional CTeam create-page template id. Defaults to the project Story template.',
  },
  dry_run: {
    type: 'boolean',
    description: 'When true, build and return the upload/create payload without uploading files or creating a demand.',
  },
};

function submissionFromToolArgs(args) {
  return {
    projectId: stringOption(args.project_id, 'project_id') ?? '',
    title: stringOption(args.title, 'title') ?? '',
    categoryId: stringOption(args.category_id, 'category_id') ?? '',
    categoryPath: Array.isArray(args.category_path) ? args.category_path.map(String) : [],
    draftMarkdown: typeof args.draft_markdown === 'string' ? args.draft_markdown : '',
    fields: typeof args.fields === 'object' && args.fields !== null && !Array.isArray(args.fields) ? args.fields : {},
    fieldDefinitions: Array.isArray(args.field_definitions) ? args.field_definitions : [],
    images: Array.isArray(args.images) ? args.images : [],
  };
}

export function createDemandFromSubmissionTool(config = {}) {
  return defineTool({
    name: 'cteam_create_demand_from_submission',
    description: 'Create a CTeam demand from a previously confirmed PRD submission payload. This is a lower-level create helper for payloads that already came from the confirmation form. After a failed create, user-facing retries or chat-provided field corrections should call cteam_submit_prd_demand again so the form reopens and the user can review all submission values before confirming. This tool uploads pasted images, rewrites Markdown image placeholders to CTeam file URLs, converts Markdown to CTeam HTML, and calls the CTeam create issue endpoint. Use dry_run=true only to inspect the payload without writing.',
    parameters: submissionPayloadParameters,
    output: {
      schema: demandSubmitOutputSchema,
      render: (_args, value) => [{ type: 'text', text: renderDemandSubmit(value) }],
      presentationMeta: (_args, value) => value,
    },
    presentResult: presentSubmissionResult,
    timeoutMs: config.timeoutMs ?? 300_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const submission = submissionFromToolArgs(args);
      return createDemandFromSubmissionPayload(submission, args, exec, config);
    },
  });
}

export function createPrdSubmitDemandTool(config = {}) {
  return defineTool({
    name: 'cteam_submit_prd_demand',
    description: 'Confirm the current dsh-cteam PRD authoring workspace in the conversation, then upload pasted images and create a CTeam demand after the user submits the confirmation form. This is the one-step tool to use when the user says the PRD is ready to upload/create, clicks submit/create, asks to retry after a failed create, or provides corrected field values after a failed create. Retrying should reopen the form so the user can review all submission values. Do not replace it with cteam_confirm_prd_submission unless the user explicitly wants form collection only.',
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
        description: 'Submission title shown in the confirmation form.',
      },
      summary: {
        type: 'string',
        description: 'Markdown summary shown above the confirmation form.',
      },
      fields: submissionPayloadParameters.field_definitions,
      option_limit: {
        type: 'integer',
        description: 'Maximum option values to prefetch for each option-backed field. Defaults to 80.',
      },
      model_type_id: submissionPayloadParameters.model_type_id,
      type_id: submissionPayloadParameters.type_id,
      type_name: submissionPayloadParameters.type_name,
      template_id: submissionPayloadParameters.template_id,
      dry_run: {
        type: 'boolean',
        description: 'When true, stop after building the create payload. Defaults to false after user confirmation.',
      },
    },
    output: {
      schema: demandSubmitOutputSchema,
      render: (_args, value) => [{ type: 'text', text: renderDemandSubmit(value) }],
      presentationMeta: (_args, value) => value,
    },
    presentResult: presentSubmissionResult,
    timeoutMs: config.timeoutMs ?? 300_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const submission = await askPrdSubmissionConfirmation({
        ...args,
        operation: 'create',
      }, exec, config);
      return createDemandFromSubmissionPayload(submission, args, exec, config);
    },
  });
}

function renderResult(value) {
  const header = [
    `CTeam demand categories for project ${value.projectId}`,
    `mode=${value.mode}, returned=${value.returnedNodes}, matched=${value.matchedNodes}, total=${value.totalNodes}`,
  ];
  if (value.truncated) header.push('Result truncated; narrow by parent_id/query or increase limit.');
  const lines = value.nodes.map((node) => {
    return `- ${node.path.join(' / ')} | id=${node.id} | count=${node.count} | children=${node.childCount}`;
  });
  return [...header, '', ...lines].join('\n');
}

export function createDemandCategoryTool(config = {}) {
  return defineTool({
    name: 'cteam_list_demand_categories',
    description: 'Read a CTeam project demand classification tree. The project defaults to projectId from the dsh-cteam plugin config or .ops-local/cw-browser-login.json; provide project_url or project_id to select another project. Omit parent_id/query to list roots; use parent_id for children, include_descendants for a subtree, or query to search names and full paths.',
    parameters: {
      project_url: {
        type: 'string',
        description: PROJECT_PARAMETER_DESCRIPTION,
      },
      project_id: {
        type: 'string',
        description: PROJECT_ID_PARAMETER_DESCRIPTION,
      },
      parent_id: {
        type: 'string',
        description: 'Return direct children of this category ID. Set include_descendants=true for the full subtree.',
      },
      query: {
        type: 'string',
        description: 'Case-insensitive search across category names and full paths.',
      },
      include_descendants: {
        type: 'boolean',
        description: 'With parent_id, return all descendants instead of only direct children.',
      },
      limit: {
        type: 'number',
        description: 'Maximum returned nodes, from 1 to 500. Defaults to 200.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          mode: { type: 'string', required: true },
          rootCount: { type: 'integer', required: true },
          totalNodes: { type: 'integer', required: true },
          matchedNodes: { type: 'integer', required: true },
          returnedNodes: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          nodes: {
            type: 'array',
            required: true,
            items: nodeSchema,
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
    },
    timeoutMs: config.timeoutMs ?? 30_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseToolArguments(args, {
        configuredProjectId: resolveDefaultProjectId(config, exec),
      });
      const loginConfigPath = resolveLoginConfigPath(
        config.loginConfigPath,
        sessionCwd(exec),
      );
      const tree = await fetchDemandCategoryTree({
        baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
        loginConfigPath,
        projectId: input.projectId,
        timeoutMs: config.requestTimeoutMs ?? 20_000,
        signal: exec.signal,
      });
      const allNodes = flattenCategoryTree(tree);
      const selected = selectCategoryNodes(allNodes, input);
      return {
        projectId: input.projectId,
        mode: selected.mode,
        rootCount: allNodes.filter((node) => node.depth === 0).length,
        totalNodes: allNodes.length,
        matchedNodes: selected.matchedNodes,
        returnedNodes: selected.nodes.length,
        truncated: selected.truncated,
        nodes: selected.nodes,
      };
    },
  });
}

const demandSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    number: { type: 'string', required: true },
    title: { type: 'string', required: true },
    priority: { type: 'string', required: true },
    priorityName: { type: 'string', required: true },
    stateId: { type: 'string', required: true },
    stateName: { type: 'string', required: true },
    modelTypeId: { type: 'string', required: true },
    modelTypeName: { type: 'string', required: true },
    typeClassify: { type: 'string', required: true },
    parentId: { type: 'string', required: true },
    typeLogo: { type: 'string', required: true },
    typeColor: { type: 'string', required: true },
    follow: { type: 'boolean', required: true },
    finished: { type: 'boolean', required: true },
    expired: { type: 'boolean', required: true },
    dispatch: { type: 'string', required: true },
    dispatchName: { type: 'string', required: true },
    fields: {
      type: 'object',
      required: true,
      additionalProperties: true,
      properties: {},
    },
  },
};

function renderDemandList(value) {
  const lines = [
    `CTeam demands for project ${value.projectId}`,
    `page=${value.page}/${value.totalPages}, returned=${value.demands.length}, total=${value.totalElements}`,
  ];
  if (value.categoryId) lines.push(`category_id=${value.categoryId}`);
  lines.push('');
  if (value.demands.length === 0) lines.push('(no demands)');
  for (const demand of value.demands) {
    const status = demand.stateName || demand.stateId || 'unknown state';
    const priority = demand.priorityName || demand.priority || 'unknown priority';
    lines.push(`- ${demand.number} [${status}] ${demand.title} | priority=${priority} | id=${demand.id}`);
  }
  return lines.join('\n');
}

export function createDemandListTool(config = {}) {
  return defineTool({
    name: 'cteam_list_demands',
    description: 'List CTeam demands with pagination and field filters. The project defaults to projectId from the dsh-cteam plugin config or .ops-local/cw-browser-login.json; provide project_url or project_id to select another project. category_id is the primary version/classification filter and should come from cteam_list_demand_categories.',
    parameters: {
      project_url: {
        type: 'string',
        description: PROJECT_PARAMETER_DESCRIPTION,
      },
      project_id: {
        type: 'string',
        description: PROJECT_ID_PARAMETER_DESCRIPTION,
      },
      category_id: {
        type: 'string',
        description: 'Demand category/version node ID from cteam_list_demand_categories.',
      },
      filters: {
        type: 'array',
        description: 'Additional CTeam query filters, for example priority, state, status, createUser, createTime, label, dispatch_project, dispatch, version, or modelTypeId.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            value: {
              type: 'array',
              required: true,
              items: {
                oneOf: [
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'boolean' },
                ],
              },
            },
          },
        },
      },
      page: {
        type: 'number',
        description: 'One-based page number. Defaults to 1.',
      },
      page_size: {
        type: 'number',
        description: 'Rows per page, from 1 to 200. Defaults to 20.',
      },
      remember: {
        type: 'boolean',
        description: 'Whether CTeam may remember these filters for the user. Defaults to false.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          categoryId: { type: 'string', required: true },
          page: { type: 'integer', required: true },
          pageSize: { type: 'integer', required: true },
          totalElements: { type: 'integer', required: true },
          totalPages: { type: 'integer', required: true },
          first: { type: 'boolean', required: true },
          last: { type: 'boolean', required: true },
          demands: {
            type: 'array',
            required: true,
            items: demandSchema,
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderDemandList(value) }],
    },
    timeoutMs: config.timeoutMs ?? 30_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseDemandToolArguments(args, {
        configuredProjectId: resolveDefaultProjectId(config, exec),
      });
      const loginConfigPath = resolveLoginConfigPath(
        config.loginConfigPath,
        sessionCwd(exec),
      );
      const data = await fetchDemandList({
        baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
        loginConfigPath,
        projectId: input.projectId,
        page: input.page,
        pageSize: input.pageSize,
        remember: input.remember,
        filters: buildDemandFilterBody(input),
        timeoutMs: config.requestTimeoutMs ?? 20_000,
        signal: exec.signal,
      });
      return {
        projectId: input.projectId,
        categoryId: input.categoryId ?? '',
        ...normalizeDemandPage(data),
      };
    },
  });
}

function renderIssueList(value) {
  const lines = [
    `CTeam ${value.issueType.toLocaleLowerCase()} issues for project ${value.projectId}`,
    `page=${value.page}/${value.totalPages}, returned=${value.issues.length}, total=${value.totalElements}`,
  ];
  lines.push('');
  if (value.issues.length === 0) lines.push('(no issues)');
  for (const issue of value.issues) {
    const status = issue.stateName || issue.stateId || 'unknown state';
    const priority = issue.priorityName || issue.priority || 'unknown priority';
    lines.push(`- ${issue.number} [${status}] ${issue.title} | priority=${priority} | id=${issue.id}`);
  }
  return lines.join('\n');
}

export function createBugListTool(config = {}) {
  return defineTool({
    name: 'cteam_list_bugs',
    description: 'List CTeam bug/defect issues with pagination and field filters. The project defaults to projectId from the dsh-cteam plugin config or .ops-local/cw-browser-login.json; provide project_url or project_id to select another project. Use filters from cteam_list_issue_filters queryFields or quickFilters conditions.',
    parameters: {
      project_url: {
        type: 'string',
        description: PROJECT_PARAMETER_DESCRIPTION,
      },
      project_id: {
        type: 'string',
        description: PROJECT_ID_PARAMETER_DESCRIPTION,
      },
      filters: {
        type: 'array',
        description: 'CTeam query filters, for example priority, state, status, createUser, createTime, label, dispatch_project, dispatch, version, modelTypeId, or relation.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            value: {
              type: 'array',
              required: true,
              items: {
                oneOf: [
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'boolean' },
                ],
              },
            },
          },
        },
      },
      page: {
        type: 'number',
        description: 'One-based page number. Defaults to 1.',
      },
      page_size: {
        type: 'number',
        description: 'Rows per page, from 1 to 200. Defaults to 20.',
      },
      remember: {
        type: 'boolean',
        description: 'Whether CTeam may remember these filters for the user. Defaults to false.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          issueType: { type: 'string', required: true },
          page: { type: 'integer', required: true },
          pageSize: { type: 'integer', required: true },
          totalElements: { type: 'integer', required: true },
          totalPages: { type: 'integer', required: true },
          first: { type: 'boolean', required: true },
          last: { type: 'boolean', required: true },
          issues: {
            type: 'array',
            required: true,
            items: demandSchema,
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderIssueList(value) }],
    },
    timeoutMs: config.timeoutMs ?? 30_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseIssueListToolArguments(args, {
        configuredProjectId: resolveDefaultProjectId(config, exec),
        defaultIssueType: 'BUG',
      });
      const loginConfigPath = resolveLoginConfigPath(
        config.loginConfigPath,
        sessionCwd(exec),
      );
      const data = await fetchIssueList({
        baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
        loginConfigPath,
        projectId: input.projectId,
        issueType: 'BUG',
        page: input.page,
        pageSize: input.pageSize,
        remember: input.remember,
        filters: buildIssueFilterBody(input),
        timeoutMs: config.requestTimeoutMs ?? 20_000,
        signal: exec.signal,
      });
      return {
        projectId: input.projectId,
        issueType: 'BUG',
        ...normalizeIssuePage(data),
      };
    },
  });
}

const issueFilterSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    projectId: { type: 'string', required: true },
    name: { type: 'string', required: true },
    createUser: { type: 'string', required: true },
    createTime: { type: 'string', required: true },
    selectType: { type: 'string', required: true },
    sort: { type: 'number', required: true },
    pinned: { type: 'boolean', required: true },
    scope: { type: 'integer', required: true },
    scopeName: { type: 'string', required: true },
    rawCondition: { type: 'string', required: true },
    conditions: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {},
      },
    },
  },
};

const queryFieldSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    label: { type: 'string', required: true },
    type: { type: 'string', required: true },
    sys: { type: 'boolean', required: true },
    sort: { type: 'number', required: true },
    tenantConfigurable: { type: 'boolean', required: true },
  },
};

function renderIssueFilters(value) {
  const lines = [
    `CTeam issue filters for project ${value.projectId}`,
    `issueType=${value.issueType}, selectType=${value.selectType}, quickFilters=${value.quickFilters.length}, personal=${value.personalFilters.length}, team=${value.teamFilters.length}, queryFields=${value.queryFields.length}`,
    '',
  ];
  for (const filter of value.quickFilters) {
    lines.push(`- ${filter.name} | scope=${filter.scopeName} | id=${filter.id} | conditions=${filter.rawCondition}`);
  }
  return lines.join('\n');
}

export function createIssueFiltersTool(config = {}) {
  return defineTool({
    name: 'cteam_list_issue_filters',
    description: 'Read CTeam quick filters and available query filter fields. Quick filters are returned as personalFilters/teamFilters by scope; queryFields shows filter names that can be used by list tools. issue_type defaults to BUG.',
    parameters: {
      project_url: {
        type: 'string',
        description: PROJECT_PARAMETER_DESCRIPTION,
      },
      project_id: {
        type: 'string',
        description: PROJECT_ID_PARAMETER_DESCRIPTION,
      },
      issue_type: {
        type: 'string',
        description: 'Issue type for queryFields: DEMAND, BUG, or TASK. Defaults to BUG.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          issueType: { type: 'string', required: true },
          selectType: { type: 'string', required: true },
          quickFilters: {
            type: 'array',
            required: true,
            items: issueFilterSchema,
          },
          personalFilters: {
            type: 'array',
            required: true,
            items: issueFilterSchema,
          },
          teamFilters: {
            type: 'array',
            required: true,
            items: issueFilterSchema,
          },
          queryFields: {
            type: 'array',
            required: true,
            items: queryFieldSchema,
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderIssueFilters(value) }],
    },
    timeoutMs: config.timeoutMs ?? 30_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseIssueListToolArguments({
        ...args,
        page: 1,
        page_size: 1,
      }, {
        configuredProjectId: resolveDefaultProjectId(config, exec),
        defaultIssueType: 'BUG',
      });
      const loginConfigPath = resolveLoginConfigPath(
        config.loginConfigPath,
        sessionCwd(exec),
      );
      const selectType = issueSelectType(input.issueType);
      const [filterData, queryFieldData] = await Promise.all([
        fetchIssueFilters({
          baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
          loginConfigPath,
          projectId: input.projectId,
          issueType: input.issueType,
          type: selectType,
          timeoutMs: config.requestTimeoutMs ?? 20_000,
          signal: exec.signal,
        }),
        fetchQueryFilterFields({
          baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
          loginConfigPath,
          projectId: input.projectId,
          issueType: input.issueType,
          timeoutMs: config.requestTimeoutMs ?? 20_000,
          signal: exec.signal,
        }),
      ]);
      const filters = normalizeIssueFiltersResult(filterData);
      return {
        projectId: input.projectId,
        issueType: input.issueType,
        selectType,
        quickFilters: filters.filters,
        personalFilters: filters.personalFilters,
        teamFilters: filters.teamFilters,
        queryFields: normalizeQueryFilterFields(queryFieldData),
      };
    },
  });
}

const detailFieldSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    label: { type: 'string', required: true },
    type: { type: 'string', required: true },
    source: { type: 'string', required: true },
    value: { type: 'string', required: true },
    displayValue: { type: 'string', required: true },
    editable: { type: 'boolean', required: true },
    required: { type: 'boolean', required: true },
    flowField: { type: 'boolean', required: true },
  },
};

const fileSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    url: { type: 'string', required: true },
  },
};

const demandDetailSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    number: { type: 'string', required: true },
    title: { type: 'string', required: true },
    desc: { type: 'string', required: true },
    editorType: { type: 'string', required: true },
    typeClassify: { type: 'string', required: true },
    priority: { type: 'string', required: true },
    priorityName: { type: 'string', required: true },
    stateId: { type: 'string', required: true },
    stateName: { type: 'string', required: true },
    modelTypeId: { type: 'string', required: true },
    modelTypeName: { type: 'string', required: true },
    demandClassifyId: { type: 'string', required: true },
    demandClassifyName: { type: 'string', required: true },
    parentId: { type: 'string', required: true },
    assignId: { type: 'string', required: true },
    createUser: { type: 'string', required: true },
    createUserName: { type: 'string', required: true },
    createTime: { type: 'string', required: true },
    updateUser: { type: 'string', required: true },
    updateUserName: { type: 'string', required: true },
    updateTime: { type: 'string', required: true },
    fileId: { type: 'string', required: true },
    deleted: { type: 'boolean', required: true },
    follow: { type: 'boolean', required: true },
    finished: { type: 'boolean', required: true },
    expired: { type: 'boolean', required: true },
    dispatch: { type: 'string', required: true },
    dispatchName: { type: 'string', required: true },
    files: {
      type: 'array',
      required: true,
      items: fileSchema,
    },
    fields: {
      type: 'object',
      required: true,
      additionalProperties: true,
      properties: {},
    },
  },
};

const commentSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    projectId: { type: 'string', required: true },
    issueId: { type: 'string', required: true },
    parentId: { type: 'string', required: true },
    createUser: { type: 'string', required: true },
    createTime: { type: 'string', required: true },
    commentHtml: { type: 'string', required: true },
    nodeId: { type: 'string', required: true },
    nodeName: { type: 'string', required: true },
    nextId: { type: 'string', required: true },
    nextName: { type: 'string', required: true },
    assignProjectId: { type: 'string', required: true },
    children: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: true,
      },
    },
  },
};

const imageSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', required: true },
    sourceId: { type: 'string', required: true },
    index: { type: 'integer', required: true },
    alt: { type: 'string', required: true },
    url: { type: 'string', required: true },
    projectId: { type: 'string', required: true },
    fileId: { type: 'string', required: true },
    downloaded: { type: 'boolean', required: true },
    localPath: { type: 'string', required: true },
    contentType: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    dataUrl: { type: 'string', required: true },
  },
};

function renderDemandDetail(value) {
  const lines = [
    `CTeam demand detail for project ${value.projectId}`,
    `${value.demand.number || value.demand.id} [${value.demand.stateName || value.demand.stateId || 'unknown state'}] ${value.demand.title}`,
    `priority=${value.demand.priorityName || value.demand.priority || 'unknown priority'}, type=${value.demand.modelTypeName || value.demand.typeClassify || 'unknown type'}, category=${value.demand.demandClassifyName || value.demand.demandClassifyId || '(none)'}`,
    `created=${value.demand.createTime || '(unknown)'} by ${value.demand.createUserName || value.demand.createUser || '(unknown)'}`,
    '',
  ];
  if (value.demand.desc) lines.push(value.demand.desc);
  else lines.push('(no description)');
  if (value.demand.files.length > 0) {
    lines.push('', `files=${value.demand.files.length}`);
    for (const file of value.demand.files) {
      lines.push(`- ${file.name || file.id || '(unnamed file)'}${file.url ? ` | ${file.url}` : ''}`);
    }
  }
  lines.push('', `comments=${value.comments.length}`);
  for (const comment of value.comments) {
    lines.push(`- ${comment.createTime || '(unknown time)'} ${comment.createUser || '(unknown user)'}${comment.nodeName ? ` [${comment.nodeName}]` : ''}: ${comment.commentHtml || '(empty comment)'}`);
  }
  lines.push('', `images=${value.images.length}`);
  for (const image of value.images) {
    lines.push(`- ${image.source} ${image.fileId || image.url}${image.downloaded ? ` | ${image.localPath}` : ''}`);
  }
  return lines.join('\n');
}

function renderIssueDetail(value) {
  const lines = [
    `CTeam ${value.issueType.toLocaleLowerCase()} detail for project ${value.projectId}`,
    `${value.issue.number || value.issue.id} [${value.issue.stateName || value.issue.stateId || 'unknown state'}] ${value.issue.title}`,
    `priority=${value.issue.priorityName || value.issue.priority || 'unknown priority'}, type=${value.issue.modelTypeName || value.issue.typeClassify || 'unknown type'}`,
    `created=${value.issue.createTime || '(unknown)'} by ${value.issue.createUserName || value.issue.createUser || '(unknown)'}`,
    '',
  ];
  if (value.issue.desc) lines.push(value.issue.desc);
  else lines.push('(no description)');
  if (value.issue.files.length > 0) {
    lines.push('', `files=${value.issue.files.length}`);
    for (const file of value.issue.files) {
      lines.push(`- ${file.name || file.id || '(unnamed file)'}${file.url ? ` | ${file.url}` : ''}`);
    }
  }
  lines.push('', `comments=${value.comments.length}`);
  for (const comment of value.comments) {
    lines.push(`- ${comment.createTime || '(unknown time)'} ${comment.createUser || '(unknown user)'}${comment.nodeName ? ` [${comment.nodeName}]` : ''}: ${comment.commentHtml || '(empty comment)'}`);
  }
  lines.push('', `images=${value.images.length}`);
  for (const image of value.images) {
    lines.push(`- ${image.source} ${image.fileId || image.url}${image.downloaded ? ` | ${image.localPath}` : ''}`);
  }
  return lines.join('\n');
}

async function readIssueDetail(args, exec, config = {}) {
  const input = parseDemandDetailToolArguments(args, {
    configuredProjectId: resolveDefaultProjectId(config, exec),
  });
  const issueType = parseIssueListToolArguments({
    project_id: input.projectId,
    issue_type: args.issue_type,
    page: 1,
    page_size: 1,
  }, {
    configuredProjectId: resolveDefaultProjectId(config, exec),
    defaultIssueType: 'DEMAND',
  }).issueType;
  const loginConfigPath = resolveLoginConfigPath(
    config.loginConfigPath,
    sessionCwd(exec),
  );
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const data = await fetchIssueDetailWithComments({
    baseUrl,
    loginConfigPath,
    projectId: input.projectId,
    issueId: input.issueId,
    timeoutMs: config.requestTimeoutMs ?? 20_000,
    signal: exec.signal,
  });
  const issue = normalizeDemandDetail(data.detail);
  const comments = normalizeDemandComments(data.comments);
  const foundImages = extractDemandImages(issue, comments);
  const imageOutputDir = config.imageOutputDir
    ?? path.join(sessionCwd(exec) ?? process.cwd(), '.temp', 'dsh-cteam', input.issueId);
  const images = args.download_images === false
    ? foundImages
    : await downloadDemandImages({
      baseUrl,
      loginConfigPath,
      projectId: input.projectId,
      issueId: input.issueId,
      images: foundImages,
      outputDir: imageOutputDir,
      timeoutMs: config.requestTimeoutMs ?? 20_000,
      signal: exec.signal,
    });
  return {
    projectId: input.projectId,
    issueType,
    issue,
    comments,
    images,
  };
}

export function createDemandDetailTool(config = {}) {
  return defineTool({
    name: 'cteam_get_demand_detail',
    description: 'Get a single CTeam demand detail through the logged-in web session, including its comments. This tool is self-contained and does not require Browser tools; do not call Browser to retrieve or verify the same detail. Provide demand_id from cteam_list_demands, or demand_url containing /vteam/{projectId}/ and an id/issueId query parameter. The project defaults to projectId from the dsh-cteam plugin config or .ops-local/cw-browser-login.json.',
    parameters: {
      demand_url: {
        type: 'string',
        description: 'Optional CTeam demand URL. If it contains /vteam/{projectId}/ and id or issueId, those values are used unless explicitly overridden.',
      },
      demand_id: {
        type: 'string',
        description: 'Demand/work item ID. Usually the id returned by cteam_list_demands.',
      },
      project_url: {
        type: 'string',
        description: PROJECT_PARAMETER_DESCRIPTION,
      },
      project_id: {
        type: 'string',
        description: PROJECT_ID_PARAMETER_DESCRIPTION,
      },
      download_images: {
        type: 'boolean',
        description: 'Download Markdown/HTML images from the demand description and comments to .temp/dsh-cteam/{demand_id}. Defaults to true.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          demand: {
            ...demandDetailSchema,
            required: true,
          },
          comments: {
            type: 'array',
            required: true,
            items: commentSchema,
          },
          images: {
            type: 'array',
            required: true,
            items: imageSchema,
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderDemandDetail(value) }],
      presentationMeta: detailPresentationMeta,
    },
    presentResult: presentDetailResult,
    timeoutMs: config.timeoutMs ?? 30_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const value = await readIssueDetail({
        ...args,
        issue_type: 'DEMAND',
      }, exec, config);
      return {
        projectId: value.projectId,
        demand: value.issue,
        comments: value.comments,
        images: value.images,
      };
    },
  });
}

export function createIssueDetailTool(config = {}) {
  return defineTool({
    name: 'cteam_get_issue_detail',
    description: 'Get a single CTeam issue detail through the logged-in web session, including comments and Markdown/HTML images from the description/comments. This tool is self-contained and does not require Browser tools; do not call Browser to retrieve or verify the same detail. Provide issue_id from list tools, or issue_url containing /vteam/{projectId}/ and an id/issueId query parameter. issue_type is optional and is used for labeling only.',
    parameters: {
      issue_url: {
        type: 'string',
        description: 'Optional CTeam issue URL. If it contains /vteam/{projectId}/ and id or issueId, those values are used unless explicitly overridden.',
      },
      issue_id: {
        type: 'string',
        description: 'Issue/work item ID. Usually the id returned by cteam_list_bugs or cteam_list_demands.',
      },
      issue_type: {
        type: 'string',
        description: 'Issue type label: DEMAND, BUG, or TASK. Defaults to DEMAND.',
      },
      project_url: {
        type: 'string',
        description: PROJECT_PARAMETER_DESCRIPTION,
      },
      project_id: {
        type: 'string',
        description: PROJECT_ID_PARAMETER_DESCRIPTION,
      },
      download_images: {
        type: 'boolean',
        description: 'Download Markdown/HTML images from the issue description and comments to .temp/dsh-cteam/{issue_id}. Defaults to true.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          issueType: { type: 'string', required: true },
          issue: {
            ...demandDetailSchema,
            required: true,
          },
          comments: {
            type: 'array',
            required: true,
            items: commentSchema,
          },
          images: {
            type: 'array',
            required: true,
            items: imageSchema,
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderIssueDetail(value) }],
      presentationMeta: detailPresentationMeta,
    },
    presentResult: presentDetailResult,
    timeoutMs: config.timeoutMs ?? 30_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return readIssueDetail(args, exec, config);
    },
  });
}

const fieldOptionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    value: { type: 'string', required: true },
    displayValue: { type: 'string', required: true },
  },
};

const transitionFieldSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    label: { type: 'string', required: true },
    type: { type: 'string', required: true },
    source: { type: 'string', required: true },
    value: { type: 'string', required: true },
    displayValue: { type: 'string', required: true },
    editable: { type: 'boolean', required: true },
    required: { type: 'boolean', required: true },
    flowField: { type: 'boolean', required: true },
    optionLookupKey: { type: 'string', required: true },
    options: {
      type: 'array',
      required: true,
      items: fieldOptionSchema,
    },
    optionsTruncated: { type: 'boolean', required: true },
    optionTotal: { type: 'integer', required: true },
  },
};

const transitionNodeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    operation: { type: 'boolean', required: true },
    current: { type: 'boolean', required: true },
    changed: { type: 'boolean', required: true },
    sort: { type: 'number', required: true },
    users: {
      type: 'array',
      required: true,
      items: fieldOptionSchema,
    },
    roles: {
      type: 'array',
      required: true,
      items: fieldOptionSchema,
    },
    fields: {
      type: 'array',
      required: true,
      items: transitionFieldSchema,
    },
    submitExample: {
      type: 'object',
      required: true,
      additionalProperties: true,
      properties: {},
    },
  },
};

function renderIssueTransitions(value) {
  const lines = [
    `CTeam ${value.issueType.toLocaleLowerCase()} transitions for project ${value.projectId}`,
    `${value.issue.number || value.issue.id} [${value.currentState.name || value.currentState.id || 'unknown state'}] ${value.issue.title}`,
    `nodes=${value.transitions.length}, operable=${value.transitions.filter((node) => node.operation).length}, includeFieldOptions=${value.includeFieldOptions}`,
    '',
  ];
  for (const node of value.transitions) {
    const requiredFields = node.fields.filter((field) => field.required);
    lines.push(`- ${node.name || node.id} | id=${node.id} | ${node.operation ? 'operable' : 'not operable'} | users=${node.users.length}`);
    if (requiredFields.length > 0) {
      lines.push(`  required=${requiredFields.map((field) => `${field.label || field.name}[${field.type}]`).join(', ')}`);
    }
  }
  lines.push('', 'Submit contract is returned as submitExample per node; this tool is read-only.');
  return lines.join('\n');
}

export function createIssueTransitionsTool(config = {}) {
  return defineTool({
    name: 'cteam_get_issue_transitions',
    description: 'Read CTeam issue workflow transition metadata through the logged-in web session. Use this before editing or transitioning an issue. Returns current state, available target nodes, operation flags, required fields per target, candidate users/roles, field option values, and the read-only submit body contract. Defaults to BUG because defect workflow discovery is the primary use case.',
    parameters: {
      issue_url: {
        type: 'string',
        description: 'Optional CTeam issue URL. If it contains /vteam/{projectId}/ and id or issueId, those values are used unless explicitly overridden. twBug/twDemand/twTask also infers issue_type.',
      },
      issue_id: {
        type: 'string',
        description: 'Issue/work item ID. Usually the id returned by cteam_list_bugs or cteam_list_demands.',
      },
      issue_type: {
        type: 'string',
        description: 'Issue type label: DEMAND, BUG, or TASK. Defaults to BUG, or is inferred from issue_url when possible.',
      },
      project_url: {
        type: 'string',
        description: PROJECT_PARAMETER_DESCRIPTION,
      },
      project_id: {
        type: 'string',
        description: PROJECT_ID_PARAMETER_DESCRIPTION,
      },
      include_field_options: {
        type: 'boolean',
        description: 'Fetch option values for SELECT/MULTI_SELECT/RADIO/CHECKBOX/USER transition fields. Defaults to true.',
      },
      option_limit: {
        type: 'number',
        description: 'Maximum option values returned per field, from 1 to 500. Defaults to 50.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          issueType: { type: 'string', required: true },
          includeFieldOptions: { type: 'boolean', required: true },
          optionLimit: { type: 'integer', required: true },
          changed: { type: 'boolean', required: true },
          currentState: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              name: { type: 'string', required: true },
            },
          },
          issue: {
            ...demandDetailSchema,
            required: true,
          },
          transitions: {
            type: 'array',
            required: true,
            items: transitionNodeSchema,
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderIssueTransitions(value) }],
    },
    timeoutMs: config.timeoutMs ?? 60_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseIssueTransitionToolArguments(args, {
        configuredProjectId: resolveDefaultProjectId(config, exec),
        defaultIssueType: 'BUG',
      });
      const loginConfigPath = resolveLoginConfigPath(
        config.loginConfigPath,
        sessionCwd(exec),
      );
      const baseOptions = {
        baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
        loginConfigPath,
        projectId: input.projectId,
        issueId: input.issueId,
        issueType: input.issueType,
        timeoutMs: config.requestTimeoutMs ?? 20_000,
        signal: exec.signal,
      };
      const session = await createAuthenticatedSession(baseOptions);
      const [detailData, rawNodes] = await Promise.all([
        fetchIssueDetailWithComments({ ...baseOptions, session }),
        fetchIssueTransitionNodes({ ...baseOptions, session }),
      ]);
      const issue = normalizeDemandDetail(detailData.detail);
      const normalizedNodes = normalizeTransitionNodes(rawNodes, issue.stateId);
      const optionsByKey = new Map();

      const transitions = await Promise.all(normalizedNodes.nodes.map(async (node) => {
        const [fieldData, candidateData] = await Promise.all([
          fetchIssueTransitionFields({ ...baseOptions, session, nextNodeId: node.id }),
          fetchIssueTransitionCandidates({ ...baseOptions, session, nextNodeId: node.id }),
        ]);
        const fields = normalizeTransitionFields(fieldData);
        const enrichedFields = await Promise.all(fields.map(async (field) => {
          if (!input.includeFieldOptions || !shouldFetchFieldOptions(field)) {
            return { ...field, optionTotal: 0 };
          }
          if (!optionsByKey.has(field.optionLookupKey)) {
            optionsByKey.set(field.optionLookupKey, fetchIssueFieldOptions({
              ...baseOptions,
              session,
              fieldIdOrName: field.optionLookupKey,
            }));
          }
          const optionData = await optionsByKey.get(field.optionLookupKey);
          const normalizedOptions = normalizeFieldOptions(optionData, input.optionLimit);
          return {
            ...field,
            options: normalizedOptions.options,
            optionsTruncated: normalizedOptions.truncated,
            optionTotal: normalizedOptions.total,
          };
        }));
        const candidates = normalizeTransitionCandidates(candidateData);
        const transition = {
          ...node,
          users: candidates.users,
          roles: candidates.roles,
          fields: enrichedFields,
        };
        return {
          ...transition,
          submitExample: buildTransitionSubmitExample(input, transition),
        };
      }));

      return {
        projectId: input.projectId,
        issueType: input.issueType,
        includeFieldOptions: input.includeFieldOptions,
        optionLimit: input.optionLimit,
        changed: normalizedNodes.changed,
        currentState: {
          id: issue.stateId,
          name: issue.stateName,
        },
        issue,
        transitions,
      };
    },
  });
}

const wikiNodeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    libraryId: { type: 'string', required: true },
    parentId: { type: 'string', required: true },
    title: { type: 'string', required: true },
    visitLimit: { type: 'string', required: true },
    levelPath: { type: 'string', required: true },
    classify: { type: 'string', required: true },
    sort: { type: 'number', required: true },
    createdBy: { type: 'string', required: true },
    createdTime: { type: 'string', required: true },
    follow: { type: 'boolean', required: true },
    permissions: { type: 'array', required: true, items: { type: 'string' } },
    depth: { type: 'integer', required: true },
    childCount: { type: 'integer', required: true },
    path: { type: 'array', required: true, items: { type: 'string' } },
  },
};

const wikiImportTargetSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'integer', required: true },
    projectId: { type: 'string', required: true },
    libraryId: { type: 'string', required: true },
    parentId: { type: 'string', required: true },
    title: { type: 'string', required: true },
    path: { type: 'array', required: true, items: { type: 'string' } },
    wikiUrl: { type: 'string', required: true },
    savedAt: { type: 'number', required: true },
  },
};

function renderWikiTree(value) {
  const lines = [
    `CTeam wiki tree for project ${value.projectId}`,
    `library=${value.libraryId}`,
    `mode=${value.mode}, returned=${value.returnedNodes}, matched=${value.matchedNodes}, total=${value.totalNodes}`,
  ];
  if (value.lastImportTarget) {
    const last = value.lastImportTarget;
    const label = last.path.length > 0 ? last.path.join(' / ') : last.title || last.parentId;
    lines.push(`lastImportTarget=${label} | id=${last.parentId}`);
  }
  if (value.truncated) lines.push('Result truncated; narrow by parent_id/query or increase limit.');
  lines.push('');
  if (value.nodes.length === 0) lines.push('(no wiki nodes)');
  for (const node of value.nodes) {
    lines.push(`- ${node.path.join(' / ')} | id=${node.id} | children=${node.childCount}`);
  }
  return lines.join('\n');
}

async function resolveWikiLibraryForInput(input, config, exec, timeoutMs) {
  const loginConfigPath = resolveLoginConfigPath(config.loginConfigPath, sessionCwd(exec));
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const baseOptions = {
    baseUrl,
    loginConfigPath,
    tenantId: config.tenantId,
    projectId: input.projectId,
    timeoutMs,
    signal: exec.signal,
  };
  const session = await createAuthenticatedSession(baseOptions);
  if (input.libraryId) {
    return {
      baseUrl,
      loginConfigPath,
      session,
      libraryId: input.libraryId,
      libraryInfo: undefined,
    };
  }
  const libraryInfo = await fetchWikiLibraryInfo({
    ...baseOptions,
    session,
  });
  return {
    baseUrl,
    loginConfigPath,
    session,
    libraryId: libraryInfo.id,
    libraryInfo,
  };
}

export function createWikiTreeTool(config = {}) {
  return defineTool({
    name: 'cteam_list_wiki_tree',
    description: 'Read-only CTeam doc/wiki library tree viewer through the logged-in web session. Use only when the user explicitly asks to view, list, expand, or search Wiki directories/categories. Use wiki_url from a /devops/console/toc/{projectId}/wiki/lib/{libraryId}/... page or provide library_id. When library_id is omitted, the tool first calls /ms/doc/api/user/doc_library/libInfo/{projectId} and then reads that library tree. Omit parent_id/query to list roots; use parent_id for children, include_descendants for a subtree, or query to search titles and full paths.',
    parameters: {
      wiki_url: {
        type: 'string',
        description: 'Optional CTeam wiki URL containing /toc/{projectId}/wiki/lib/{libraryId}/... and optionally /list/{wikiId}.',
      },
      project_id: {
        type: 'string',
        description: PROJECT_ID_PARAMETER_DESCRIPTION,
      },
      library_id: {
        type: 'string',
        description: 'Optional CTeam doc wiki library ID. Can be parsed from wiki_url; if omitted, resolved from doc_library/libInfo/{projectId}.',
      },
      parent_id: {
        type: 'string',
        description: 'Return direct child wiki pages under this wiki ID. Set include_descendants=true for the full subtree.',
      },
      query: {
        type: 'string',
        description: 'Case-insensitive search across wiki titles and full paths.',
      },
      include_descendants: {
        type: 'boolean',
        description: 'With parent_id, return all descendants instead of only direct children.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum returned nodes, from 1 to 1000. Defaults to 200.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          libraryId: { type: 'string', required: true },
          mode: { type: 'string', required: true },
          rootCount: { type: 'integer', required: true },
          totalNodes: { type: 'integer', required: true },
          matchedNodes: { type: 'integer', required: true },
          returnedNodes: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          lastImportTarget: wikiImportTargetSchema,
          nodes: { type: 'array', required: true, items: wikiNodeSchema },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderWikiTree(value) }],
    },
    timeoutMs: config.timeoutMs ?? 30_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseWikiTreeToolArguments(args, {
        configuredProjectId: resolveDefaultProjectId(config, exec),
      });
      const resolved = await resolveWikiLibraryForInput(input, config, exec, config.requestTimeoutMs ?? 20_000);
      const tree = await fetchWikiTree({
        baseUrl: resolved.baseUrl,
        session: resolved.session,
        loginConfigPath: resolved.loginConfigPath,
        tenantId: config.tenantId,
        projectId: input.projectId,
        libraryId: resolved.libraryId,
        timeoutMs: config.requestTimeoutMs ?? 20_000,
        signal: exec.signal,
      });
      const allNodes = flattenWikiTree(tree);
      const selected = selectWikiNodes(allNodes, input);
      const lastImportTarget = getLastWikiImportTarget(sessionCwd(exec) ?? process.cwd(), input.projectId, resolved.libraryId);
      return {
        projectId: input.projectId,
        libraryId: resolved.libraryId,
        mode: selected.mode,
        rootCount: allNodes.filter((node) => node.depth === 0).length,
        totalNodes: allNodes.length,
        matchedNodes: selected.matchedNodes,
        returnedNodes: selected.nodes.length,
        truncated: selected.truncated,
        ...(lastImportTarget ? { lastImportTarget } : {}),
        nodes: selected.nodes,
      };
    },
  });
}

const wikiDetailSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    libraryId: { type: 'string', required: true },
    parentId: { type: 'string', required: true },
    title: { type: 'string', required: true },
    content: { type: 'string', required: true },
    editor: { type: 'boolean', required: true },
    visitLimit: { type: 'string', required: true },
    levelPath: { type: 'string', required: true },
    classify: { type: 'string', required: true },
    version: { type: 'integer', required: true },
    pageview: { type: 'integer', required: true },
    createUser: { type: 'string', required: true },
    createTime: { type: 'string', required: true },
    updatedUser: { type: 'string', required: true },
    updatedTime: { type: 'string', required: true },
    permissions: { type: 'array', required: true, items: { type: 'string' } },
    classifyList: { type: 'array', required: true, items: { type: 'string' } },
    fileList: { type: 'array', required: true, items: { type: 'object', additionalProperties: true, properties: {} } },
  },
};

function renderWikiDetail(value) {
  const wiki = value.wiki;
  const lines = [
    `CTeam wiki detail for project ${value.projectId}`,
    `title=${wiki.title}`,
    `id=${wiki.id}`,
    `library=${value.libraryId}`,
    `updated=${wiki.updatedTime || wiki.createTime}`,
    `contentLength=${wiki.content.length}`,
    value.wikiUrl,
    '',
    wiki.content ? wiki.content : '(empty content)',
  ];
  return lines.join('\n');
}

function presentWikiDetailResult(_args, result) {
  if (result.isError || result.meta === undefined) return undefined;
  return {
    card: 'generic',
    title: result.meta.wiki?.title || 'CTeam Wiki',
    content: [{
      type: 'text',
      text: `${CTEAM_WIKI_DETAIL_PRESENTATION_MARKER}${JSON.stringify(result.meta)}`,
    }],
  };
}

export function createWikiDetailTool(config = {}) {
  return defineTool({
    name: 'cteam_get_wiki_detail',
    description: 'Get one CTeam wiki page detail through the logged-in web session. Provide wiki_url containing /toc/{projectId}/wiki/lib/{libraryId}/.../list/{wikiId}, or provide project_id and wiki_id. If library_id is omitted, it is resolved from /ms/doc/api/user/doc_library/libInfo/{projectId}. The content is returned as CTeam HTML.',
    parameters: {
      wiki_url: {
        type: 'string',
        description: 'Optional CTeam wiki URL containing project, library, and wiki IDs.',
      },
      project_id: {
        type: 'string',
        description: PROJECT_ID_PARAMETER_DESCRIPTION,
      },
      library_id: {
        type: 'string',
        description: 'Optional CTeam doc wiki library ID. Can be parsed from wiki_url; if omitted, resolved from doc_library/libInfo/{projectId}.',
      },
      wiki_id: {
        type: 'string',
        description: 'Wiki page ID. Can be parsed from wiki_url.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          libraryId: { type: 'string', required: true },
          wikiId: { type: 'string', required: true },
          wikiUrl: { type: 'string', required: true },
          wiki: { ...wikiDetailSchema, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderWikiDetail(value) }],
      presentationMeta: (_args, value) => value,
    },
    presentResult: presentWikiDetailResult,
    timeoutMs: config.timeoutMs ?? 30_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseWikiDetailToolArguments(args, {
        configuredProjectId: resolveDefaultProjectId(config, exec),
      });
      const resolved = await resolveWikiLibraryForInput(input, config, exec, config.requestTimeoutMs ?? 20_000);
      const data = await fetchWikiDetail({
        baseUrl: resolved.baseUrl,
        session: resolved.session,
        loginConfigPath: resolved.loginConfigPath,
        tenantId: config.tenantId,
        projectId: input.projectId,
        libraryId: resolved.libraryId,
        wikiId: input.wikiId,
        timeoutMs: config.requestTimeoutMs ?? 20_000,
        signal: exec.signal,
      });
      const wiki = normalizeWikiDetail(data);
      return {
        projectId: input.projectId,
        libraryId: resolved.libraryId,
        wikiId: input.wikiId,
        wikiUrl: wikiConsoleUrl(config.baseUrl ?? DEFAULT_BASE_URL, input.projectId, resolved.libraryId, input.wikiId),
        wiki,
      };
    },
  });
}

function renderWikiImport(value) {
  const lines = [
    value.dryRun
      ? `CTeam wiki markdown import dry run for project ${value.projectId}`
      : `CTeam wiki markdown imported for project ${value.projectId}`,
    `library=${value.libraryId}`,
    `parent=${value.parentId}`,
    value.target ? `target=${value.target.path.length > 0 ? value.target.path.join(' / ') : value.target.title || value.target.parentId}` : undefined,
    `filename=${value.filename}`,
    `bytes=${value.bytes}`,
  ].filter(Boolean);
  if (!value.dryRun) lines.push(`result=${JSON.stringify(value.result)}`);
  return lines.join('\n');
}

function wikiNodesForForm(nodes) {
  return nodes.map((node) => ({
    id: node.id,
    parentId: node.parentId,
    name: node.title,
    title: node.title,
    depth: node.depth,
    childCount: node.childCount,
    path: node.path,
  }));
}

async function askWikiImportConfirmation(args, exec, config = {}) {
  const input = parseWikiTreeToolArguments(args, {
    configuredProjectId: resolveDefaultProjectId(config, exec),
  });
  const resolved = await resolveWikiLibraryForInput(input, config, exec, config.requestTimeoutMs ?? 20_000);
  const tree = await fetchWikiTree({
    baseUrl: resolved.baseUrl,
    session: resolved.session,
    loginConfigPath: resolved.loginConfigPath,
    tenantId: config.tenantId,
    projectId: input.projectId,
    libraryId: resolved.libraryId,
    timeoutMs: config.requestTimeoutMs ?? 20_000,
    signal: exec.signal,
  });
  const nodes = flattenWikiTree(tree);
  const lastImportTarget = getLastWikiImportTarget(sessionCwd(exec) ?? process.cwd(), input.projectId, resolved.libraryId);
  const detail = JSON.stringify({
    version: 1,
    kind: CTEAM_WIKI_IMPORT_FORM_INTENT_KIND,
    projectId: input.projectId,
    libraryId: resolved.libraryId,
    libraryInfo: resolved.libraryInfo ?? {},
    title: typeof args.title === 'string' ? args.title : '',
    summary: typeof args.summary === 'string' ? args.summary : '',
    nodes: wikiNodesForForm(nodes),
    ...(lastImportTarget ? { lastImportTarget } : {}),
  });
  if (config.userQuestions === undefined) {
    throw new Error('cteam_confirm_wiki_import requires the userQuestions service');
  }
  const answer = await config.userQuestions.ask({
    questions: [{
      id: 'cteam_wiki_import',
      header: 'CTeam Wiki 导入',
      question: '确认 Markdown 内容并选择 Wiki 父级分类',
      detail,
      options: [
        { label: '导入', description: '确认分类并返回给工具继续导入。' },
        { label: '取消', description: '放弃本次 Wiki 导入。' },
      ],
    }],
    ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
    signal: exec.signal,
  });
  const payload = parseWikiImportAnswer(answer);
  const images = await persistPastedImages(payload.images, exec);
  return {
    projectId: input.projectId,
    libraryId: resolved.libraryId,
    parentId: typeof payload.parentId === 'string' ? payload.parentId : '',
    parentPath: Array.isArray(payload.parentPath) ? payload.parentPath.map(String) : [],
    title: typeof payload.title === 'string' && payload.title ? payload.title : (typeof args.title === 'string' ? args.title : ''),
    markdown: typeof payload.markdown === 'string' ? payload.markdown : '',
    images,
  };
}

async function importWikiFromSubmission(submission, args, exec, config = {}) {
  const projectId = stringOption(submission.projectId, 'projectId') ?? stringOption(args.project_id, 'project_id') ?? resolveDefaultProjectId(config, exec);
  if (!projectId) throw new Error('projectId is required');
  const libraryId = stringOption(submission.libraryId, 'libraryId');
  if (!libraryId) throw new Error('libraryId is required');
  const parentId = stringOption(submission.parentId, 'parentId');
  if (!parentId) throw new Error('parentId is required');
  const loginConfigPath = resolveLoginConfigPath(config.loginConfigPath, sessionCwd(exec));
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const baseOptions = {
    baseUrl,
    loginConfigPath,
    projectId,
    libraryId,
    timeoutMs: config.requestTimeoutMs ?? 60_000,
    signal: exec.signal,
  };
  const dryRun = booleanOption(args.dry_run, false);
  const session = await createAuthenticatedSession(baseOptions);
  const uploadedImages = [];

  if (!dryRun) {
    for (const image of Array.isArray(submission.images) ? submission.images : []) {
      if (typeof image !== 'object' || image === null || Array.isArray(image)) continue;
      if (typeof image.localPath !== 'string' || !image.localPath) continue;
      const uploadResult = await uploadIssueFile({
        ...baseOptions,
        session,
        issueType: 'DEMAND',
        filePath: image.localPath,
        filename: path.basename(image.localPath),
        contentType: image.contentType,
      });
      uploadedImages.push({
        ...image,
        uploadResult,
        fileId: uploadedFileId(uploadResult),
      });
    }
  }

  const markdownWithImages = replaceImagePlaceholders(
    submission.markdown,
    projectId,
    uploadedImages,
  );
  const missingImagePlaceholders = extractPastedImagePlaceholders(markdownWithImages);
  const filename = stringOption(args.filename, 'filename')
    ?? `${safePathPart(submission.title || 'wiki-import', 'wiki-import')}.md`;

  if (dryRun) {
    return {
      projectId,
      libraryId,
      parentId,
      parentPath: submission.parentPath,
      title: submission.title,
      filename,
      bytes: Buffer.byteLength(markdownWithImages, 'utf8'),
      dryRun: true,
      succeeded: true,
      markdown: markdownWithImages,
      uploadedImages,
      result: {},
    };
  }

  if (missingImagePlaceholders.length > 0) {
    return {
      projectId,
      libraryId,
      parentId,
      parentPath: submission.parentPath,
      title: submission.title,
      filename,
      bytes: Buffer.byteLength(markdownWithImages, 'utf8'),
      dryRun: false,
      succeeded: false,
      error: `pasted image cache missing for ${missingImagePlaceholders.length} image(s); re-paste the images before importing to CTeam Wiki`,
      errorDetails: { missingImagePlaceholders },
      markdown: markdownWithImages,
      uploadedImages,
      result: {},
    };
  }

  let result;
  try {
    result = await importWikiMarkdown({
      ...baseOptions,
      session,
      parentId,
      buffer: Buffer.from(markdownWithImages, 'utf8'),
      filename,
      contentType: 'text/markdown; charset=utf-8',
      timeoutMs: config.requestTimeoutMs ?? 60_000,
      signal: exec.signal,
    });
  } catch (error) {
    return {
      projectId,
      libraryId,
      parentId,
      parentPath: submission.parentPath,
      title: submission.title,
      filename,
      bytes: Buffer.byteLength(markdownWithImages, 'utf8'),
      dryRun: false,
      succeeded: false,
      error: errorMessage(error),
      errorDetails: errorDetails(error),
      markdown: markdownWithImages,
      uploadedImages,
      result: {},
    };
  }

  const target = saveLastWikiImportTarget(sessionCwd(exec) ?? process.cwd(), {
    version: 1,
    projectId,
    libraryId,
    parentId,
    title: submission.parentPath?.[submission.parentPath.length - 1] ?? '',
    path: Array.isArray(submission.parentPath) ? submission.parentPath : [],
    wikiUrl: wikiConsoleUrl(baseUrl, projectId, libraryId, parentId),
  });
  return {
    projectId,
    libraryId,
    parentId,
    parentPath: submission.parentPath,
    title: submission.title,
    filename,
    bytes: Buffer.byteLength(markdownWithImages, 'utf8'),
    dryRun: false,
    succeeded: true,
    markdown: markdownWithImages,
    uploadedImages,
    target,
    result: typeof result === 'object' && result !== null ? result : { value: result },
  };
}

function renderWikiSubmit(value) {
  const succeeded = value.succeeded !== false;
  const lines = [
    value.dryRun
      ? `CTeam wiki markdown import dry run for project ${value.projectId}`
      : succeeded
        ? `CTeam wiki markdown imported for project ${value.projectId}`
        : `CTeam wiki markdown import failed for project ${value.projectId}`,
    `library=${value.libraryId}`,
    `parent=${(value.parentPath ?? []).join(' / ')} | id=${value.parentId}`,
    `filename=${value.filename}`,
    `bytes=${value.bytes}`,
    `images=${value.uploadedImages.length}`,
  ];
  if (!succeeded) lines.push(`error=${value.error}`);
  return lines.join('\n');
}

export function createWikiMarkdownSubmitTool(config = {}) {
  const toolName = config.toolName ?? 'cteam_submit_wiki_markdown';
  const toolDescription = config.toolDescription
    ?? 'Interactive CTeam Wiki Markdown upload/import form. Use this when the user says 上传到wiki, 上传到 wiki, 重试上传到wiki, 再试一下上传到wiki, 导入markdown到wiki, 导入 markdown 到 wiki, 提交到wiki, 提交到 wiki, or asks to choose a Wiki category before upload. This opens a conversation form, uses the current dsh-cteam right-side Markdown/PRD draft as content, resolves the project Wiki library through /ms/doc/api/user/doc_library/libInfo/{projectId}, shows a searchable step-by-step Wiki category selector, uploads pasted images, replaces image placeholders, and imports only after the user confirms.';
  return defineTool({
    name: toolName,
    description: toolDescription,
    parameters: {
      project_id: {
        type: 'string',
        description: PROJECT_ID_PARAMETER_DESCRIPTION,
      },
      title: {
        type: 'string',
        description: 'Optional title used to suggest the imported Markdown filename. Defaults to the current authoring title.',
      },
      summary: {
        type: 'string',
        description: 'Optional summary shown above the confirmation form.',
      },
      filename: {
        type: 'string',
        description: 'Optional filename for the imported Markdown. Defaults to the current title plus .md.',
      },
      dry_run: {
        type: 'boolean',
        description: 'When true, stop after confirmation and payload preparation. Defaults to false.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          projectId: { type: 'string', required: true },
          libraryId: { type: 'string', required: true },
          parentId: { type: 'string', required: true },
          parentPath: { type: 'array', required: true, items: { type: 'string' } },
          title: { type: 'string', required: true },
          filename: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          dryRun: { type: 'boolean', required: true },
          succeeded: { type: 'boolean', required: true },
          markdown: { type: 'string', required: true },
          uploadedImages: { type: 'array', required: true, items: submissionImageSchema },
          result: { type: 'object', required: true, additionalProperties: true, properties: {} },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderWikiSubmit(value) }],
    },
    timeoutMs: config.timeoutMs ?? 300_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const submission = await askWikiImportConfirmation(args, exec, config);
      return importWikiFromSubmission(submission, args, exec, config);
    },
  });
}

export function createWikiMarkdownImportTool(config = {}) {
  return defineTool({
    name: 'cteam_import_wiki_markdown',
    description: 'Programmatic CTeam Wiki Markdown import for automation only. Use this only when the caller already supplied a concrete parent_id/wiki_url/use_last_target and exactly one Markdown source, markdown_file_path or markdown. For conversation phrases like 上传到wiki, 再试一下上传到wiki, 导入markdown到wiki, 提交到wiki, or when the user needs to choose a category in a form, use cteam_submit_wiki_markdown or cteam_upload_wiki_markdown instead.',
    parameters: {
      wiki_url: {
        type: 'string',
        description: 'Optional CTeam wiki URL. If it contains /list/{wikiId}, that wiki ID is used as parent_id unless parent_id is provided.',
      },
      project_id: {
        type: 'string',
        description: PROJECT_ID_PARAMETER_DESCRIPTION,
      },
      library_id: {
        type: 'string',
        description: 'Optional CTeam doc wiki library ID. Can be parsed from wiki_url; if omitted, resolved from doc_library/libInfo/{projectId}.',
      },
      parent_id: {
        type: 'string',
        description: 'Parent wiki node ID to import the Markdown under. Defaults to the wiki ID parsed from wiki_url. Prefer a parent_id selected after cteam_list_wiki_tree.',
      },
      use_last_target: {
        type: 'boolean',
        description: 'Use the last successful Wiki import target for this project and library. This is separate from PRD demand submission history. Defaults to false.',
      },
      markdown_file_path: {
        type: 'string',
        description: 'Local Markdown file path to upload. Relative paths resolve from the current session working directory.',
      },
      markdown: {
        type: 'string',
        description: 'Markdown text to upload directly as a generated .md file.',
      },
      filename: {
        type: 'string',
        description: 'Filename used for the uploaded Markdown. Defaults to import.md or the basename of markdown_file_path.',
      },
      dry_run: {
        type: 'boolean',
        description: 'When true, validate the target and content without uploading. Defaults to false for explicit import requests.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          libraryId: { type: 'string', required: true },
          parentId: { type: 'string', required: true },
          target: wikiImportTargetSchema,
          filename: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          dryRun: { type: 'boolean', required: true },
          result: { type: 'object', required: true, additionalProperties: true, properties: {} },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderWikiImport(value) }],
    },
    timeoutMs: config.timeoutMs ?? 120_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const input = parseWikiImportToolArguments(args, {
        configuredProjectId: resolveDefaultProjectId(config, exec),
      });
      const cwd = sessionCwd(exec) ?? process.cwd();
      const resolved = await resolveWikiLibraryForInput(input, config, exec, config.requestTimeoutMs ?? 60_000);
      const lastTarget = input.useLastTarget
        ? getLastWikiImportTarget(cwd, input.projectId, resolved.libraryId)
        : undefined;
      const parentId = input.parentId ?? lastTarget?.parentId;
      if (!parentId) {
        throw new Error('parent_id is required; call cteam_list_wiki_tree and let the user choose a wiki category, or set use_last_target=true after a previous successful Wiki import');
      }
      const filePath = input.markdownFilePath === undefined
        ? undefined
        : path.resolve(cwd, input.markdownFilePath);
      const buffer = input.markdown === undefined
        ? fs.readFileSync(filePath)
        : Buffer.from(input.markdown, 'utf8');
      const filename = input.filename || (filePath ? path.basename(filePath) : 'import.md');
      if (input.dryRun) {
        return {
          projectId: input.projectId,
          libraryId: resolved.libraryId,
          parentId,
          ...(lastTarget ? { target: lastTarget } : {}),
          filename,
          bytes: buffer.length,
          dryRun: true,
          result: {},
        };
      }
      const result = await importWikiMarkdown({
        baseUrl: resolved.baseUrl,
        session: resolved.session,
        loginConfigPath: resolved.loginConfigPath,
        tenantId: config.tenantId,
        projectId: input.projectId,
        libraryId: resolved.libraryId,
        parentId,
        buffer,
        filename,
        contentType: 'text/markdown; charset=utf-8',
        timeoutMs: config.requestTimeoutMs ?? 60_000,
        signal: exec.signal,
      });
      let target = lastTarget;
      try {
        const tree = await fetchWikiTree({
          baseUrl: resolved.baseUrl,
          session: resolved.session,
          loginConfigPath: resolved.loginConfigPath,
          tenantId: config.tenantId,
          projectId: input.projectId,
          libraryId: resolved.libraryId,
          timeoutMs: config.requestTimeoutMs ?? 20_000,
          signal: exec.signal,
        });
        const parentNode = flattenWikiTree(tree).find((node) => node.id === parentId);
        target = parentNode
          ? wikiImportTargetFromNode(parentNode, resolved.baseUrl, input.projectId, resolved.libraryId)
          : {
            version: 1,
            projectId: input.projectId,
            libraryId: resolved.libraryId,
            parentId,
            title: '',
            path: [],
            wikiUrl: wikiConsoleUrl(resolved.baseUrl, input.projectId, resolved.libraryId, parentId),
            savedAt: 0,
          };
      } catch {
        target = target ?? {
          version: 1,
          projectId: input.projectId,
          libraryId: resolved.libraryId,
          parentId,
          title: '',
          path: [],
          wikiUrl: wikiConsoleUrl(resolved.baseUrl, input.projectId, resolved.libraryId, parentId),
          savedAt: 0,
        };
      }
      target = saveLastWikiImportTarget(cwd, target);
      return {
        projectId: input.projectId,
        libraryId: resolved.libraryId,
        parentId,
        ...(target ? { target } : {}),
        filename,
        bytes: buffer.length,
        dryRun: false,
        result: typeof result === 'object' && result !== null ? result : { value: result },
      };
    },
  });
}

export function apply(ctx, config = {}) {
  registerBundledSkills(ctx);
  ctx.tools.register(createPrdAuthoringTool(config));
  ctx.tools.register(createPrdSubmissionConfirmTool({
    ...config,
    userQuestions: ctx.userQuestions,
  }));
  ctx.tools.register(createDemandFromSubmissionTool(config));
  ctx.tools.register(createPrdSubmitDemandTool({
    ...config,
    userQuestions: ctx.userQuestions,
  }));
  ctx.tools.register(createDemandCategoryTool(config));
  ctx.tools.register(createDemandListTool(config));
  ctx.tools.register(createDemandDetailTool(config));
  ctx.tools.register(createBugListTool(config));
  ctx.tools.register(createIssueFiltersTool(config));
  ctx.tools.register(createIssueDetailTool(config));
  ctx.tools.register(createIssueTransitionsTool(config));
  ctx.tools.register(createWikiTreeTool(config));
  ctx.tools.register(createWikiDetailTool(config));
  ctx.tools.register(createWikiMarkdownSubmitTool({
    ...config,
    userQuestions: ctx.userQuestions,
  }));
  ctx.tools.register(createWikiMarkdownSubmitTool({
    ...config,
    toolName: 'cteam_upload_wiki_markdown',
    toolDescription: 'Interactive CTeam Wiki Markdown upload form for phrases like 上传到wiki, 再试一下上传到wiki, 重试上传到wiki, 导入markdown到wiki, and 提交到wiki. This is an alias of cteam_submit_wiki_markdown: it opens the Wiki category-selection form, reads the current right-side Markdown draft, uploads pasted images, and writes to CTeam only after form confirmation.',
    userQuestions: ctx.userQuestions,
  }));
  ctx.tools.register(createWikiMarkdownImportTool(config));
}
