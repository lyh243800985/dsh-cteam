import path from 'node:path';
import { resolveProjectId } from '../src/categories.js';
import {
  buildDemandFilterBody,
  normalizeDemandPage,
} from '../src/demands.js';
import {
  fetchDemandList,
  resolveLoginConfigPath,
} from '../src/cteam-client.js';

const [projectUrl, categoryId, configuredLoginPath] = process.argv.slice(2);
if (!projectUrl || !categoryId) {
  process.stderr.write('Usage: node scripts/smoke-demands.mjs <project-url> <category-id> [login-config-path]\n');
  process.exit(2);
}

const projectId = resolveProjectId({ projectUrl });
const loginConfigPath = resolveLoginConfigPath(configuredLoginPath, process.cwd());
const filters = buildDemandFilterBody({ categoryId, filters: [] });
const data = await fetchDemandList({
  projectId,
  loginConfigPath: path.resolve(loginConfigPath),
  page: 1,
  pageSize: 20,
  remember: false,
  filters,
  timeoutMs: 20_000,
});
const page = normalizeDemandPage(data);
process.stdout.write(`${JSON.stringify({
  projectId,
  categoryId,
  page: page.page,
  pageSize: page.pageSize,
  totalElements: page.totalElements,
  totalPages: page.totalPages,
  returned: page.demands.length,
  demands: page.demands.map((demand) => ({
    id: demand.id,
    number: demand.number,
    title: demand.title,
    priority: demand.priorityName,
    state: demand.stateName,
  })),
}, null, 2)}\n`);
