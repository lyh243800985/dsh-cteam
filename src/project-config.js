import { readCteamLocalConfig, resolveLoginConfigPath } from './cteam-client.js';
import { sessionCwd, stringOption } from './common.js';

export function resolveDefaultProjectId(config = {}, exec) {
  const configuredProjectId = stringOption(config.projectId, 'projectId');
  if (configuredProjectId) return configuredProjectId;

  const loginConfigPath = resolveLoginConfigPath(
    config.loginConfigPath,
    sessionCwd(exec),
  );
  const localConfig = readCteamLocalConfig(loginConfigPath);
  return stringOption(localConfig.projectId, 'projectId');
}
