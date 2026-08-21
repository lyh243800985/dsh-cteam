import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BASE_URL = 'https://devops.cwoa.net';
export const PROJECT_LOCAL_CONFIG_NAME = path.join('local', 'local.json');
export const LEGACY_PROJECT_LOGIN_CONFIG_NAME = path.join('.ops-local', 'cw-browser-login.json');
export const PACKAGE_LOCAL_CONFIG_NAME = path.join('local', 'local.json');
export const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function packageLocalConfigPath() {
  return path.join(PACKAGE_ROOT, PACKAGE_LOCAL_CONFIG_NAME);
}

export function projectLocalConfigPath(cwd) {
  return path.join(cwd, PROJECT_LOCAL_CONFIG_NAME);
}

export function legacyProjectLoginConfigPath(cwd) {
  return path.join(cwd, LEGACY_PROJECT_LOGIN_CONFIG_NAME);
}

function cteamApiFailure(resourceName, payload) {
  const error = new Error(`CTeam ${resourceName} API failed: ${payload.message ?? `status ${payload.status}`}`);
  error.status = payload.status;
  error.code = payload.code;
  error.traceId = payload.traceId;
  error.payload = payload;
  return error;
}

function parseSetCookieHeaders(headers) {
  const cookies = [];
  for (const header of headers ?? []) {
    const parts = header.split(';').map((item) => item.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const separator = parts[0].indexOf('=');
    if (separator === -1) continue;
    const cookie = {
      name: parts[0].slice(0, separator),
      value: parts[0].slice(separator + 1),
      domain: '',
      path: '/',
      secure: false,
    };
    for (const attribute of parts.slice(1)) {
      const [rawName, ...rawValue] = attribute.split('=');
      const name = rawName.toLocaleLowerCase();
      const value = rawValue.join('=');
      if (name === 'domain') cookie.domain = value.replace(/^\./u, '').toLocaleLowerCase();
      if (name === 'path') cookie.path = value || '/';
      if (name === 'secure') cookie.secure = true;
    }
    cookies.push(cookie);
  }
  return cookies;
}

class CookieJar {
  constructor() {
    this.cookies = [];
  }

  store(urlString, setCookieHeaders) {
    const url = new URL(urlString);
    for (const cookie of parseSetCookieHeaders(setCookieHeaders)) {
      cookie.domain ||= url.hostname.toLocaleLowerCase();
      this.cookies = this.cookies.filter((current) => {
        return current.name !== cookie.name
          || current.domain !== cookie.domain
          || current.path !== cookie.path;
      });
      this.cookies.push(cookie);
    }
  }

  header(urlString) {
    const url = new URL(urlString);
    const hostname = url.hostname.toLocaleLowerCase();
    return this.cookies
      .filter((cookie) => {
        const domain = cookie.domain.replace(/^\./u, '').toLocaleLowerCase();
        const domainMatches = hostname === domain || hostname.endsWith(`.${domain}`);
        return domainMatches
          && url.pathname.startsWith(cookie.path || '/')
          && (!cookie.secure || url.protocol === 'https:');
      })
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }
}

function request(urlString, options = {}) {
  const url = new URL(urlString);
  const body = options.body ?? '';
  const headers = { ...(options.headers ?? {}) };
  if (body) headers['Content-Length'] = Buffer.isBuffer(body)
    ? body.length
    : Buffer.byteLength(body);

  return new Promise((resolve, reject) => {
    const requestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: options.method ?? 'GET',
      headers,
    };
    const req = https.request(requestOptions, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        cleanup();
        const responseBody = Buffer.concat(chunks);
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: options.responseType === 'buffer'
            ? responseBody
            : responseBody.toString('utf8'),
        });
      });
    });

    const onAbort = () => req.destroy(new Error('CTeam request aborted'));
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort);
    req.on('error', (error) => {
      cleanup();
      reject(error);
    });
    req.setTimeout(options.timeoutMs ?? 20_000, () => {
      req.destroy(new Error('CTeam request timed out'));
    });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (body) req.write(body);
    req.end();
  });
}

function match(html, expression) {
  return expression.exec(html)?.[1] ?? '';
}

function resolveRedirect(baseUrl, location) {
  return location ? new URL(location, baseUrl).toString() : '';
}

