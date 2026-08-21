import path from 'node:path';
import { flattenCategoryTree, resolveProjectId } from '../src/categories.js';
import {
  fetchDemandCategoryTree,
  resolveLoginConfigPath,
} from '../src/cteam-client.js';

const projectUrl = process.argv[2];
if (!projectUrl) {
  process.stderr.write('Usage: node scripts/smoke.mjs <project-url> [login-config-path]\n');
  process.exit(2);
}

const projectId = resolveProjectId({ projectUrl });
const loginConfigPath = resolveLoginConfigPath(process.argv[3], process.cwd());
const tree = await fetchDemandCategoryTree({
  projectId,
  loginConfigPath: path.resolve(loginConfigPath),
  timeoutMs: 20_000,
});
const nodes = flattenCategoryTree(tree);
process.stdout.write(`${JSON.stringify({
  projectId,
  rootCount: nodes.filter((node) => node.depth === 0).length,
  totalNodes: nodes.length,
  roots: nodes.filter((node) => node.depth === 0),
}, null, 2)}\n`);
