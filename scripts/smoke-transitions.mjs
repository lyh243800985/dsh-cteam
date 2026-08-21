import path from 'node:path';
import { resolveProjectId } from '../src/categories.js';
import { normalizeDemandDetail } from '../src/details.js';
import {
  createAuthenticatedSession,
  fetchIssueDetailWithComments,
  fetchIssueFieldOptions,
  fetchIssueTransitionCandidates,
  fetchIssueTransitionFields,
  fetchIssueTransitionNodes,
  resolveLoginConfigPath,
} from '../src/cteam-client.js';
import {
  buildTransitionSubmitExample,
  normalizeFieldOptions,
  normalizeTransitionCandidates,
  normalizeTransitionFields,
  normalizeTransitionNodes,
  shouldFetchFieldOptions,
} from '../src/transitions.js';

const [projectUrl, issueId, issueTypeOrLoginPath, loginPathArg] = process.argv.slice(2);
if (!projectUrl || !issueId) {
  process.stderr.write('Usage: node scripts/smoke-transitions.mjs <project-url> <issue-id> [issue-type|login-config-path] [login-config-path]\n');
  process.exit(2);
}

const projectId = resolveProjectId({ projectUrl });
const issueTypes = new Set(['DEMAND', 'BUG', 'TASK']);
const maybeIssueType = (issueTypeOrLoginPath || '').toLocaleUpperCase();
const issueType = issueTypes.has(maybeIssueType) ? maybeIssueType : 'BUG';
const configuredLoginPath = issueTypes.has(maybeIssueType) ? loginPathArg : issueTypeOrLoginPath;
const loginConfigPath = path.resolve(resolveLoginConfigPath(configuredLoginPath, process.cwd()));
const baseOptions = {
  projectId,
  issueId,
  issueType,
  loginConfigPath,
  timeoutMs: 20_000,
};
const session = await createAuthenticatedSession(baseOptions);
const [detailData, rawNodes] = await Promise.all([
  fetchIssueDetailWithComments({ ...baseOptions, session }),
  fetchIssueTransitionNodes({ ...baseOptions, session }),
]);
const issue = normalizeDemandDetail(detailData.detail);
const normalizedNodes = normalizeTransitionNodes(rawNodes, issue.stateId);
const optionCache = new Map();
const transitions = [];

for (const node of normalizedNodes.nodes) {
  const [fieldData, candidateData] = await Promise.all([
    fetchIssueTransitionFields({ ...baseOptions, session, nextNodeId: node.id }),
    fetchIssueTransitionCandidates({ ...baseOptions, session, nextNodeId: node.id }),
  ]);
  const candidates = normalizeTransitionCandidates(candidateData);
  const fields = [];
  for (const field of normalizeTransitionFields(fieldData)) {
    let optionSummary = { total: 0, options: [], truncated: false };
    if (shouldFetchFieldOptions(field)) {
      if (!optionCache.has(field.optionLookupKey)) {
        optionCache.set(field.optionLookupKey, fetchIssueFieldOptions({
          ...baseOptions,
          session,
          fieldIdOrName: field.optionLookupKey,
        }));
      }
      optionSummary = normalizeFieldOptions(await optionCache.get(field.optionLookupKey), 10);
    }
    fields.push({
      id: field.id,
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required,
      optionTotal: optionSummary.total,
      optionSamples: optionSummary.options,
    });
  }
  transitions.push({
    id: node.id,
    name: node.name,
    operation: node.operation,
    current: node.current,
    users: candidates.users.length,
    roles: candidates.roles.length,
    requiredFields: fields.filter((field) => field.required),
    submitExample: buildTransitionSubmitExample({ projectId, issueId }, { ...node, fields }),
  });
}

process.stdout.write(`${JSON.stringify({
  projectId,
  issueType,
  id: issue.id,
  number: issue.number,
  title: issue.title,
  currentState: {
    id: issue.stateId,
    name: issue.stateName,
  },
  changed: normalizedNodes.changed,
  transitions,
}, null, 2)}\n`);