function encryptPassword(publicKeyBase64, password) {
  const key = Buffer.from(publicKeyBase64, 'base64').toString('utf8');
  return crypto.publicEncrypt({
    key,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  }, Buffer.from(password, 'utf8')).toString('base64');
}

export function readCteamLocalConfig(configPath) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read CTeam local config at "${configPath}": ${error.message}`);
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`CTeam local config at "${configPath}" must be a JSON object`);
  }
  return config;
}

export function readLoginConfig(configPath) {
  const config = readCteamLocalConfig(configPath);
  for (const key of ['loginUrl', 'username', 'password']) {
    if (typeof config[key] !== 'string' || !config[key]) {
      throw new Error(`CTeam login config is missing ${key}`);
    }
  }
  return config;
}

function hasLoginConfigFields(config) {
  return ['loginUrl', 'username', 'password'].every((key) => {
    return typeof config[key] === 'string' && config[key];
  });
}

export function loginConfigPathCandidates(configuredPath, sessionCwd, processCwd = process.cwd()) {
  const candidates = [];
  if (typeof configuredPath === 'string' && configuredPath.trim()) {
    candidates.push(path.resolve(configuredPath));
  }
  if (typeof sessionCwd === 'string' && sessionCwd) {
    candidates.push(projectLocalConfigPath(sessionCwd));
    candidates.push(legacyProjectLoginConfigPath(sessionCwd));
  } else if (typeof processCwd === 'string' && processCwd) {
    candidates.push(projectLocalConfigPath(processCwd));
    candidates.push(legacyProjectLoginConfigPath(processCwd));
  }
  candidates.push(packageLocalConfigPath());
  return [...new Set(candidates)];
}

export function resolveLoginConfigPath(configuredPath, sessionCwd, processCwd = process.cwd()) {
  const candidates = loginConfigPathCandidates(configuredPath, sessionCwd, processCwd);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const config = readCteamLocalConfig(candidate);
    if (hasLoginConfigFields(config)) return candidate;
  }
  throw new Error(`CTeam browser login state is unavailable and legacy login config was not found; checked: ${candidates.join(', ')}`);
}

async function login(config, options) {
  const jar = new CookieJar();
  const loginPage = await request(config.loginUrl, {
    headers: { 'User-Agent': 'dsh-cteam/0.1' },
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  jar.store(config.loginUrl, loginPage.headers['set-cookie']);
  if (loginPage.statusCode !== 200) {
    throw new Error(`CTeam login page returned HTTP ${loginPage.statusCode}`);
  }

  const csrfToken = match(loginPage.body, /name="csrfmiddlewaretoken" value="([^"]+)"/u);
  const appId = match(loginPage.body, /name="app_id" value="([^"]*)"/u) || 'None';
  const publicKey = match(loginPage.body, /PASSWORD_RSA_PUBLIC_KEY = "([^"]+)"/u);
  if (!csrfToken || !publicKey) throw new Error('cannot parse CTeam login page');

  const form = new URLSearchParams({
    csrfmiddlewaretoken: csrfToken,
    username: config.username,
    password: encryptPassword(publicKey, config.password),
    next: '',
    app_id: appId,
  }).toString();
  const loginResponse = await request(config.loginUrl, {
    method: 'POST',
    headers: {
      'User-Agent': 'dsh-cteam/0.1',
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: config.loginUrl,
      Cookie: jar.header(config.loginUrl),
    },
    body: form,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  jar.store(config.loginUrl, loginResponse.headers['set-cookie']);
  if (![200, 302, 303].includes(loginResponse.statusCode)) {
    throw new Error(`CTeam login returned HTTP ${loginResponse.statusCode}`);
  }

  let redirectUrl = resolveRedirect(config.loginUrl, loginResponse.headers.location);
  for (let count = 0; redirectUrl && count < 5; count += 1) {
    const redirectResponse = await request(redirectUrl, {
      headers: {
        'User-Agent': 'dsh-cteam/0.1',
        Cookie: jar.header(redirectUrl),
      },
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
    jar.store(redirectUrl, redirectResponse.headers['set-cookie']);
    redirectUrl = resolveRedirect(redirectUrl, redirectResponse.headers.location);
  }
  return jar;
}

export async function createAuthenticatedSession(options) {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const config = readLoginConfig(options.loginConfigPath);
  const jar = await login(config, options);

  return {
    async request(target, requestOptions = {}) {
      const url = new URL(target, baseUrl).toString();
      const headers = {
        'User-Agent': 'dsh-cteam/0.1',
        ...(requestOptions.headers ?? {}),
      };
      const jarCookie = jar.header(url);
      const requestCookie = headers.Cookie ?? headers.cookie ?? '';
      delete headers.cookie;
      const cookie = [jarCookie, requestCookie].filter(Boolean).join('; ');
      if (cookie) headers.Cookie = cookie;

      const response = await request(url, {
        ...requestOptions,
        headers,
        signal: requestOptions.signal ?? options.signal,
        timeoutMs: requestOptions.timeoutMs ?? options.timeoutMs,
      });
      jar.store(url, response.headers['set-cookie']);
      return { ...response, url };
    },
  };
}

export async function fetchDemandCategoryTree(options) {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const session = await createAuthenticatedSession(options);
  const apiUrl = new URL(
    `/ms/vteam/api/user/issue_classify/${encodeURIComponent(options.projectId)}/tree`,
    baseUrl,
  ).toString();
  const response = await session.request(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: new URL(
        `/devops/console/vteam/${encodeURIComponent(options.projectId)}/twDemand/demand?vmode=table`,
        baseUrl,
      ).toString(),
    },
    body: '[]',
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  if (response.statusCode !== 200) {
    throw new Error(`CTeam category API returned HTTP ${response.statusCode}`);
  }

  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error('CTeam category API returned invalid JSON');
  }
  if (payload.status !== 0 || !Array.isArray(payload.data)) {
    throw cteamApiFailure('category', payload);
  }
  return payload.data;
}

export async function fetchDemandList(options) {
  return fetchIssueList({
    ...options,
    issueType: 'DEMAND',
    resourceName: 'demand list',
  });
}

export async function fetchIssueList(options) {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const session = await createAuthenticatedSession(options);
  const issueType = options.issueType ?? 'DEMAND';
  const apiUrl = new URL(
    `/ms/vteam/api/user/issue/${encodeURIComponent(options.projectId)}/table/${encodeURIComponent(issueType)}`,
    baseUrl,
  );
  apiUrl.searchParams.set('num', String(options.page));
  apiUrl.searchParams.set('size', String(options.pageSize));
  apiUrl.searchParams.set('remember', options.remember === true ? 'true' : 'false');
  const response = await session.request(apiUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: new URL(
        `/devops/console/vteam/${encodeURIComponent(options.projectId)}/twDemand/demand?vmode=table`,
        baseUrl,
      ).toString(),
    },
    body: JSON.stringify(options.filters),
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  if (response.statusCode !== 200) {
    throw new Error(`CTeam ${options.resourceName ?? 'issue list'} API returned HTTP ${response.statusCode}`);
  }

  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error(`CTeam ${options.resourceName ?? 'issue list'} API returned invalid JSON`);
  }
  if (payload.status !== 0 || typeof payload.data !== 'object' || payload.data === null) {
    throw cteamApiFailure(options.resourceName ?? 'issue list', payload);
  }
  return payload.data;
}

export async function fetchDemandDetail(options) {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const session = await createAuthenticatedSession(options);
  const apiUrl = new URL(
    `/ms/vteam/api/user/issue/${encodeURIComponent(options.projectId)}/${encodeURIComponent(options.issueId)}`,
    baseUrl,
  ).toString();
  const response = await session.request(apiUrl, {
    headers: {
      Referer: new URL(
        `/devops/console/vteam/${encodeURIComponent(options.projectId)}/twDemand/demand?vmode=table`,
        baseUrl,
      ).toString(),
    },
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  if (response.statusCode !== 200) {
    throw new Error(`CTeam demand detail API returned HTTP ${response.statusCode}`);
  }

  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error('CTeam demand detail API returned invalid JSON');
  }
  if (payload.status !== 0 || typeof payload.data !== 'object' || payload.data === null) {
    throw cteamApiFailure('demand detail', payload);
  }
  return payload.data;
}

async function fetchDemandJsonResource(session, options, resourcePath, resourceName) {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const apiUrl = new URL(resourcePath, baseUrl).toString();
  const response = await session.request(apiUrl, {
    headers: {
      Referer: new URL(
        `/devops/console/vteam/${encodeURIComponent(options.projectId)}/twDemand/demand?vmode=table`,
        baseUrl,
      ).toString(),
    },
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  if (response.statusCode !== 200) {
    throw new Error(`CTeam ${resourceName} API returned HTTP ${response.statusCode}`);
  }

  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error(`CTeam ${resourceName} API returned invalid JSON`);
  }
  if (payload.status !== 0) {
    throw cteamApiFailure(resourceName, payload);
  }
  return payload.data;
}

function issueReferer(options) {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const projectId = encodeURIComponent(options.projectId);
  const issueId = options.issueId === undefined ? '' : `&id=${encodeURIComponent(options.issueId)}`;
  const issueType = String(options.issueType ?? 'DEMAND').toLocaleUpperCase();
  if (issueType === 'BUG') {
    return new URL(`/devops/console/vteam/${projectId}/twBug?vmode=table${issueId}`, baseUrl).toString();
  }
  if (issueType === 'TASK') {
    return new URL(`/devops/console/vteam/${projectId}/twTask?vmode=table${issueId}`, baseUrl).toString();
  }
  return new URL(`/devops/console/vteam/${projectId}/twDemand/demand?vmode=table${issueId}`, baseUrl).toString();
}

async function fetchIssueJsonResource(session, options, resourcePath, resourceName) {
  return requestIssueJsonResource(session, options, resourcePath, resourceName);
}

async function requestIssueJsonResource(session, options, resourcePath, resourceName, requestOptions = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const apiUrl = new URL(resourcePath, baseUrl).toString();
  const response = await session.request(apiUrl, {
    ...requestOptions,
    headers: {
      Referer: issueReferer(options),
      ...(requestOptions.headers ?? {}),
    },
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  if (response.statusCode !== 200) {
    throw new Error(`CTeam ${resourceName} API returned HTTP ${response.statusCode}`);
  }

  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error(`CTeam ${resourceName} API returned invalid JSON`);
  }
  if (payload.status !== 0) {
    throw cteamApiFailure(resourceName, payload);
  }
  return payload.data;
}

async function postIssueJsonResource(session, options, resourcePath, resourceName, body, headers = {}) {
  return requestIssueJsonResource(session, options, resourcePath, resourceName, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export async function fetchDemandComments(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  const data = await fetchDemandJsonResource(
    session,
    options,
    `/ms/vteam/api/user/issue_comment/${encodeURIComponent(options.projectId)}/${encodeURIComponent(options.issueId)}`,
    'demand comments',
  );
  if (!Array.isArray(data)) throw new Error('CTeam demand comments API response data must be an array');
  return data;
}

export async function fetchIssueDetailWithComments(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  const [detail, comments] = await Promise.all([
    fetchDemandJsonResource(
      session,
      options,
      `/ms/vteam/api/user/issue/${encodeURIComponent(options.projectId)}/${encodeURIComponent(options.issueId)}`,
      'issue detail',
    ),
    fetchDemandJsonResource(
      session,
      options,
      `/ms/vteam/api/user/issue_comment/${encodeURIComponent(options.projectId)}/${encodeURIComponent(options.issueId)}`,
      'issue comments',
    ),
  ]);
  if (typeof detail !== 'object' || detail === null || Array.isArray(detail)) {
    throw new Error('CTeam issue detail API response data must be an object');
  }
  if (!Array.isArray(comments)) throw new Error('CTeam issue comments API response data must be an array');
  return { detail, comments };
}

export async function fetchDemandDetailWithComments(options) {
  return fetchIssueDetailWithComments(options);
}

export async function fetchIssueTransitionNodes(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  return fetchIssueJsonResource(
    session,
    options,
    `/ms/vteam/api/user/issue_direction/${encodeURIComponent(options.projectId)}/${encodeURIComponent(options.issueId)}`,
    'issue transition nodes',
  );
}

export async function fetchIssueTransitionFields(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  return fetchIssueJsonResource(
    session,
    options,
    `/ms/vteam/api/user/issue_direction/${encodeURIComponent(options.projectId)}/${encodeURIComponent(options.issueId)}/${encodeURIComponent(options.nextNodeId)}/field`,
    'issue transition fields',
  );
}

export async function fetchIssueTransitionCandidates(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  return fetchIssueJsonResource(
    session,
    options,
    `/ms/vteam/api/user/issue_direction/${encodeURIComponent(options.projectId)}/${encodeURIComponent(options.issueId)}/${encodeURIComponent(options.nextNodeId)}`,
    'issue transition candidates',
  );
}

export async function fetchIssueFieldOptions(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  const query = options.query === undefined ? '' : String(options.query);
  const resourcePath = `/ms/vteam/api/user/issue_field_value/${encodeURIComponent(options.projectId)}/option/${encodeURIComponent(options.fieldIdOrName)}?${new URLSearchParams({ query }).toString()}`;
  return fetchIssueJsonResource(session, options, resourcePath, 'issue field options');
}

export async function fetchIssueFieldOptionsByName(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  const query = options.query === undefined ? '' : String(options.query);
  const resourcePath = `/ms/vteam/api/user/issue_field_value/${encodeURIComponent(options.projectId)}/by_name/${encodeURIComponent(options.fieldIdOrName)}?${new URLSearchParams({ query }).toString()}`;
  return fetchIssueJsonResource(session, options, resourcePath, 'issue field options by name');
}

export async function fetchIssueModelProject(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  return fetchIssueJsonResource(
    session,
    options,
    `/ms/vteam/api/user/issue_model/${encodeURIComponent(options.projectId)}/project`,
    'issue model project',
  );
}

export async function fetchIssueTemplateDetail(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  const headers = {};
  if (typeof options.tenantId === 'string' && options.tenantId.trim()) {
    headers['X-DEVOPS-TENANT-ID'] = options.tenantId.trim();
  }
  return requestIssueJsonResource(
    session,
    options,
    `/ms/vteam/api/user/issue_template/${encodeURIComponent(options.projectId)}/${encodeURIComponent(options.templateId)}`,
    'issue template detail',
    { headers },
  );
}

export async function fetchIssuePreviewFields(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  const classify = options.classify ?? 'DEMAND';
  return fetchIssueJsonResource(
    session,
    options,
    `/ms/vteam/api/user/issue_field/${encodeURIComponent(options.projectId)}/preview?${new URLSearchParams({ classify }).toString()}`,
    'issue preview fields',
  );
}

function multipartFileBody({ fieldName, filename, contentType, buffer }) {
  const boundary = `----dsh-cteam-${crypto.randomBytes(12).toString('hex')}`;
  const head = Buffer.from([
    `--${boundary}`,
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename.replace(/"/gu, '\\"')}"`,
    `Content-Type: ${contentType || 'application/octet-stream'}`,
    '',
    '',
  ].join('\r\n'), 'utf8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    boundary,
    body: Buffer.concat([head, buffer, tail]),
  };
}

