import { resolveProjectId } from './categories.js';

export const ISSUE_CLASSIFIES = new Set(['DEMAND', 'BUG', 'TASK']);
export const ISSUE_SELECT_TYPES = {
  DEMAND: 'DEMAND_SELECT',
  BUG: 'BUG_SELECT',
  TASK: 'TASK_SELECT',
};

const RESERVED_FILTER_NAMES = new Set([
  'demandClassify',
  'exclude',
  'classify_tree_strategy',
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

function normalizeIssueClassify(value, defaultValue = 'DEMAND') {
  const classify = optionalString(value, 'issue_type') ?? defaultValue;
  const upper = classify.toLocaleUpperCase();
  if (!ISSUE_CLASSIFIES.has(upper)) {
    throw new Error('issue_type must be DEMAND, BUG, or TASK');
  }
  return upper;
}

export function issueSelectType(issueType) {
  const classify = normalizeIssueClassify(issueType, 'DEMAND');
  return ISSUE_SELECT_TYPES[classify];
}

function normalizeFilterValue(value, index, valueIndex) {
  if (!['string', 'number', 'boolean'].includes(typeof value)) {
    throw new Error(`filters[${index}].value[${valueIndex}] must be a string, number, or boolean`);
  }
  return String(value);
}

export function normalizeIssueFilters(filters, options = {}) {
  if (filters === undefined || filters === null) return [];
  if (!Array.isArray(filters)) throw new Error('filters must be an array');

  const reserved = options.reservedFilterNames ?? RESERVED_FILTER_NAMES;
  const names = new Set();
  return filters.map((filter, index) => {
    if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
      throw new Error(`filters[${index}] must be an object`);
    }
    const name = optionalString(filter.name, `filters[${index}].name`);
    if (name === undefined) throw new Error(`filters[${index}].name is required`);
    if (reserved.has(name)) throw new Error(`filter "${name}" is managed by this tool`);
    if (names.has(name)) throw new Error(`duplicate issue filter: ${name}`);
    names.add(name);
    if (!Array.isArray(filter.value)) {
      throw new Error(`filters[${index}].value must be an array`);
    }
    return {
      name,
      value: filter.value.map((value, valueIndex) => {
        return normalizeFilterValue(value, index, valueIndex);
      }),
    };
  });
}

export function parseIssueListToolArguments(args, options = {}) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('tool arguments must be an object');
  }
  if (args.remember !== undefined && typeof args.remember !== 'boolean') {
    throw new Error('remember must be a boolean');
  }
  return {
    projectId: resolveProjectId({
      projectUrl: args.project_url,
      projectId: args.project_id,
      configuredProjectId: options.configuredProjectId,
    }),
    issueType: normalizeIssueClassify(args.issue_type, options.defaultIssueType),
    categoryId: optionalString(args.category_id, 'category_id'),
    filters: normalizeIssueFilters(args.filters),
    page: positiveInteger(args.page, 'page', 1, 100_000),
    pageSize: positiveInteger(args.page_size, 'page_size', 20, 200),
    remember: args.remember === true,
  };
}

