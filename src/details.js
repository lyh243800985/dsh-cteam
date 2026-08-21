import { resolveProjectId } from './categories.js';

const ISSUE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function optionalString(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseDemandUrl(value, name = 'demand_url') {
  const demandUrl = optionalString(value, name);
  if (demandUrl === undefined) return {};

  let url;
  try {
    url = new URL(demandUrl);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  const projectMatch = /\/vteam\/([^/?#]+)/u.exec(url.pathname);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const pathIssueId = [...pathParts].reverse().find((part) => {
    return ISSUE_ID_PATTERN.test(decodeURIComponent(part)) && part.length >= 20;
  });
  return {
    projectUrl: projectMatch === null ? undefined : demandUrl,
    issueId: optionalString(url.searchParams.get('id'), 'demand_url id')
      ?? optionalString(url.searchParams.get('issueId'), 'demand_url issueId')
      ?? (pathIssueId === undefined ? undefined : decodeURIComponent(pathIssueId)),
  };
}

export function parseDemandDetailToolArguments(args, options = {}) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('tool arguments must be an object');
  }

  const urlName = args.demand_url !== undefined ? 'demand_url' : 'issue_url';
  const parsedUrl = parseDemandUrl(args.demand_url ?? args.issue_url, urlName);
  const explicitIssueId = optionalString(args.demand_id ?? args.issue_id, 'issue_id');
  const issueId = explicitIssueId ?? parsedUrl.issueId;
  if (issueId === undefined) throw new Error('provide demand_id, demand_url, issue_id, or issue_url with id');
  if (!ISSUE_ID_PATTERN.test(issueId)) throw new Error('issue_id contains unsupported characters');
  if (
    explicitIssueId !== undefined
    && parsedUrl.issueId !== undefined
    && explicitIssueId !== parsedUrl.issueId
  ) {
    throw new Error(`demand_id "${explicitIssueId}" does not match demand_url id "${parsedUrl.issueId}"`);
  }

  return {
    projectId: resolveProjectId({
      projectUrl: args.project_url ?? parsedUrl.projectUrl,
      projectId: args.project_id,
      configuredProjectId: options.configuredProjectId,
    }),
    issueId,
  };
}

function stringValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function booleanValue(value) {
  return stringValue(value).toLocaleLowerCase() === 'true';
}

function normalizeField(raw, fallbackName) {
  const field = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
  return {
    id: stringValue(field.id),
    name: stringValue(field.name || fallbackName),
    label: stringValue(field.label),
    type: stringValue(field.type),
    source: stringValue(field.source),
    value: stringValue(field.value),
    displayValue: stringValue(field.displayValue),
    editable: field.editable === true,
    required: field.required === true,
    flowField: field.flowField === true,
  };
}

function fieldValue(fields, name, key = 'value') {
  return fields[name]?.[key] ?? '';
}

function normalizeFile(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { id: '', name: '', url: '', raw };
  }
  return {
    id: stringValue(raw.id ?? raw.fileId),
    name: stringValue(raw.name ?? raw.fileName),
    url: stringValue(raw.url ?? raw.downloadUrl),
    raw,
  };
}