function multipartFieldsBody({ fields = {}, files = [] }) {
  const boundary = `----dsh-cteam-${crypto.randomBytes(12).toString('hex')}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    parts.push(Buffer.from([
      `--${boundary}`,
      `Content-Disposition: form-data; name="${String(name).replace(/"/gu, '\\"')}"`,
      '',
      String(value),
      '',
    ].join('\r\n'), 'utf8'));
  }
  for (const file of files) {
    parts.push(Buffer.from([
      `--${boundary}`,
      `Content-Disposition: form-data; name="${file.fieldName.replace(/"/gu, '\\"')}"; filename="${file.filename.replace(/"/gu, '\\"')}"`,
      `Content-Type: ${file.contentType || 'application/octet-stream'}`,
      '',
      '',
    ].join('\r\n'), 'utf8'));
    parts.push(file.buffer);
    parts.push(Buffer.from('\r\n', 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    boundary,
    body: Buffer.concat(parts),
  };
}

export async function uploadIssueFile(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  const buffer = Buffer.isBuffer(options.buffer)
    ? options.buffer
    : fs.readFileSync(options.filePath);
  const filename = options.filename ?? path.basename(options.filePath ?? 'image.png');
  const { boundary, body } = multipartFileBody({
    fieldName: options.fieldName ?? 'file',
    filename,
    contentType: options.contentType,
    buffer,
  });
  return requestIssueJsonResource(
    session,
    options,
    `/ms/vteam/api/user/file/${encodeURIComponent(options.projectId)}/upload`,
    'issue file upload',
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    },
  );
}

