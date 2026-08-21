import path from 'node:path';
import { resolveProjectId } from '../src/categories.js';
import {
  issueSelectType,
  normalizeIssueFiltersResult,
  normalizeQueryFilterFields,
} from '../src/issues.js';
import {
  fetchIssueFilters,
  fetchQueryFilterFields,
  resolveLoginConfigPath,
} from '../src/cteam-client.js';

const [projectUrl, issueTypeOrLoginPath, loginPathArg] = process.argv.slice(2);
if (!projectUrl) {
  process.stderr.write('Usage: node scripts/smoke-filters.mjs <project-url> [issue-type|login-config-path] [login-config-path]\n');
  process.exit(2);
}

const projectId = resolveProjectId({ projectUrl });
const issueTypes = new Set(['DEMAND', 'BUG', 'TASK']);
const maybeIssueType = (issueTypeOrLoginPath || '').toLocaleUpperCase();
const issueType = issueTypes.has(maybeIssueType) ? maybeIssueType : 'BUG';
const selectType = issueSelectType(issueType);
const configuredLoginPath = issueTypes.has(maybeIssueType) ? loginPathArg : issueTypeOrLoginPath;
const loginConfigPath = resolveLoginConfigPath(configuredLoginPath, process.cwd());
const [filterData, queryFieldData] = await Promise.all([
  fetchIssueFilters({
    projectId,
    loginConfigPath: path.resolve(loginConfigPath),
    issueType,
    type: selectType,
    timeoutMs: 20_000,
  }),
  fetchQueryFilterFields({
    projectId,
    issueType,
    loginConfigPath: path.resolve(loginConfigPath),
    timeoutMs: 20_000,
  }),
]);
const filters = normalizeIssueFiltersResult(filterData);
const queryFields = normalizeQueryFilterFields(queryFieldData);
process.stdout.write(`${JSON.stringify({
  projectId,
  issueType,
  selectType,
  quickFilters: filters.filters.length,
  personalFilters: filters.personalFilters.map((filter) => ({
    id: filter.id,
    name: filter.name,
    conditions: filter.conditions,
  })),
  teamFilters: filters.teamFilters.map((filter) => ({
    id: filter.id,
    name: filter.name,
    conditions: filter.conditions,
  })),
  queryFieldCount: queryFields.length,
  queryFields: queryFields.slice(0, 10),
}, null, 2)}\n`);
