import path from 'node:path';
import { resolveProjectId } from '../src/categories.js';
import {
  extractDemandImages,
  normalizeDemandComments,
  normalizeDemandDetail,
} from '../src/details.js';
import {
  downloadDemandImages,
  fetchDemandDetailWithComments,
  resolveLoginConfigPath,
} from '../src/cteam-client.js';

const [projectUrl, demandId, configuredLoginPath] = process.argv.slice(2);
if (!projectUrl || !demandId) {
  process.stderr.write('Usage: node scripts/smoke-detail.mjs <project-url> <demand-id> [login-config-path]\n');
  process.exit(2);
}

const projectId = resolveProjectId({ projectUrl });
const loginConfigPath = resolveLoginConfigPath(configuredLoginPath, process.cwd());
const data = await fetchDemandDetailWithComments({
  projectId,
  issueId: demandId,
  loginConfigPath: path.resolve(loginConfigPath),
  timeoutMs: 20_000,
});
const demand = normalizeDemandDetail(data.detail);
const comments = normalizeDemandComments(data.comments);
const foundImages = extractDemandImages(demand, comments);
const images = await downloadDemandImages({
  projectId,
  issueId: demandId,
  loginConfigPath: path.resolve(loginConfigPath),
  images: foundImages,
  outputDir: path.resolve('.temp', 'dsh-cteam', demandId),
  timeoutMs: 20_000,
});
process.stdout.write(`${JSON.stringify({
  projectId,
  id: demand.id,
  number: demand.number,
  title: demand.title,
  priority: demand.priorityName,
  state: demand.stateName,
  modelType: demand.modelTypeName,
  demandClassify: demand.demandClassifyName,
  descLength: demand.desc.length,
  files: demand.files.length,
  comments: comments.length,
  images: images.length,
  downloadedImages: images.filter((image) => image.downloaded).length,
  imagePaths: images.map((image) => image.localPath).filter(Boolean),
  fieldCount: Object.keys(demand.fields).length,
}, null, 2)}\n`);
