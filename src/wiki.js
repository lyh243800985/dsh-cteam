import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectId } from './categories.js';

const WIKI_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const WIKI_IMPORT_MEMORY_VERSION = 1;

function optionalString(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

function requiredWikiId(value, name) {
  const id = optionalString(value, name);
  if (id === undefined) throw new Error(`${name} is required`);
  if (!WIKI_ID_PATTERN.test(id)) throw new Error(`${name} contains unsupported characters`);
  return id;
}

function positiveInteger(value, name, defaultValue, maximum) {
  if (value === undefined || value === null) return defaultValue;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function booleanOption(value, defaultValue, name) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

export function parseWikiUrl(wikiUrl) {
  const sourceUrl = optionalString(wikiUrl, 'wiki_url');
  if (sourceUrl === undefined) return {};
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error('wiki_url must be a valid URL');
  }
  const projectMatch = /\/toc\/([^/?#]+)\/wiki\/lib\//u.exec(url.pathname);
  const libraryMatch = /\/wiki\/lib\/([^/?#]+)\//u.exec(url.pathname);
  const wikiMatch = /\/(?:list|edit|version)\/([^/?#]+)$/u.exec(url.pathname);
  return {
    projectId: projectMatch ? decodeURIComponent(projectMatch[1]) : undefined,
    libraryId: libraryMatch ? decodeURIComponent(libraryMatch[1]) : undefined,
    wikiId: wikiMatch ? decodeURIComponent(wikiMatch[1]) : undefined,
  };
}

function resolveWikiProjectId(args, options, parsedUrl) {
  const configuredProjectId = options.configuredProjectId;
  const explicitProjectId = optionalString(args.project_id, 'project_id');
  if (explicitProjectId !== undefined && parsedUrl.projectId !== undefined && explicitProjectId !== parsedUrl.projectId) {
    throw new Error(`project_id "${explicitProjectId}" does not match wiki_url project "${parsedUrl.projectId}"`);
  }
  if (explicitProjectId !== undefined || parsedUrl.projectId !== undefined) {
    return explicitProjectId ?? parsedUrl.projectId;
  }
  return resolveProjectId({ configuredProjectId });
}

function resolveLibraryId(args, parsedUrl) {
  const explicit = optionalString(args.library_id, 'library_id');
  if (explicit !== undefined && parsedUrl.libraryId !== undefined && explicit !== parsedUrl.libraryId) {
    throw new Error(`library_id "${explicit}" does not match wiki_url library "${parsedUrl.libraryId}"`);
  }
  const libraryId = explicit ?? parsedUrl.libraryId;
  return libraryId === undefined ? undefined : requiredWikiId(libraryId, 'library_id');
}

function resolveWikiId(args, parsedUrl) {
  const explicit = optionalString(args.wiki_id, 'wiki_id');
  if (explicit !== undefined && parsedUrl.wikiId !== undefined && explicit !== parsedUrl.wikiId) {
    throw new Error(`wiki_id "${explicit}" does not match wiki_url wiki "${parsedUrl.wikiId}"`);
  }
  return requiredWikiId(explicit ?? parsedUrl.wikiId, 'wiki_id');
}

export function parseWikiTreeToolArguments(args, options = {}) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('tool arguments must be an object');
  }
  const parsedUrl = parseWikiUrl(args.wiki_url);
  const projectId = resolveWikiProjectId(args, options, parsedUrl);
  const explicitParentId = optionalString(args.parent_id, 'parent_id');
  const query = optionalString(args.query, 'query');
  return {
    projectId,
    libraryId: resolveLibraryId(args, parsedUrl),
    parentId: explicitParentId,
    query,
    includeDescendants: booleanOption(args.include_descendants, false, 'include_descendants'),
    limit: positiveInteger(args.limit, 'limit', 200, 1000),
  };
}

export function parseWikiDetailToolArguments(args, options = {}) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('tool arguments must be an object');
  }
  const parsedUrl = parseWikiUrl(args.wiki_url);
  const projectId = resolveWikiProjectId(args, options, parsedUrl);
  return {
    projectId,
    libraryId: resolveLibraryId(args, parsedUrl),
    wikiId: resolveWikiId(args, parsedUrl),
  };
}

export function parseWikiImportToolArguments(args, options = {}) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('tool arguments must be an object');
  }
  const parsedUrl = parseWikiUrl(args.wiki_url);
  const projectId = resolveWikiProjectId(args, options, parsedUrl);
  const markdown = optionalString(args.markdown, 'markdown');
  const markdownFilePath = optionalString(args.markdown_file_path, 'markdown_file_path');
  const useLastTarget = booleanOption(args.use_last_target, false, 'use_last_target');
  if ((markdown === undefined) === (markdownFilePath === undefined)) {
    throw new Error('provide exactly one of markdown or markdown_file_path');
  }
  const explicitParent = args.parent_id ?? parsedUrl.wikiId;
  if (!useLastTarget && (explicitParent === undefined || explicitParent === null || explicitParent === '')) {
    throw new Error('parent_id is required unless use_last_target is true');
  }
  return {
    projectId,
    libraryId: resolveLibraryId(args, parsedUrl),
    parentId: explicitParent === undefined || explicitParent === null || explicitParent === ''
      ? undefined
      : requiredWikiId(explicitParent, 'parent_id'),
    useLastTarget,
    markdown,
    markdownFilePath,
    filename: optionalString(args.filename, 'filename') ?? 'import.md',
    dryRun: booleanOption(args.dry_run, false, 'dry_run'),
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

function numberValue(value) {
  return Number.isFinite(value) ? value : 0;
}

export function normalizeWikiNode(raw, depth = 0, inheritedParentId = '', parentPath = []) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('CTeam wiki node must be an object');
  }
  const id = stringValue(raw.id);
  if (!id) throw new Error('CTeam wiki node is missing id');
  const title = stringValue(raw.title || raw.name || '(untitled)');
  const parentId = stringValue(raw.parentId) || inheritedParentId;
  const children = Array.isArray(raw.children) ? raw.children : [];
  const path = [...parentPath, title];
  return {
    id,
    libraryId: stringValue(raw.docLibraryId || raw.libraryId),
    parentId,
    title,
    visitLimit: stringValue(raw.visitLimit),
    levelPath: stringValue(raw.levelPath),
    classify: stringValue(raw.classify),
    sort: numberValue(raw.sort),
    createdBy: stringValue(raw.createdBy),
    createdTime: stringValue(raw.createdTime),
    follow: raw.follow === true,
    permissions: Array.isArray(raw.permissions) ? raw.permissions.map(stringValue) : [],
    depth,
    childCount: children.length,
    path,
  };
}

export function flattenWikiTree(tree) {
  if (!Array.isArray(tree)) throw new Error('CTeam wiki tree response data must be an array');
  const nodes = [];
  const ids = new Set();
  function visit(items, depth, inheritedParentId, parentPath) {
    for (const raw of items) {
      const node = normalizeWikiNode(raw, depth, inheritedParentId, parentPath);
      if (ids.has(node.id)) throw new Error(`duplicate CTeam wiki id: ${node.id}`);
      ids.add(node.id);
      nodes.push(node);
      visit(Array.isArray(raw.children) ? raw.children : [], depth + 1, node.id, node.path);
    }
  }
  visit(tree, 0, '', []);
  return nodes;
}

export function selectWikiNodes(nodes, options = {}) {
  const parentId = optionalString(options.parentId, 'parent_id');
  const query = optionalString(options.query, 'query');
  const includeDescendants = options.includeDescendants === true;
  const limit = positiveInteger(options.limit, 'limit', 200, 1000);
  let mode;
  let matches;
  if (query !== undefined) {
    const needle = query.toLocaleLowerCase();
    mode = 'search';
    matches = nodes.filter((node) => {
      return node.title.toLocaleLowerCase().includes(needle)
        || node.path.join(' / ').toLocaleLowerCase().includes(needle);
    });
  } else if (parentId !== undefined) {
    const parentIndex = nodes.findIndex((node) => node.id === parentId);
    if (parentIndex === -1) throw new Error(`wiki parent_id not found: ${parentId}`);
    const parent = nodes[parentIndex];
    if (includeDescendants) {
      mode = 'subtree';
      matches = [];
      for (let index = parentIndex + 1; index < nodes.length; index += 1) {
        if (nodes[index].depth <= parent.depth) break;
        matches.push(nodes[index]);
      }
    } else {
      mode = 'children';
      matches = nodes.filter((node) => node.parentId === parentId);
    }
  } else {
    mode = 'roots';
    matches = nodes.filter((node) => node.depth === 0);
  }
  return {
    mode,
    matchedNodes: matches.length,
    truncated: matches.length > limit,
    nodes: matches.slice(0, limit),
  };
}

export function normalizeWikiDetail(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('CTeam wiki detail response data must be an object');
  }
  return {
    id: stringValue(raw.id),
    libraryId: stringValue(raw.docLibraryId || raw.libraryId),
    parentId: stringValue(raw.parentId),
    title: stringValue(raw.title),
    content: stringValue(raw.content),
    editor: raw.editor === true,
    visitLimit: stringValue(raw.visitLimit),
    levelPath: stringValue(raw.levelPath),
    classify: stringValue(raw.classify),
    version: Number.isInteger(raw.version) ? raw.version : 0,
    pageview: Number.isInteger(raw.pageview) ? raw.pageview : 0,
    createUser: stringValue(raw.createUser || raw.createdBy),
    createTime: stringValue(raw.createTime || raw.createdTime),
    updatedUser: stringValue(raw.updatedUser),
    updatedTime: stringValue(raw.updatedTime),
    permissions: Array.isArray(raw.permissions) ? raw.permissions.map(stringValue) : [],
    classifyList: Array.isArray(raw.classifyList) ? raw.classifyList.map(stringValue) : [],
    fileList: Array.isArray(raw.fileList) ? raw.fileList : [],
  };
}

