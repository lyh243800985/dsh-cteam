const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function optionalString(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

export function resolveProjectId({ projectUrl, projectId, configuredProjectId }) {
  const explicit = optionalString(projectId, 'project_id');
  const sourceUrl = optionalString(projectUrl, 'project_url');
  const configured = optionalString(configuredProjectId, 'configured_project_id');
  let parsed;

  if (configured !== undefined && !PROJECT_ID_PATTERN.test(configured)) {
    throw new Error('configured_project_id contains unsupported characters');
  }

  if (sourceUrl !== undefined) {
    let url;
    try {
      url = new URL(sourceUrl);
    } catch {
      throw new Error('project_url must be a valid URL');
    }
    const match = /\/vteam\/([^/?#]+)/u.exec(url.pathname);
    if (match === null) {
      throw new Error('project_url must contain /vteam/{projectId}/');
    }
    parsed = decodeURIComponent(match[1]);
  }

  if (explicit !== undefined && parsed !== undefined && explicit !== parsed) {
    throw new Error(`project_id "${explicit}" does not match project_url project "${parsed}"`);
  }
  if (explicit === undefined && parsed === undefined && configured === undefined) {
    throw new Error('provide project_url or project_id, or configure projectId in the dsh-cteam plugin config, project local/local.json, legacy project .ops-local/cw-browser-login.json, or package local/local.json');
  }

  const resolved = explicit ?? parsed ?? configured;
  if (!PROJECT_ID_PATTERN.test(resolved)) {
    throw new Error('project_id contains unsupported characters');
  }
  return resolved;
}

function normalizeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeSort(value) {
  return Number.isFinite(value) ? value : 0;
}

export function flattenCategoryTree(tree) {
  if (!Array.isArray(tree)) throw new Error('CTeam category response data must be an array');
  const nodes = [];
  const ids = new Set();

  function visit(items, depth, inheritedParentId, parentPath) {
    for (const raw of items) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('CTeam category node must be an object');
      }
      if (typeof raw.id !== 'string' || !raw.id) {
        throw new Error('CTeam category node is missing id');
      }
      if (ids.has(raw.id)) throw new Error(`duplicate CTeam category id: ${raw.id}`);
      ids.add(raw.id);

      const name = typeof raw.name === 'string' && raw.name ? raw.name : '(unnamed)';
      const parentId = typeof raw.parentId === 'string' && raw.parentId
        ? raw.parentId
        : inheritedParentId;
      const path = [...parentPath, name];
      const children = Array.isArray(raw.children) ? raw.children : [];

      nodes.push({
        id: raw.id,
        parentId,
        name,
        count: normalizeCount(raw.count),
        sort: normalizeSort(raw.sort),
        depth,
        childCount: children.length,
        path,
      });
      visit(children, depth + 1, raw.id, path);
    }
  }

  visit(tree, 0, '', []);
  return nodes;
}

function parseLimit(value) {
  if (value === undefined || value === null) return 200;
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new Error('limit must be an integer between 1 and 500');
  }
  return value;
}

export function selectCategoryNodes(nodes, options = {}) {
  const parentId = optionalString(options.parentId, 'parent_id');
  const query = optionalString(options.query, 'query');
  const includeDescendants = options.includeDescendants === true;
  const limit = parseLimit(options.limit);
  let mode;
  let matches;

  if (query !== undefined) {
    const needle = query.toLocaleLowerCase();
    mode = 'search';
    matches = nodes.filter((node) => {
      return node.name.toLocaleLowerCase().includes(needle)
        || node.path.join(' / ').toLocaleLowerCase().includes(needle);
    });
  } else if (parentId !== undefined) {
    const parentIndex = nodes.findIndex((node) => node.id === parentId);
    if (parentIndex === -1) throw new Error(`category parent_id not found: ${parentId}`);
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

export function parseToolArguments(args, options = {}) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('tool arguments must be an object');
  }
  return {
    projectId: resolveProjectId({
      projectUrl: args.project_url,
      projectId: args.project_id,
      configuredProjectId: options.configuredProjectId,
    }),
    parentId: optionalString(args.parent_id, 'parent_id'),
    query: optionalString(args.query, 'query'),
    includeDescendants: args.include_descendants === true,
    limit: parseLimit(args.limit),
  };
}