export function buildIssueFilterBody(input) {
  const filters = [];
  if (input.categoryId !== undefined) {
    filters.push({ name: 'demandClassify', value: [input.categoryId] });
  }
  filters.push(...input.filters);
  filters.push({ name: 'exclude', value: [] });
  filters.push({ name: 'classify_tree_strategy', value: ['true'] });
  return filters;
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

function normalizeField(raw, fallbackName) {
  const field = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
  return {
    name: stringValue(field.name || fallbackName),
    label: stringValue(field.label),
    type: stringValue(field.type),
    value: stringValue(field.value),
    displayValue: stringValue(field.displayValue),
  };
}

function fieldValue(fields, name, key = 'value') {
  return fields[name]?.[key] ?? '';
}

function booleanField(fields, name) {
  return fieldValue(fields, name).toLocaleLowerCase() === 'true';
}

export function normalizeIssueRecord(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('CTeam issue record must be an object');
  }
  const property = typeof raw.property === 'object' && raw.property !== null
    ? raw.property
    : {};
  const fields = {};
  for (const [name, field] of Object.entries(property)) {
    fields[name] = normalizeField(field, name);
  }
  return {
    id: fieldValue(fields, 'id'),
    number: fieldValue(fields, 'number', 'displayValue') || fieldValue(fields, 'number'),
    title: fieldValue(fields, 'title', 'displayValue') || fieldValue(fields, 'title'),
    priority: fieldValue(fields, 'priority'),
    priorityName: fieldValue(fields, 'priority', 'displayValue'),
    stateId: fieldValue(fields, 'state'),
    stateName: fieldValue(fields, 'state', 'displayValue'),
    modelTypeId: fieldValue(fields, 'modelTypeId'),
    modelTypeName: fieldValue(fields, 'modelTypeId', 'displayValue'),
    typeClassify: fieldValue(fields, 'typeClassify'),
    parentId: fieldValue(fields, 'parentId'),
    typeLogo: fieldValue(fields, 'typeLogo'),
    typeColor: fieldValue(fields, 'typeLogo', 'displayValue'),
    follow: booleanField(fields, 'follow'),
    finished: booleanField(fields, 'finished'),
    expired: booleanField(fields, 'expired'),
    dispatch: fieldValue(fields, 'dispatch'),
    dispatchName: fieldValue(fields, 'dispatch', 'displayValue'),
    fields,
  };
}

export function normalizeIssuePage(data) {
  const records = data?.records;
  if (typeof records !== 'object' || records === null || !Array.isArray(records.content)) {
    throw new Error('CTeam issue API response is missing data.records.content');
  }
  const number = Number.isInteger(records.number) && records.number >= 0 ? records.number : 0;
  const size = Number.isInteger(records.size) && records.size >= 0 ? records.size : records.content.length;
  const totalElements = Number.isInteger(records.totalElements) && records.totalElements >= 0
    ? records.totalElements
    : records.content.length;
  const totalPages = Number.isInteger(records.totalPages) && records.totalPages >= 0
    ? records.totalPages
    : (size > 0 ? Math.ceil(totalElements / size) : 0);
  return {
    page: number + 1,
    pageSize: size,
    totalElements,
    totalPages,
    first: records.first === true || number === 0,
    last: records.last === true || number + 1 >= totalPages,
    issues: records.content.map(normalizeIssueRecord),
  };
}

function parseCondition(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeIssueFilter(raw) {
  const filter = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
  return {
    id: stringValue(filter.id),
    projectId: stringValue(filter.projectId),
    name: stringValue(filter.name),
    createUser: stringValue(filter.createUser),
    createTime: stringValue(filter.createTime),
    selectType: stringValue(filter.selectType),
    sort: Number.isFinite(filter.sort) ? filter.sort : 0,
    pinned: filter.up === true,
    scope: Number.isInteger(filter.scope) ? filter.scope : -1,
    scopeName: filter.scope === 1 ? 'team' : 'personal',
    conditions: parseCondition(filter.condition),
    rawCondition: stringValue(filter.condition),
  };
}

export function normalizeIssueFiltersResult(data) {
  if (!Array.isArray(data)) throw new Error('CTeam issue filters response data must be an array');
  const filters = data.map(normalizeIssueFilter);
  return {
    filters,
    personalFilters: filters.filter((filter) => filter.scopeName === 'personal'),
    teamFilters: filters.filter((filter) => filter.scopeName === 'team'),
  };
}

export function normalizeQueryFilterField(raw) {
  const field = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
  return {
    id: stringValue(field.id),
    name: stringValue(field.name),
    label: stringValue(field.label),
    type: stringValue(field.type),
    sys: field.sys === true,
    sort: Number.isFinite(field.sort) ? field.sort : 0,
    tenantConfigurable: field.tenantConfigurable === true,
  };
}

export function normalizeQueryFilterFields(data) {
  if (!Array.isArray(data)) throw new Error('CTeam query filters response data must be an array');
  return data.map(normalizeQueryFilterField);
}
