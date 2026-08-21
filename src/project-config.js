import fs from 'node:fs';
import path from 'node:path';
import {
  loginConfigPathCandidates,
  packageLocalConfigPath,
  projectLocalConfigPath,
  readCteamLocalConfig,
} from './cteam-client.js';
import { sessionCwd, stringOption } from './common.js';

const PROJECT_ID_HINT_URL_PATTERN = /\/(?:vteam|toc)\/([^/?#]+)/u;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function resolveDefaultProjectId(config = {}, exec) {
  const configuredProjectId = stringOption(config.projectId, 'projectId');
  if (configuredProjectId) return configuredProjectId;

  const candidates = loginConfigPathCandidates(
    config.loginConfigPath,
    sessionCwd(exec),
  );
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const localConfig = readCteamLocalConfig(candidate);
    const projectId = stringOption(localConfig.projectId, 'projectId');
    if (projectId) return projectId;
  }
  return undefined;
}

function readLocalConfigIfExists(configPath) {
  if (!fs.existsSync(configPath)) return {};
  return readCteamLocalConfig(configPath);
}

function writeLocalConfig(configPath, value) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(configPath, content, 'utf8');
}

function rememberTargetPath(exec) {
  const cwd = sessionCwd(exec);
  if (cwd) return projectLocalConfigPath(cwd);
  return packageLocalConfigPath();
}

export function rememberDefaultProjectId(projectId, config = {}, exec) {
  const resolvedProjectId = stringOption(projectId, 'projectId');
  if (!resolvedProjectId) return undefined;
  if (!PROJECT_ID_PATTERN.test(resolvedProjectId)) {
    throw new Error('projectId contains unsupported characters');
  }
  const configPath = rememberTargetPath(exec);
  const localConfig = readLocalConfigIfExists(configPath);
  if (localConfig.projectId === resolvedProjectId) return configPath;
  writeLocalConfig(configPath, {
    ...localConfig,
    projectId: resolvedProjectId,
  });
  return configPath;
}

function hasProjectUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return PROJECT_ID_HINT_URL_PATTERN.test(url.pathname);
  } catch {
    return false;
  }
}

export function argumentsIncludeProjectHint(args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return false;
  if (stringOption(args.project_id, 'project_id')) return true;
  return ['project_url', 'demand_url', 'issue_url', 'wiki_url'].some((key) => hasProjectUrl(args[key]));
}

export function rememberProjectIdFromArgs(args, projectId, config = {}, exec) {
  if (!argumentsIncludeProjectHint(args)) return undefined;
  return rememberDefaultProjectId(projectId, config, exec);
}
