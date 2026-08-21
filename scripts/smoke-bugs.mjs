import path from 'node:path';
import { resolveProjectId } from '../src/categories.js';
import {
  buildIssueFilterBody,
  normalizeIssuePage,
} from '../src/issues.js';
import {
  fetchIssueList,
  resolveLoginConfigPath,
} from '../src/cteam-client.js';

const [projectUrl, configuredLoginPath] = process.argv.slice(2);
if (!projectUrl) {
  process.stderr.write('Usage: node scripts/smoke-bugs.mjs <project-url> [login-config-path]\n');
  process.exit(2);
}

const projectId = resolveProjectId({ projectUrl });
const loginConfigPath = resolveLoginConfigPath(configuredLoginPath, process.cwd());
const filters = buildIssueFilterBody({ categoryId: undefined, filters: [] });
const data = await fetchIssueList({
  projectId,
  issueType: 'BUG',
  loginConfigPath: path.resolve(loginConfigPath),
  page: 1,
  pageSize: 5,
  remember: false,
  filters,
  timeoutMs: 20_000,
});
const page = normalizeIssuePage(data);
process.stdout.write(`${JSON.stringify({
  projectId,
  issueType: 'BUG',
  page: page.page,
  pageSize: page.pageSize,
  totalElements: page.totalElements,
  totalPages: page.totalPages,
  returned: page.issues.length,
  bugs: page.issues.map((issue) => ({
    id: issue.id,
    number: issue.number,
    title: issue.title,
    priority: issue.priorityName,
    state: issue.stateName,
  })),
}, null, 2)}\n`);
