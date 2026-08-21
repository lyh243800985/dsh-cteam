import assert from 'node:assert/strict';
import test from 'node:test';
import {
  flattenCategoryTree,
  parseToolArguments,
  resolveProjectId,
  selectCategoryNodes,
} from '../src/categories.js';

const tree = [
  {
    id: 'root',
    parentId: '',
    name: '自动化运维中心',
    count: 3,
    sort: 1,
    children: [
      {
        id: 'v4',
        parentId: 'root',
        name: 'V4.0',
        count: 3,
        children: [
          { id: 'iteration', parentId: 'v4', name: '迭代二', count: 2, children: [] },
        ],
      },
    ],
  },
  { id: '-1', name: '未分类', count: 1, children: [] },
];

test('resolves a dynamic project id from a CTeam URL', () => {
  assert.equal(resolveProjectId({
    projectUrl: 'https://devops.cwoa.net/devops/console/vteam/m68126/twDemand/demand?vmode=table',
  }), 'm68126');
});

test('uses the configured project when no project input is provided', () => {
  assert.equal(resolveProjectId({ configuredProjectId: 'm68126' }), 'm68126');
});

test('requires an explicit or configured project', () => {
  assert.throws(() => resolveProjectId({}), /configure projectId/u);
});

test('explicit project input overrides the configured project', () => {
  assert.equal(resolveProjectId({
    projectId: 'another-project',
    configuredProjectId: 'm68126',
  }), 'another-project');
  assert.equal(resolveProjectId({
    projectUrl: 'https://devops.cwoa.net/devops/console/vteam/another-project/twDemand/demand',
    configuredProjectId: 'm68126',
  }), 'another-project');
});

test('rejects conflicting project URL and explicit id', () => {
  assert.throws(() => resolveProjectId({
    projectUrl: 'https://devops.cwoa.net/devops/console/vteam/m68126/twDemand/demand',
    projectId: 'another-project',
  }), /does not match/u);
});

test('uses the configured project for category tool arguments', () => {
  assert.equal(parseToolArguments({}, {
    configuredProjectId: 'm68126',
  }).projectId, 'm68126');
});

test('flattens a category tree with paths and inherited parent IDs', () => {
  const nodes = flattenCategoryTree(tree);
  assert.equal(nodes.length, 4);
  assert.deepEqual(nodes[2].path, ['自动化运维中心', 'V4.0', '迭代二']);
  assert.equal(nodes[2].depth, 2);
  assert.equal(nodes[3].parentId, '');
});

test('lists roots by default', () => {
  const selected = selectCategoryNodes(flattenCategoryTree(tree));
  assert.equal(selected.mode, 'roots');
  assert.deepEqual(selected.nodes.map((node) => node.id), ['root', '-1']);
});

test('lists children and a complete subtree', () => {
  const nodes = flattenCategoryTree(tree);
  const children = selectCategoryNodes(nodes, { parentId: 'root' });
  assert.deepEqual(children.nodes.map((node) => node.id), ['v4']);
  const subtree = selectCategoryNodes(nodes, {
    parentId: 'root',
    includeDescendants: true,
  });
  assert.deepEqual(subtree.nodes.map((node) => node.id), ['v4', 'iteration']);
});

test('searches names and complete paths', () => {
  const selected = selectCategoryNodes(flattenCategoryTree(tree), { query: '迭代' });
  assert.equal(selected.mode, 'search');
  assert.deepEqual(selected.nodes.map((node) => node.id), ['iteration']);
});
