import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveDefaultProjectId } from '../src/project-config.js';

function makeExec(cwd) {
  return {
    agent: {
      session: {
        header: { cwd },
      },
    },
  };
}

function writeLocalConfig(cwd, value) {
  const dir = path.join(cwd, '.ops-local');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cw-browser-login.json'), JSON.stringify(value), 'utf8');
}

test('resolves default project id from local login config', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cteam-project-'));
  writeLocalConfig(cwd, {
    loginUrl: 'https://devops.cwoa.net/login',
    username: 'user',
    password: 'pass',
    projectId: 'm68126',
  });

  assert.equal(resolveDefaultProjectId({}, makeExec(cwd)), 'm68126');
});

test('plugin project id overrides local login config project id', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cteam-project-'));
  writeLocalConfig(cwd, {
    loginUrl: 'https://devops.cwoa.net/login',
    username: 'user',
    password: 'pass',
    projectId: 'm68126',
  });

  assert.equal(resolveDefaultProjectId({ projectId: 'override-project' }, makeExec(cwd)), 'override-project');
});
