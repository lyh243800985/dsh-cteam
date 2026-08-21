import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  argumentsIncludeProjectHint,
  rememberDefaultProjectId,
  rememberProjectIdFromArgs,
  resolveDefaultProjectId,
} from '../src/project-config.js';

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PACKAGE_LOCAL_CONFIG_PATH = path.join(PACKAGE_ROOT, 'local', 'local.json');

function makeExec(cwd) {
  return {
    agent: {
      session: {
        header: { cwd },
      },
    },
  };
}

function withPackageLocalConfig(value, callback) {
  const dir = path.dirname(PACKAGE_LOCAL_CONFIG_PATH);
  const existed = fs.existsSync(PACKAGE_LOCAL_CONFIG_PATH);
  const previous = existed ? fs.readFileSync(PACKAGE_LOCAL_CONFIG_PATH, 'utf8') : '';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PACKAGE_LOCAL_CONFIG_PATH, JSON.stringify(value), 'utf8');
  try {
    callback();
  } finally {
    if (existed) {
      fs.writeFileSync(PACKAGE_LOCAL_CONFIG_PATH, previous, 'utf8');
    } else if (fs.existsSync(PACKAGE_LOCAL_CONFIG_PATH)) {
      fs.unlinkSync(PACKAGE_LOCAL_CONFIG_PATH);
    }
  }
}

function writeLocalConfig(cwd, value) {
  const dir = path.join(cwd, 'local');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify(value), 'utf8');
}

function writeLegacyLoginConfig(cwd, value) {
  const dir = path.join(cwd, '.ops-local');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cw-browser-login.json'), JSON.stringify(value), 'utf8');
}

test('resolves default project id from project local config', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cteam-project-'));
  writeLocalConfig(cwd, {
    loginUrl: 'https://devops.cwoa.net/login',
    username: 'user',
    password: 'pass',
    projectId: 'm68126',
  });

  assert.equal(resolveDefaultProjectId({}, makeExec(cwd)), 'm68126');
});

test('plugin project id overrides project local config project id', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cteam-project-'));
  writeLocalConfig(cwd, {
    loginUrl: 'https://devops.cwoa.net/login',
    username: 'user',
    password: 'pass',
    projectId: 'm68126',
  });

  assert.equal(resolveDefaultProjectId({ projectId: 'override-project' }, makeExec(cwd)), 'override-project');
});

test('falls back to package local config when project config has no project id', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cteam-project-'));
  writeLocalConfig(cwd, {
    loginUrl: 'https://devops.cwoa.net/login',
    username: 'user',
    password: 'pass',
  });

  withPackageLocalConfig({ projectId: 'm68126' }, () => {
    assert.equal(resolveDefaultProjectId({}, makeExec(cwd)), 'm68126');
  });
});

test('project local config project id overrides package local config project id', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cteam-project-'));
  writeLocalConfig(cwd, {
    loginUrl: 'https://devops.cwoa.net/login',
    username: 'user',
    password: 'pass',
    projectId: 'project-level',
  });

  withPackageLocalConfig({ projectId: 'package-level' }, () => {
    assert.equal(resolveDefaultProjectId({}, makeExec(cwd)), 'project-level');
  });
});

test('resolves default project id from legacy project login config', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cteam-project-'));
  writeLegacyLoginConfig(cwd, {
    loginUrl: 'https://devops.cwoa.net/login',
    username: 'user',
    password: 'pass',
    projectId: 'legacy-project',
  });

  assert.equal(resolveDefaultProjectId({}, makeExec(cwd)), 'legacy-project');
});

test('remembers project id in project local config', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cteam-project-'));

  const configPath = rememberDefaultProjectId('m68126', {}, makeExec(cwd));
  assert.equal(configPath, path.join(cwd, 'local', 'local.json'));
  assert.equal(resolveDefaultProjectId({}, makeExec(cwd)), 'm68126');
});

test('remembers project id in package local config when session cwd is absent', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cteam-project-'));

  withPackageLocalConfig({}, () => {
    const configPath = rememberDefaultProjectId('m68126', {}, makeExec(undefined));
    assert.equal(configPath, PACKAGE_LOCAL_CONFIG_PATH);
    assert.equal(resolveDefaultProjectId({}, makeExec(cwd)), 'm68126');
  });
});

test('remembers project id from explicit arguments and wiki urls', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cteam-project-'));
  assert.equal(argumentsIncludeProjectHint({
    wiki_url: 'https://devops.cwoa.net/devops/console/toc/m68126/wiki/lib/lib-id/docManWiki/list/wiki-id',
  }), true);

  withPackageLocalConfig({}, () => {
    const configPath = rememberProjectIdFromArgs({
      wiki_url: 'https://devops.cwoa.net/devops/console/toc/m68126/wiki/lib/lib-id/docManWiki/list/wiki-id',
    }, 'm68126', {}, makeExec(cwd));
    assert.equal(configPath, path.join(cwd, 'local', 'local.json'));
    assert.equal(resolveDefaultProjectId({}, makeExec(cwd)), 'm68126');
  });
});
