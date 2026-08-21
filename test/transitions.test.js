import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTransitionSubmitExample,
  normalizeFieldOptions,
  normalizeTransitionCandidates,
  normalizeTransitionFields,
  normalizeTransitionNodes,
  parseIssueTransitionToolArguments,
  shouldFetchFieldOptions,
} from '../src/transitions.js';

test('parses transition arguments and infers bug type from URL', () => {
  assert.deepEqual(parseIssueTransitionToolArguments({
    issue_url: 'https://devops.cwoa.net/devops/console/vteam/m68126/twBug?vmode=table&id=f214e6e75085497b9373a026014f3060',
    option_limit: 20,
  }), {
    projectId: 'm68126',
    issueId: 'f214e6e75085497b9373a026014f3060',
    issueType: 'BUG',
    includeFieldOptions: true,
    optionLimit: 20,
  });
});

test('transition arguments default to bug when type is omitted', () => {
  assert.equal(parseIssueTransitionToolArguments({
    issue_id: 'f214e6e75085497b9373a026014f3060',
  }, {
    configuredProjectId: 'm68126',
  }).issueType, 'BUG');
});

test('normalizes transition node envelope', () => {
  const result = normalizeTransitionNodes({
    changed: false,
    data: [
      { id: '867', name: '新', operation: true },
      { id: '4230', name: '已转需求', operation: false },
    ],
  }, '867');
  assert.equal(result.changed, false);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes[0].current, true);
  assert.equal(result.nodes[0].operation, true);
  assert.equal(result.nodes[1].operation, false);
});

test('normalizes required transition fields and option eligibility', () => {
  const fields = normalizeTransitionFields([
    {
      id: '4501',
      name: 'developers',
      label: '开发人员',
      type: 'USER',
      required: true,
      flowField: true,
    },
    {
      id: 'textarea-id',
      name: 'ZCD9cCnfiK',
      label: '需求链接',
      type: 'TEXTAREA',
      required: true,
    },
  ]);
  assert.equal(fields[0].id, '4501');
  assert.equal(fields[0].required, true);
  assert.equal(shouldFetchFieldOptions(fields[0]), true);
  assert.equal(shouldFetchFieldOptions(fields[1]), false);
});

test('normalizes candidates and field options', () => {
  assert.deepEqual(normalizeTransitionCandidates({
    users: [{ first: 'linyuhan', second: '林钰涵[linyuhan]' }],
    roles: [{ value: 'role-id', displayValue: '测试' }],
  }), {
    users: [{ value: 'linyuhan', displayValue: '林钰涵[linyuhan]' }],
    roles: [{ value: 'role-id', displayValue: '测试' }],
  });

  assert.deepEqual(normalizeFieldOptions([
    { value: 'qTJ2OJKPro', displayValue: '代码缺陷' },
    { value: 'PbtioilQDD', displayValue: '性能缺陷' },
  ], 1), {
    options: [{ value: 'qTJ2OJKPro', displayValue: '代码缺陷' }],
    truncated: true,
    total: 2,
  });
});

test('builds transition submit example with operator_user handled separately', () => {
  const example = buildTransitionSubmitExample({
    projectId: 'm68126',
    issueId: 'issue-id',
  }, {
    id: 'target-state',
    fields: [
      { id: 'bug_reason', name: 'bug_reason', label: '缺陷原因', required: true },
      { id: 'operator-id', name: 'operator_user', label: '经办人', required: true },
      { id: 'note-id', name: 'note', label: '备注', required: false },
    ],
  });
  assert.equal(example.method, 'POST');
  assert.equal(example.path, '/ms/vteam/api/user/issue_direction/m68126/next');
  assert.deepEqual(example.body.directionFields, [
    { fieldId: 'bug_reason', value: '<缺陷原因>' },
  ]);
  assert.deepEqual(example.body.operators, ['<operator username>']);
});
