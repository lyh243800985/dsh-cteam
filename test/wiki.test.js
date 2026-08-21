import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  flattenWikiTree,
  getLastWikiImportTarget,
  normalizeWikiDetail,
  parseWikiDetailToolArguments,
  parseWikiImportToolArguments,
  parseWikiTreeToolArguments,
  saveLastWikiImportTarget,
  parseWikiUrl,
  selectWikiNodes,
  wikiImportMemoryFile,
  wikiConsoleUrl,
} from '../src/wiki.js';

const wikiUrl = 'https://devops.cwoa.net/devops/console/toc/m68126/wiki/lib/11292e3b8e1640478e551b6034c7d7b6/docManWiki/list/7d53bd5f39ed44c8b2c947fec5a31ad7';

const tree = [{
  id: 'root',
  docLibraryId: 'lib',
  title: '根目录',
  permissions: ['VIEW'],
  children: [{
    id: 'child',
    docLibraryId: 'lib',
    parentId: 'root',
    title: '操作手册',
    children: [{ id: 'leaf', title: '导入 Markdown', children: [] }],
  }],
}];

test('parses CTeam wiki URL IDs', () => {
  assert.deepEqual(parseWikiUrl(wikiUrl), {
    projectId: 'm68126',
    libraryId: '11292e3b8e1640478e551b6034c7d7b6',
    wikiId: '7d53bd5f39ed44c8b2c947fec5a31ad7',
  });
});

test('parses wiki tree arguments from URL', () => {
  const input = parseWikiTreeToolArguments({ wiki_url: wikiUrl, parent_id: '7d53bd5f39ed44c8b2c947fec5a31ad7' });
  assert.equal(input.projectId, 'm68126');
  assert.equal(input.libraryId, '11292e3b8e1640478e551b6034c7d7b6');
  assert.equal(input.parentId, '7d53bd5f39ed44c8b2c947fec5a31ad7');
});

test('allows wiki library to be resolved later when omitted', () => {
  const input = parseWikiTreeToolArguments({}, {
    configuredProjectId: 'm68126',
  });
  assert.equal(input.projectId, 'm68126');
  assert.equal(input.libraryId, undefined);
  assert.equal(input.parentId, undefined);
});

test('parses wiki detail arguments from URL', () => {
  const input = parseWikiDetailToolArguments({ wiki_url: wikiUrl });
  assert.equal(input.projectId, 'm68126');
  assert.equal(input.libraryId, '11292e3b8e1640478e551b6034c7d7b6');
  assert.equal(input.wikiId, '7d53bd5f39ed44c8b2c947fec5a31ad7');
});

test('flattens and selects wiki nodes', () => {
  const nodes = flattenWikiTree(tree);
  assert.deepEqual(nodes.map((node) => node.id), ['root', 'child', 'leaf']);
  assert.deepEqual(nodes[2].path, ['根目录', '操作手册', '导入 Markdown']);
  assert.deepEqual(selectWikiNodes(nodes, { parentId: 'root' }).nodes.map((node) => node.id), ['child']);
  assert.deepEqual(selectWikiNodes(nodes, { parentId: 'root', includeDescendants: true }).nodes.map((node) => node.id), ['child', 'leaf']);
  assert.deepEqual(selectWikiNodes(nodes, { query: 'markdown' }).nodes.map((node) => node.id), ['leaf']);
});

test('normalizes wiki detail', () => {
  const detail = normalizeWikiDetail({
    id: 'root',
    docLibraryId: 'lib',
    title: '根目录',
    content: '<h1>Hi</h1>',
    editor: true,
    version: 2,
    pageview: 3,
    createUser: '王杰[sky]',
    updatedTime: '2026-08-20 12:00:00',
    permissions: ['VIEW'],
    classifyList: ['classify-id'],
  });
  assert.equal(detail.libraryId, 'lib');
  assert.equal(detail.content, '<h1>Hi</h1>');
  assert.equal(detail.editor, true);
  assert.equal(detail.version, 2);
});

test('validates markdown import source and default parent from URL', () => {
  const input = parseWikiImportToolArguments({ wiki_url: wikiUrl, markdown: '# 文档' });
  assert.equal(input.parentId, '7d53bd5f39ed44c8b2c947fec5a31ad7');
  assert.equal(input.useLastTarget, false);
  assert.equal(input.filename, 'import.md');
  const lastTargetInput = parseWikiImportToolArguments({
    project_id: 'm68126',
    markdown: '# 文档',
    use_last_target: true,
  });
  assert.equal(lastTargetInput.libraryId, undefined);
  assert.equal(lastTargetInput.parentId, undefined);
  assert.equal(lastTargetInput.useLastTarget, true);
  assert.throws(() => parseWikiImportToolArguments({ wiki_url: wikiUrl }), /exactly one/u);
  assert.throws(() => parseWikiImportToolArguments({ wiki_url: wikiUrl, markdown: '# A', markdown_file_path: 'a.md' }), /exactly one/u);
  assert.throws(() => parseWikiImportToolArguments({ project_id: 'm68126', library_id: 'lib', markdown: '# A' }), /parent_id is required/u);
});

test('builds wiki console URLs', () => {
  assert.equal(
    wikiConsoleUrl('https://devops.cwoa.net', 'm68126', 'lib', 'root'),
    'https://devops.cwoa.net/devops/console/toc/m68126/wiki/lib/lib/docManWiki/list/root',
  );
});

test('stores Wiki import history separately from demand submission cache', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cteam-wiki-'));
  const saved = saveLastWikiImportTarget(cwd, {
    projectId: 'm68126',
    libraryId: 'lib',
    parentId: 'root',
    title: '根目录',
    path: ['根目录'],
    wikiUrl: 'https://devops.cwoa.net/wiki/root',
  });
  assert.equal(saved.parentId, 'root');
  assert.match(wikiImportMemoryFile(cwd), /wiki-import-last\.json$/u);
  assert.equal(getLastWikiImportTarget(cwd, 'm68126', 'lib').title, '根目录');
  assert.equal(getLastWikiImportTarget(cwd, 'm68126', 'other'), undefined);
});
