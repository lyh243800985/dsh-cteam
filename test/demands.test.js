import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDemandFilterBody,
  normalizeDemandPage,
  parseDemandToolArguments,
} from '../src/demands.js';

test('parses demand list pagination and dynamic project input', () => {
  const input = parseDemandToolArguments({
    project_url: 'https://devops.cwoa.net/devops/console/vteam/m68126/twDemand/demand?vmode=table',
    category_id: 'category-1',
    page: 2,
    page_size: 50,
  });
  assert.deepEqual(input, {
    projectId: 'm68126',
    categoryId: 'category-1',
    filters: [],
    page: 2,
    pageSize: 50,
    remember: false,
  });
});

test('uses the configured project for demand list arguments', () => {
  assert.deepEqual(parseDemandToolArguments({}, {
    configuredProjectId: 'm68126',
  }), {
    projectId: 'm68126',
    categoryId: undefined,
    filters: [],
    page: 1,
    pageSize: 20,
    remember: false,
  });
});

test('builds demand list filter body with category and custom filters', () => {
  const input = parseDemandToolArguments({
    project_id: 'm68126',
    category_id: 'd062111934b841dc9d6736d164f756f1',
    filters: [{ name: 'priority', value: ['CENTRAL'] }],
  });
  assert.deepEqual(buildDemandFilterBody(input), [
    { name: 'demandClassify', value: ['d062111934b841dc9d6736d164f756f1'] },
    { name: 'priority', value: ['CENTRAL'] },
    { name: 'exclude', value: [] },
    { name: 'classify_tree_strategy', value: ['true'] },
  ]);
});

test('rejects invalid pagination, duplicate filters, and managed filters', () => {
  assert.throws(() => parseDemandToolArguments({
    project_id: 'm68126',
    page_size: 201,
  }), /page_size/u);
  assert.throws(() => parseDemandToolArguments({
    project_id: 'm68126',
    filters: [
      { name: 'state', value: ['one'] },
      { name: 'state', value: ['two'] },
    ],
  }), /duplicate/u);
  assert.throws(() => parseDemandToolArguments({
    project_id: 'm68126',
    filters: [{ name: 'demandClassify', value: ['category'] }],
  }), /managed/u);
});

test('normalizes Spring pagination and CTeam demand properties', () => {
  const page = normalizeDemandPage({
    records: {
      number: 1,
      size: 20,
      totalElements: 21,
      totalPages: 2,
      first: false,
      last: true,
      content: [{
        property: {
          id: { name: 'id', value: 'demand-id', displayValue: 'demand-id' },
          number: { name: 'number', value: 'p176_1', displayValue: 'p176_1' },
          title: { name: 'title', value: 'A demand', displayValue: 'A demand' },
          priority: { name: 'priority', value: 'CENTRAL', displayValue: '中' },
          state: { name: 'state', value: 'state-id', displayValue: '需求收集' },
          modelTypeId: { name: 'modelTypeId', value: 'type-id', displayValue: 'ITR转需求' },
          follow: { name: 'follow', value: 'true', displayValue: 'true' },
          finished: { name: 'finished', value: 'false', displayValue: 'false' },
          expired: { name: 'expired', value: false, displayValue: false },
        },
      }],
    },
  });
  assert.equal(page.page, 2);
  assert.equal(page.totalElements, 21);
  assert.equal(page.demands[0].id, 'demand-id');
  assert.equal(page.demands[0].stateName, '需求收集');
  assert.equal(page.demands[0].follow, true);
  assert.equal(page.demands[0].expired, false);
  assert.equal(page.demands[0].fields.priority.displayValue, '中');
});
