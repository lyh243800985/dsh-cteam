export const PROJECT_PARAMETER_DESCRIPTION = 'Optional. If omitted, uses the default projectId from the dsh-cteam plugin config, project local/local.json, legacy project .ops-local/cw-browser-login.json, or package local/local.json; explicit project_id or a project_url /vteam/{projectId}/ can select another project.';
export const PROJECT_ID_PARAMETER_DESCRIPTION = 'Optional project ID. Overrides the configured/local default projectId; when project_url is also provided, both must identify the same project.';

export function sessionCwd(exec) {
  const cwd = exec.agent?.session?.header?.cwd;
  return typeof cwd === 'string' ? cwd : undefined;
}

export function booleanOption(value, defaultValue, name = 'dry_run') {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

export function stringOption(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  return value.trim() || undefined;
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function errorDetails(error) {
  if (!(error instanceof Error)) return {};
  return {
    ...(error.status !== undefined ? { status: error.status } : {}),
    ...(error.code !== undefined ? { code: error.code } : {}),
    ...(error.traceId !== undefined ? { traceId: error.traceId } : {}),
    ...(error.payload !== undefined ? { payload: error.payload } : {}),
  };
}

export function safePathPart(value, fallback) {
  const normalized = String(value || fallback).replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(/^-+|-+$/gu, '');
  return normalized || fallback;
}
