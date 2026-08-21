import path from 'node:path';
import { resolveProjectId } from '../src/categories.js';
import {
  extractDemandImages,
  normalizeDemandComments,
  normalizeDemandDetail,
} from '../src/details.js';
import {
  downloadDemandImages,
  fetchIssueDetailWithComments,
  resolveLoginConfigPath,
} from '../src/cteam-client.js';

const [projectUrl, issueId, issueTypeOrLoginPath, loginPathArg] = process.argv.slice(2);
if (!projectUrl || !issueId) {
  process.stderr.write('Usage: node scripts/smoke-issue-detail.mjs <project-url> <issue-id> [issue-type|login-config-path] [login-config-path]\n');
  process.exit(2);
}

const projectId = resolveProjectId({ projectUrl });
const issueTypes = new Set(['DEMAND', 'BUG', 'TASK']);
const maybeIssueType = (issueTypeOrLoginPath || '').toLocaleUpperCase();
const issueType = issueTypes.has(maybeIssueType) ? maybeIssueType : 'DEMAND';
const configuredLoginPath = issueTypes.has(maybeIssueType) ? loginPathArg : issueTypeOrLoginPath;
const loginConfigPath = resolveLoginConfigPath(configuredLoginPath, process.cwd());
const data = await fetchIssueDetailWithComments({
  projectId,
  issueId,
  loginConfigPath: path.resolve(loginConfigPath),
  timeoutMs: 20_000,
});
const issue = normalizeDemandDetail(data.detail);
const comments = normalizeDemandComments(data.comments);
const foundImages = extractDemandImages(issue, comments);
const images = await downloadDemandImages({
  projectId,
  issueId,
  loginConfigPath: path.resolve(loginConfigPath),
  images: foundImages,
  outputDir: path.resolve('.temp', 'dsh-cteam', issueId),
  timeoutMs: 20_000,
});
process.stdout.write(`${JSON.stringify({
  projectId,
  issueType,
  id: issue.id,
  number: issue.number,
  title: issue.title,
  priority: issue.priorityName,
  state: issue.stateName,
  modelType: issue.modelTypeName,
  descLength: issue.desc.length,
  files: issue.files.length,
  comments: comments.length,
  images: images.length,
  downloadedImages: images.filter((image) => image.downloaded).length,
  imagePaths: images.map((image) => image.localPath).filter(Boolean),
  fieldCount: Object.keys(issue.fields).length,
}, null, 2)}\n`);