export function wikiConsoleUrl(baseUrl, projectId, libraryId, wikiId) {
  return new URL(
    `/devops/console/toc/${encodeURIComponent(projectId)}/wiki/lib/${encodeURIComponent(libraryId)}/docManWiki/list/${encodeURIComponent(wikiId)}`,
    baseUrl,
  ).toString();
}

export function wikiImportMemoryFile(cwd = process.cwd()) {
  return path.join(cwd, '.temp', 'dsh-cteam', 'wiki-import-last.json');
}

function wikiImportMemoryKey(projectId, libraryId) {
  return `${projectId}:${libraryId}`;
}

function readWikiImportMemoryFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed;
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

function normalizeWikiImportTarget(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const projectId = stringValue(value.projectId);
  const libraryId = stringValue(value.libraryId);
  const parentId = stringValue(value.parentId);
  if (!projectId || !libraryId || !parentId) return undefined;
  return {
    version: WIKI_IMPORT_MEMORY_VERSION,
    projectId,
    libraryId,
    parentId,
    title: stringValue(value.title),
    path: Array.isArray(value.path) ? value.path.map(stringValue).filter(Boolean) : [],
    wikiUrl: stringValue(value.wikiUrl),
    savedAt: Number.isFinite(value.savedAt) ? value.savedAt : 0,
  };
}

export function getLastWikiImportTarget(cwd, projectId, libraryId) {
  const memory = readWikiImportMemoryFile(wikiImportMemoryFile(cwd));
  return normalizeWikiImportTarget(memory[wikiImportMemoryKey(projectId, libraryId)]);
}

export function saveLastWikiImportTarget(cwd, target) {
  const normalized = normalizeWikiImportTarget({
    ...target,
    savedAt: Date.now(),
  });
  if (normalized === undefined) throw new Error('invalid wiki import target memory');
  const filePath = wikiImportMemoryFile(cwd);
  const memory = readWikiImportMemoryFile(filePath);
  memory[wikiImportMemoryKey(normalized.projectId, normalized.libraryId)] = normalized;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(memory, null, 2)}\n`, 'utf8');
  return normalized;
}

export function wikiImportTargetFromNode(node, baseUrl, projectId, libraryId) {
  return normalizeWikiImportTarget({
    projectId,
    libraryId,
    parentId: node.id,
    title: node.title,
    path: node.path,
    wikiUrl: wikiConsoleUrl(baseUrl, projectId, libraryId, node.id),
  });
}