export async function fetchTenantIdByProject(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  const response = await session.request(
    `/ms/auth/api/user/tenant/info/project/${encodeURIComponent(options.projectId)}`,
    {
      headers: { Accept: 'application/json, text/plain, */*' },
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    },
  );
  if (response.statusCode !== 200) {
    throw new Error(`CTeam project tenant API returned HTTP ${response.statusCode}`);
  }
  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error('CTeam project tenant API returned invalid JSON');
  }
  if (payload.status !== 0 || typeof payload.data !== 'string' || !payload.data) {
    throw cteamApiFailure('project tenant', payload);
  }
  return payload.data;
}

async function docContextHeaders(options, session) {
  const tenantId = options.tenantId || await fetchTenantIdByProject({ ...options, session });
  return {
    Accept: 'application/json, text/plain, */*',
    'X-DEVOPS-TENANT-ID': tenantId,
    'X-DEVOPS-PROJECT-ID': options.projectId,
    Cookie: `X-DEVOPS-TENANT-ID=${encodeURIComponent(tenantId)}; X-DEVOPS-PROJECT-ID=${encodeURIComponent(options.projectId)}`,
    Referer: options.referer ?? new URL(
      `/devops/console/toc/${encodeURIComponent(options.projectId)}/wiki/lib/${encodeURIComponent(options.libraryId ?? '')}/docManWiki/list/${encodeURIComponent(options.wikiId ?? options.parentId ?? '')}`,
      options.baseUrl ?? DEFAULT_BASE_URL,
    ).toString(),
  };
}

