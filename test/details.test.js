import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractDemandImages,
  normalizeDemandComments,
  normalizeDemandDetail,
  parseDemandDetailToolArguments,
} from '../src/details.js';

test('parses demand detail arguments from a demand URL', () => {
  assert.deepEqual(parseDemandDetailToolArguments({
    demand_url: 'https://devops.cwoa.net/devops/console/vteam/m68126/twDemand/demand?vmode=table&id=demand-id',
  }), {
    projectId: 'm68126',
    issueId: 'demand-id',
  });
});

test('uses configured project and explicit demand id', () => {
  assert.deepEqual(parseDemandDetailToolArguments({
    demand_id: 'demand-id',
  }, {
    configuredProjectId: 'm68126',
  }), {
    projectId: 'm68126',
    issueId: 'demand-id',
  });
});

test('rejects mismatched explicit and URL demand ids', () => {
  assert.throws(() => parseDemandDetailToolArguments({
    demand_url: 'https://devops.cwoa.net/devops/console/vteam/m68126/twDemand/demand?id=one',
    demand_id: 'two',
  }), /does not match/u);
});

test('normalizes web-session demand detail data', () => {
  const detail = normalizeDemandDetail({
    property: {
      id: { name: 'id', value: 'demand-id', displayValue: 'demand-id' },
      number: { name: 'number', value: 'p176_1', displayValue: 'p176_1' },
      title: { name: 'title', value: 'A demand', displayValue: 'A demand' },
      desc: { name: 'desc', value: '# Detail', displayValue: '# Detail' },
      priority: { name: 'priority', value: 'CENTRAL', displayValue: '中' },
      state: { name: 'state', value: 'state-id', displayValue: '待规划' },
      modelTypeId: { name: 'modelTypeId', value: 'type-id', displayValue: 'Story' },
      demandClassify: { name: 'demandClassify', value: 'category-id', displayValue: '需求池' },
      createUser: { name: 'createUser', value: 'zhangsan', displayValue: '张三' },
      createTime: { name: 'createTime', value: '2026-08-18 10:00:00' },
      follow: { name: 'follow', value: 'true' },
      finished: { name: 'finished', value: 'false' },
      expired: { name: 'expired', value: false },
    },
    files: [{ id: 'file-id', name: 'spec.png', url: '/download/file-id' }],
    delete: false,
  });
  assert.equal(detail.id, 'demand-id');
  assert.equal(detail.title, 'A demand');
  assert.equal(detail.desc, '# Detail');
  assert.equal(detail.priorityName, '中');
  assert.equal(detail.stateName, '待规划');
  assert.equal(detail.demandClassifyName, '需求池');
  assert.equal(detail.createUserName, '张三');
  assert.equal(detail.follow, true);
  assert.equal(detail.finished, false);
  assert.equal(detail.expired, false);
  assert.equal(detail.files[0].name, 'spec.png');
  assert.equal(detail.fields.priority.displayValue, '中');
});

test('normalizes web-session demand comments', () => {
  const comments = normalizeDemandComments([{
    id: 'comment-id',
    projectId: 'm68126',
    createUser: 'linyuhan',
    createTime: '2026-08-17 15:59:35',
    comment: '<p>导入导出都用excel了，xls,xlsx</p>',
    parentId: '',
    issueId: 'demand-id',
    nodeId: '4149',
    nodeName: '待规划',
    nextId: '',
    nextName: '',
    assignProjectId: '',
    children: [{
      id: 'child-comment-id',
      comment: '<p>收到</p>',
    }],
  }]);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].id, 'comment-id');
  assert.equal(comments[0].createUser, 'linyuhan');
  assert.equal(comments[0].commentHtml, '<p>导入导出都用excel了，xls,xlsx</p>');
  assert.equal(comments[0].nodeName, '待规划');
  assert.equal(comments[0].children[0].commentHtml, '<p>收到</p>');
});

test('extracts images from demand description and comments', () => {
  const images = extractDemandImages({
    id: 'demand-id',
    desc: '![one](/ms/vteam/api/user/file/m68126/download/file-one)\n<img alt="two" src="/ms/vteam/api/user/file/m68126/download/file-two">',
  }, [{
    id: 'comment-id',
    commentHtml: '<p><img src="/ms/vteam/api/user/file/m68126/download/file-three"></p>',
  }]);
  assert.equal(images.length, 3);
  assert.equal(images[0].source, 'description');
  assert.equal(images[0].alt, 'one');
  assert.equal(images[0].projectId, 'm68126');
  assert.equal(images[0].fileId, 'file-one');
  assert.equal(images[1].alt, 'two');
  assert.equal(images[2].source, 'comment');
  assert.equal(images[2].sourceId, 'comment-id');
});
