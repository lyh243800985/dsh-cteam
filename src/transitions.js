import { parseDemandDetailToolArguments } from './details.js';
import { parseIssueListToolArguments } from './issues.js';

const OPTION_FIELD_TYPES = new Set([
  'CHECKBOX',
  'MULTI_SELECT',
  'RADIO',
  'SELECT',
  'USER',
]);

function optionalString(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

function positiveInteger(value, name, defaultValue, maximum) {
  if (value === undefined || value === null) return defaultValue;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function booleanArgument(value, name, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
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

function issueTypeFromUrl(value) {
  const issueUrl = optionalString(value, 'issue_url');
  if (issueUrl === undefined) return undefined;
  let url;
  try {
    url = new URL(issueUrl);
  } catch {
    return undefined;
  }
  if (/\/twBug(?:\/|$)/iu.test(url.pathname)) return 'BUG';
  if (/\/twDemand(?:\/|$)/iu.test(url.pathname)) return 'DEMAND';
  if (/\/twTask(?:\/|$)/iu.test(url.pathname)) return 'TASK';
  return undefined;
}

export function parseIssueTransitionToolArguments(args, options = {}) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('tool arguments must be an object');
  }
  const detail = parseDemandDetailToolArguments(args, {
    configuredProjectId: options.configuredProjectId,
  });
  const inferredIssueType = issueTypeFromUrl(args.issue_url ?? args.demand_url);
  const issue = parseIssueListToolArguments({
    project_id: detail.projectId,
    issue_type: args.issue_type ?? inferredIssueType,
    page: 1,
    page_size: 1,
  }, {
    configuredProjectId: options.configuredProjectId,
    defaultIssueType: options.defaultIssueType ?? 'BUG',
  });
  return {
    projectId: detail.projectId,
    issueId: detail.issueId,
    issueType: issue.issueType,
    includeFieldOptions: booleanArgument(args.include_field_options, 'include_field_options', true),
    optionLimit: positiveInteger(args.option_limit, 'option_limit', 50, 500),
  };
}

export function normalizeTransitionNode(raw, currentStateId = '') {
  const node = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
  const id = stringValue(node.id ?? node.nodeId ?? node.stateId ?? node.value);
  return {
    id,
    name: stringValue(node.name ?? node.label ?? node.displayValue),
    operation: node.operation === true,
    current: id !== '' && id === currentStateId,
    changed: node.changed === true,
    sort: Number.isFinite(node.sort) ? node.sort : 0,
  };
}

export function normalizeTransitionNodes(data, currentStateId = '') {
  const body = typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {};
  const nodes = Array.isArray(body.data) ? body.data : Array.isArray(data) ? data : [];
  return {
    changed: body.changed === true,
    nodes: nodes.map((node) => normalizeTransitionNode(node, currentStateId)),
  };
}

export function normalizeTransitionField(raw) {
  const field = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
  const name = stringValue(field.name);
  const id = stringValue(field.id) || name;
  return {
    id,
    name,
    label: stringValue(field.label) || name,
    type: stringValue(field.type).toLocaleUpperCase(),
    source: stringValue(field.source),
    value: stringValue(field.value),
    displayValue: stringValue(field.displayValue),
    editable: field.editable === true,
    required: field.required === true,
    flowField: field.flowField === true,
    optionLookupKey: id || name,
    options: [],
    optionsTruncated: false,
  };
}

export function normalizeTransitionFields(data) {
  if (!Array.isArray(data)) throw new Error('CTeam transition fields response data must be an array');
  return data.map(normalizeTransitionField);
}

export function normalizeCandidate(raw) {
  const candidate = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
  return {
    value: stringValue(candidate.first ?? candidate.value ?? candidate.id ?? candidate.username),
    displayValue: stringValue(candidate.second ?? candidate.displayValue ?? candidate.name),
  };
}

export function normalizeTransitionCandidates(data) {
  const body = typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {};
  return {
    users: Array.isArray(body.users) ? body.users.map(normalizeCandidate) : [],
    roles: Array.isArray(body.roles) ? body.roles.map(normalizeCandidate) : [],
  };
}

export function normalizeFieldOption(raw) {
  const option = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
  const value = stringValue(option.value ?? option.id ?? option.first ?? option.name);
  return {
    value,
    displayValue: stringValue(option.displayValue ?? option.label ?? option.second ?? option.name) || value,
  };
}

export function normalizeFieldOptions(data, limit) {
  const options = Array.isArray(data) ? data.map(normalizeFieldOption) : [];
  return {
    options: options.slice(0, limit),
    truncated: options.length > limit,
    total: options.length,
  };
}

export function shouldFetchFieldOptions(field) {
  return field.optionLookupKey !== '' && OPTION_FIELD_TYPES.has(field.type);
}

export function buildTransitionSubmitExample(input, node) {
  const fields = node.fields.filter((field) => field.required && field.name !== 'operator_user');
  return {
    method: 'POST',
    path: `/ms/vteam/api/user/issue_direction/${input.projectId}/next`,
    body: {
      issueId: input.issueId,
      nextNodeId: node.id,
      comment: {
        atUser: [],
        comment: '',
      },
      directionFields: fields.map((field) => ({
        fieldId: field.id,
        value: `<${field.label || field.name}>`,
      })),
      operators: node.fields.some((field) => field.required && field.name === 'operator_user')
        ? ['<operator username>']
        : [],
    },
    notes: [
      'operator_user is submitted through operators, not directionFields.',
      'Required non-operator fields are submitted as directionFields with fieldId and value.',
      'The plugin exposes this as read-only discovery; do not POST without explicit user confirmation.',
    ],
  };
}