async function requestDocJsonResource(session, options, resourcePath, resourceName, requestOptions = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const headers = await docContextHeaders(options, session);
  const response = await session.request(new URL(resourcePath, baseUrl).toString(), {
    ...requestOptions,
    headers: {
      ...headers,
      ...(requestOptions.headers ?? {}),
    },
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  if (response.statusCode !== 200) {
    throw new Error(`CTeam ${resourceName} API returned HTTP ${response.statusCode}`);
  }
  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error(`CTeam ${resourceName} API returned invalid JSON`);
  }
  if (payload.status !== 0) {
    throw cteamApiFailure(resourceName, payload);
  }
  return payload.data;
}

export async function fetchWikiTree(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  const data = await requestDocJsonResource(
    session,
    options,
    `/ms/doc/api/user/wiki/${encodeURIComponent(options.libraryId)}/tree`,
    'wiki tree',
  );
  if (!Array.isArray(data)) throw new Error('CTeam wiki tree API response data must be an array');
  return data;
}

export async function fetchWikiLibraryInfo(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  const data = await requestDocJsonResource(
    session,
    options,
    `/ms/doc/api/user/doc_library/libInfo/${encodeURIComponent(options.projectId)}`,
    'wiki library info',
  );
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('CTeam wiki library info API response data must be an object');
  }
  if (typeof data.id !== 'string' || !data.id) {
    throw new Error('CTeam wiki library info API response data is missing id');
  }
  return data;
}