export function normalizeDemandDetail(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('CTeam demand detail response data must be an object');
  }
  const property = typeof data.property === 'object' && data.property !== null
    ? data.property
    : {};
  const fields = {};
  for (const [name, field] of Object.entries(property)) {
    fields[name] = normalizeField(field, name);
  }

  return {
    id: fieldValue(fields, 'id'),
    number: fieldValue(fields, 'number', 'displayValue') || fieldValue(fields, 'number'),
    title: fieldValue(fields, 'title', 'displayValue') || fieldValue(fields, 'title'),
    desc: fieldValue(fields, 'desc', 'displayValue') || fieldValue(fields, 'desc'),
    editorType: fieldValue(fields, 'editorType'),
    typeClassify: fieldValue(fields, 'typeClassify'),
    priority: fieldValue(fields, 'priority'),
    priorityName: fieldValue(fields, 'priority', 'displayValue'),
    stateId: fieldValue(fields, 'state'),
    stateName: fieldValue(fields, 'state', 'displayValue'),
    modelTypeId: fieldValue(fields, 'modelTypeId'),
    modelTypeName: fieldValue(fields, 'modelTypeId', 'displayValue'),
    demandClassifyId: fieldValue(fields, 'demandClassify'),
    demandClassifyName: fieldValue(fields, 'demandClassify', 'displayValue'),
    parentId: fieldValue(fields, 'parentId'),
    assignId: fieldValue(fields, 'assignId'),
    createUser: fieldValue(fields, 'createUser'),
    createUserName: fieldValue(fields, 'createUser', 'displayValue'),
    createTime: fieldValue(fields, 'createTime'),
    updateUser: fieldValue(fields, 'updateUser'),
    updateUserName: fieldValue(fields, 'updateUser', 'displayValue'),
    updateTime: fieldValue(fields, 'updateTime'),
    fileId: fieldValue(fields, 'fileId'),
    deleted: data.delete === true,
    follow: booleanValue(fieldValue(fields, 'follow')),
    finished: booleanValue(fieldValue(fields, 'finished')),
    expired: booleanValue(fieldValue(fields, 'expired')),
    dispatch: fieldValue(fields, 'dispatch'),
    dispatchName: fieldValue(fields, 'dispatch', 'displayValue'),
    files: Array.isArray(data.files) ? data.files.map(normalizeFile) : [],
    fields,
  };
}

export function normalizeDemandComment(raw) {
  const comment = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
  return {
    id: stringValue(comment.id),
    projectId: stringValue(comment.projectId),
    issueId: stringValue(comment.issueId),
    parentId: stringValue(comment.parentId),
    createUser: stringValue(comment.createUser),
    createTime: stringValue(comment.createTime),
    commentHtml: stringValue(comment.comment),
    nodeId: stringValue(comment.nodeId),
    nodeName: stringValue(comment.nodeName),
    nextId: stringValue(comment.nextId),
    nextName: stringValue(comment.nextName),
    assignProjectId: stringValue(comment.assignProjectId),
    children: Array.isArray(comment.children)
      ? comment.children.map(normalizeDemandComment)
      : [],
  };
}

export function normalizeDemandComments(data) {
  if (!Array.isArray(data)) throw new Error('CTeam demand comments response data must be an array');
  return data.map(normalizeDemandComment);
}

function imageFileId(url) {
  const match = /\/file\/([^/]+)\/download\/([^/?#]+)/u.exec(url);
  if (match === null) return { projectId: '', fileId: '' };
  return {
    projectId: decodeURIComponent(match[1]),
    fileId: decodeURIComponent(match[2]),
  };
}

function pushImage(images, source, sourceId, alt, url) {
  const ids = imageFileId(url);
  images.push({
    source,
    sourceId,
    index: images.length,
    alt: stringValue(alt),
    url: stringValue(url),
    projectId: ids.projectId,
    fileId: ids.fileId,
    downloaded: false,
    localPath: '',
    contentType: '',
    bytes: 0,
    dataUrl: '',
  });
}

export function extractDemandImages(demand, comments = []) {
  const images = [];

  function extractFromText(source, sourceId, text) {
    const value = stringValue(text);
    for (const match of value.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
      pushImage(images, source, sourceId, match[1], match[2]);
    }
    for (const match of value.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)) {
      const altMatch = /\balt=["']([^"']*)["']/iu.exec(match[0]);
      pushImage(images, source, sourceId, altMatch?.[1] ?? '', match[1]);
    }
  }

  extractFromText('description', demand.id, demand.desc);
  for (const comment of comments) {
    extractFromText('comment', comment.id, comment.commentHtml);
  }
  return images;
}
