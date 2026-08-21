import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeSubmissionFieldsWithPreviewFields,
  mergeSubmissionFieldsWithTemplateFields,
  normalizeSubmissionFields,
  normalizeSubmissionOperation,
  submissionFieldsForOperation,
  toSubmissionFormOptions,
} from '../src/index.js';

test('defaults PRD submission fields for demand creation', () => {
  const fields = submissionFieldsForOperation('create');
  assert.deepEqual(fields.map((field) => field.id), [
    'priority',
    'parent_demand',
    '3Q3brZUOok',
    'version',
    'iteration',
    'operator_user',
    'developers',
  ]);
  assert.equal(fields.some((field) => field.id === 'modelTypeId'), false);
  assert.deepEqual(fields.filter((field) => field.required).map((field) => field.id), [
    '3Q3brZUOok',
    'version',
  ]);
  assert.equal(fields.find((field) => field.id === 'priority').defaultValue, 'CENTRAL');
  assert.equal(fields.find((field) => field.id === 'version').optionLookupMode, 'by_name');
  assert.equal(fields.find((field) => field.id === 'developers').multiple, true);
});

test('preserves explicit PRD submission fields', () => {
  assert.deepEqual(submissionFieldsForOperation('create', [{
    id: 'custom',
    label: '自定义字段',
    type: 'TEXTAREA',
    required: true,
  }]), [{
    id: 'custom',
    name: 'custom',
    label: '自定义字段',
    type: 'TEXTAREA',
    required: true,
    multiple: false,
    options: [],
    optionLookupKey: 'custom',
    optionLookupMode: 'option',
  }]);
});

test('normalizes submission option values for the conversation form', () => {
  assert.deepEqual(toSubmissionFormOptions([
    { value: 'HIGH', displayValue: '高' },
    { id: 'LOW', label: '低' },
  ], 1), {
    options: [{ value: 'HIGH', label: '高' }],
    truncated: true,
    total: 2,
  });
});

test('normalizes submission operations and field option lookup keys', () => {
  assert.equal(normalizeSubmissionOperation('add'), 'create');
  assert.equal(normalizeSubmissionOperation('update'), 'edit');
  assert.equal(normalizeSubmissionOperation(undefined), 'create');
  assert.equal(normalizeSubmissionFields([{
    id: '4501',
    name: 'developers',
    label: '开发人员',
    type: 'USER',
  }])[0].optionLookupKey, 'developers');
  assert.equal(normalizeSubmissionFields([{
    id: 'version',
    option_lookup_mode: 'by_name',
  }])[0].optionLookupMode, 'by_name');
});

test('merges real CTeam preview fields into demand create submission fields', () => {
  const fields = mergeSubmissionFieldsWithPreviewFields(submissionFieldsForOperation('create'), [
    {
      id: '3665',
      name: 'JL1hfJmbxi',
      label: '需求类别',
      type: 'RADIO',
      editable: true,
      sys: false,
      sort: 230,
    },
    {
      id: '2ad140b6e08f498da5f58907c33ae16a',
      name: 'modular',
      label: '模块',
      type: 'SELECT',
      editable: true,
      sys: true,
      sort: 40,
    },
    {
      id: 'createUser',
      name: 'createUser',
      label: '创建人',
      type: 'USER',
      sys: true,
      sort: 2147483637,
    },
  ]);

  assert.equal(fields.some((field) => field.name === 'createUser'), false);
  assert.equal(fields.find((field) => field.name === 'JL1hfJmbxi').label, '需求类别');
  assert.equal(fields.find((field) => field.name === 'JL1hfJmbxi').fieldId, '3665');
  assert.equal(fields.find((field) => field.name === 'JL1hfJmbxi').optionLookupMode, 'by_name');
  assert.equal(fields.find((field) => field.name === 'JL1hfJmbxi').defaultVisible, false);
  assert.equal(fields.find((field) => field.name === 'modular').label, '模块');
  assert.equal(fields.find((field) => field.name === 'modular').defaultVisible, false);
  assert.equal(fields.find((field) => field.name === 'version').required, true);
  assert.equal(fields.find((field) => field.name === 'version').defaultVisible, true);
});

test('uses CTeam template bindings as the default demand create form', () => {
  const fields = mergeSubmissionFieldsWithTemplateFields(submissionFieldsForOperation('create'), [
    {
      fieldId: 'de3782cdccb5490fae66506b5f36d1f4',
      name: '3Q3brZUOok',
      label: '是否向下兼容',
      type: 'RADIO',
      required: true,
    },
    {
      fieldId: 'e0ece899e6254e8a96e97f1732f7a0ce',
      name: 'version',
      label: '版本',
      type: 'SELECT',
      required: true,
    },
    {
      fieldId: 'bbc31f38504142708ce77f3722b8dcb5',
      name: 'operator_user',
      label: '经办人',
      type: 'USER',
      required: false,
    },
    {
      fieldId: '4501',
      name: 'developers',
      label: '开发人员',
      type: 'USER',
      required: false,
    },
    {
      fieldId: '2616091455b24eb7bbda6c612e607a23',
      name: 'estimate_start_time',
      label: '预计开始时间',
      type: 'DATE',
      required: false,
    },
  ]);

  assert.deepEqual(fields.map((field) => field.name), [
    'priority',
    '3Q3brZUOok',
    'version',
    'operator_user',
    'developers',
    'estimate_start_time',
  ]);
  assert.equal(fields.some((field) => field.name === 'parent_demand'), false);
  assert.equal(fields.find((field) => field.name === '3Q3brZUOok').fieldId, 'de3782cdccb5490fae66506b5f36d1f4');
  assert.equal(fields.find((field) => field.name === 'operator_user').multiple, true);
  assert.equal(fields.find((field) => field.name === 'developers').multiple, true);
  assert.equal(fields.find((field) => field.name === 'estimate_start_time').defaultVisible, true);
  assert.deepEqual(fields.filter((field) => field.required).map((field) => field.name), [
    '3Q3brZUOok',
    'version',
  ]);
});