export async function fetchWikiDetail(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  return requestDocJsonResource(
    session,
    options,
    `/ms/doc/api/user/wiki/${encodeURIComponent(options.libraryId)}/${encodeURIComponent(options.wikiId)}`,
    'wiki detail',
  );
}

export async function importWikiMarkdown(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  const buffer = Buffer.isBuffer(options.buffer)
    ? options.buffer
    : fs.readFileSync(options.filePath);
  const filename = options.filename ?? path.basename(options.filePath ?? 'import.md');
  const { boundary, body } = multipartFieldsBody({
    fields: {
      fileMd5: crypto.createHash('md5').update(buffer).digest('hex'),
    },
    files: [{
      fieldName: options.fieldName ?? 'file',
      filename,
      contentType: options.contentType ?? 'text/markdown; charset=utf-8',
      buffer,
    }],
  });
  const query = options.parentId ? `?parentId=${encodeURIComponent(options.parentId)}` : '';
  return requestDocJsonResource(
    session,
    options,
    `/ms/doc/api/user/wiki/${encodeURIComponent(options.libraryId)}/import/md${query}`,
    'wiki markdown import',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
      timeoutMs: options.timeoutMs,
    },
  );
}

export async function createIssue(options) {
  const session = options.session ?? await createAuthenticatedSession(options);
  const headers = {};
  if (typeof options.tenantId === 'string' && options.tenantId.trim()) {
    headers['X-DEVOPS-TENANT-ID'] = options.tenantId.trim();
  }
  headers['X-DEVOPS-PROJECT-ID'] = options.projectId;
  return postIssueJsonResource(
    session,
    options,
    `/ms/vteam/api/user/issue/${encodeURIComponent(options.projectId)}`,
    'issue create',
    options.body,
    headers,
  );
}

