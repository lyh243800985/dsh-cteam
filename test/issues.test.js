import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildIssueFilterBody,
  issueSelectType,
  normalizeIssueFiltersResult,
  normalizeIssuePage,
  normalizeQueryFilterFields,
  parseIssueListToolArguments,
} from '../src/issues.js';
import { parseDemandDetailToolArguments } from '../src/details.js';

test('parses bug list arguments with configured project', () => {
  assert.deepEqual(parseIssueListToolArguments({
    filters: [{ name: 'relation', value: ['CREATED'] }],
    page: 3,
    page_size: 10,
  }, {
    configuredProjectId: 'm68126',
    defaultIssueType: 'BUG',
  }), {
    projectId: 'm68126',
    issueType: 'BUG',
    categoryId: undefined,
    filters: [{ name: 'relation', value: ['CREATED'] }],
    page: 3,
    pageSize: 10,
    remember: false,
  });
});

test('builds issue list filter body with category and CTeam defaults', () => {
  const input = parseIssueListToolArguments({
    project_id: 'm68126',
    issue_type: 'bug',
    category_id: 'category-id',
    filters: [{ name: 'priority', value: ['HIGH'] }],
  });
  assert.deepEqual(buildIssueFilterBody(input), [
    { name: 'demandClassify', value: ['category-id'] },
    { name: 'priority', value: ['HIGH'] },
    { name: 'exclude', value: [] },
    { name: 'classify_tree_strategy', value: ['true'] },
  ]);
});

test('rejects unsupported issue types and managed filters', () => {
  assert.throws(() => parseIssueListToolArguments({
    project_id: 'm68126',
    issue_type: 'story',
  }), /issue_type/u);
  assert.throws(() => parseIssueListToolArguments({
    project_id: 'm68126',
    filters: [{ name: 'exclude', value: [] }],
  }), /managed/u);
});

test('maps issue types to dedicated saved filter types', () => {
  assert.equal(issueSelectType('DEMAND'), 'DEMAND_SELECT');
  assert.equal(issueSelectType('bug'), 'BUG_SELECT');
  assert.equal(issueSelectType('TASK'), 'TASK_SELECT');
  assert.throws(() => issueSelectType('BOARD'), /issue_type/u);
});

test('normalizes issue pages from CTeam table responses', () => {
  const page = normalizeIssuePage({
    records: {
      number: 0,
      size: 5,
      totalElements: 4343,
      totalPages: 869,
      first: true,
      last: false,
      content: [{
        property: {
          id: { name: 'id', value: 'bug-id', displayValue: 'bug-id' },
          number: { name: 'number', value: 'p176_7557', displayValue: 'p176_7557' },
          title: { name: 'title', value: 'A bug', displayValue: 'A bug' },
          priority: { name: 'priority', value: 'HIGH', displayValue: '高' },
          state: { name: 'state', value: 'state-id', displayValue: '待修复' },
          modelTypeId: { name: 'modelTypeId', value: 'bug-type', displayValue: '缺陷' },
          dispatch: { name: 'dispatch', value: 'lisi', displayValue: '李四' },
        },
      }],
    },
  });
  assert.equal(page.page, 1);
  assert.equal(page.pageSize, 5);
  assert.equal(page.totalElements, 4343);
  assert.equal(page.issues[0].id, 'bug-id');
  assert.equal(page.issues[0].number, 'p176_7557');
  assert.equal(page.issues[0].priorityName, '高');
  assert.equal(page.issues[0].dispatchName, '李四');
});

test('normalizes personal and team quick filters', () => {
  const filters = normalizeIssueFiltersResult([
    {
      id: 'personal-id',
      projectId: 'm68126',
      name: '我创建',
      condition: '[{"name":"relation","value":["CREATED"],"sort":0}]',
      scope: 0,
      up: true,
      sort: 1,
    },
    {
      id: 'team-id',
      projectId: 'm68126',
      name: '团队未关闭',
      condition: '[{"name":"state","value":["OPEN"],"sort":0}]',
      scope: 1,
      up: false,
      sort: 2,
    },
  ]);
  assert.equal(filters.filters.length, 2);
  assert.equal(filters.personalFilters.length, 1);
  assert.equal(filters.teamFilters.length, 1);
  assert.equal(filters.personalFilters[0].conditions[0].name, 'relation');
  assert.equal(filters.teamFilters[0].scopeName, 'team');
});

test('normalizes query filter field metadata', () => {
  const fields = normalizeQueryFilterFields([
    { id: 'priority-id', name: 'priority', label: '优先级', type: 'SELECT', sys: true, sort: 3 },
    { id: 'state-id', name: 'state', label: '状态', type: 'MULTI_SELECT', tenantConfigurable: true },
  ]);
  assert.deepEqual(fields, [
    {
      id: 'priority-id',
      name: 'priority',
      label: '优先级',
      type: 'SELECT',
      sys: true,
      sort: 3,
      tenantConfigurable: false,
    },
    {
      id: 'state-id',
      name: 'state',
      label: '状态',
      type: 'MULTI_SELECT',
      sys: false,
      sort: 0,
      tenantConfigurable: true,
    },
  ]);
});

test('parses generic issue detail arguments from an issue URL', () => {
  assert.deepEqual(parseDemandDetailToolArguments({
    issue_url: 'https://devops.cwoa.net/devops/console/vteam/m68126/twBug?vmode=table&id=f214e6e75085497b9373a026014f3060',
  }), {
    projectId: 'm68126',
    issueId: 'f214e6e75085497b9373a026014f3060',
  });
});