export async function fetchIssueFilters(options) {
  const session = await createAuthenticatedSession(options);
  const selectTypes = {
    DEMAND: 'DEMAND_SELECT',
    BUG: 'BUG_SELECT',
    TASK: 'TASK_SELECT',
  };
  const issueType = String(options.issueType ?? 'DEMAND').toLocaleUpperCase();
  const type = options.type ?? selectTypes[issueType] ?? 'DEMAND_SELECT';
  const data = await fetchDemandJsonResource(
    session,
    options,
    `/ms/vteam/api/user/issue_select/${encodeURIComponent(options.projectId)}/${encodeURIComponent(type)}`,
    'issue filters',
  );
  if (!Array.isArray(data)) throw new Error('CTeam issue filters API response data must be an array');
  return data;
}

export async function fetchQueryFilterFields(options) {
  const session = await createAuthenticatedSession(options);
  const issueType = options.issueType ?? 'DEMAND';
  const data = await fetchDemandJsonResource(
    session,
    options,
    `/ms/vteam/api/user/issue_field/${encodeURIComponent(options.projectId)}/query_filters?classify=${encodeURIComponent(issueType)}`,
    'query filter fields',
  );
  if (!Array.isArray(data)) throw new Error('CTeam query filter fields API response data must be an array');
  return data;
}

function extensionFromHeaders(headers, fallback = '.bin') {
  const disposition = headers['content-disposition'];
  const dispositionValue = Array.isArray(disposition) ? disposition[0] : disposition;
  const filenameMatch = typeof dispositionValue === 'string'
    ? /filename\*?=(?:UTF-8''|")?([^";]+)/iu.exec(dispositionValue)
    : null;
  if (filenameMatch !== null) {
    const extension = path.extname(decodeURIComponent(filenameMatch[1]));
    if (extension) return extension;
  }

  const contentType = String(headers['content-type'] ?? '').split(';')[0].trim().toLocaleLowerCase();
  const extensions = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
  };
  return extensions[contentType] ?? fallback;
}

function mediaTypeFromExtension(extension) {
  const mediaTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
  };
  return mediaTypes[extension.toLocaleLowerCase()] ?? '';
}

function safeFilenamePart(value, fallback) {
  const text = typeof value === 'string' && value ? value : fallback;
  return text.replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 80) || fallback;
}

export async function downloadDemandImages(options) {
  const images = Array.isArray(options.images) ? options.images : [];
  if (images.length === 0) return [];

  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const session = await createAuthenticatedSession(options);
  fs.mkdirSync(options.outputDir, { recursive: true });

  const downloaded = [];
  for (const image of images) {
    const imageUrl = new URL(image.url, baseUrl).toString();
    const response = await session.request(imageUrl, {
      headers: {
        Referer: new URL(
          `/devops/console/vteam/${encodeURIComponent(options.projectId)}/twDemand/demand?vmode=table&id=${encodeURIComponent(options.issueId)}`,
          baseUrl,
        ).toString(),
      },
      responseType: 'buffer',
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
    if (response.statusCode !== 200 || !Buffer.isBuffer(response.body)) {
      downloaded.push({ ...image, downloaded: false });
      continue;
    }

    const extension = extensionFromHeaders(response.headers);
    const fileBase = safeFilenamePart(image.fileId, `image-${image.index + 1}`);
    const localPath = path.join(options.outputDir, `${String(image.index + 1).padStart(2, '0')}-${fileBase}${extension}`);
    fs.writeFileSync(localPath, response.body);
    const contentType = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLocaleLowerCase()
      || mediaTypeFromExtension(extension);
    downloaded.push({
      ...image,
      downloaded: true,
      localPath,
      contentType,
      bytes: response.body.length,
      dataUrl: contentType.startsWith('image/')
        ? `data:${contentType};base64,${response.body.toString('base64')}`
        : '',
    });
  }
  return downloaded;
}
