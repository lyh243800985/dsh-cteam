const DEFAULT_DEMAND_MODEL = {
  modelTypeId: '385e07e47da04dfc9e5aae212c5ff0e6',
  typeId: '93a059dc2e744c95ae88be4828916db5',
  typeName: 'Story',
  templateId: '3d8db14b19874fec83f69719aeba3ff2',
};

const DEFAULT_RELATION_ISSUE = Object.freeze({
  '73b3cd198dc911ed9a33525400035dda': [],
  '73b3cffc8dc911ed9a33525400035dda': [],
  '73b3d21d8dc911ed9a33525400035dda': [],
  '077450cbd68440f68cbe2799313226a7': [],
  undefined: [],
});

function stringValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function escapeHtml(value) {
  return stringValue(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function htmlParagraph(lines) {
  const text = lines.join('\n').trim();
  if (!text) return '';
  return `<p>${escapeHtml(text).replace(/\n/gu, '<br>')}</p>`;
}

export function markdownToCteamHtml(markdown) {
  const lines = stringValue(markdown).replace(/\r\n?/gu, '\n').split('\n');
  const html = [];
  let paragraph = [];

  const flushParagraph = () => {
    const block = htmlParagraph(paragraph);
    if (block) html.push(block);
    paragraph = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading !== null) {
      flushParagraph();
      const level = Math.min(heading[1].length, 6);
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/u.exec(line.trim());
    if (image !== null) {
      flushParagraph();
      html.push(`<p><img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}" style="max-width:100%;" contenteditable="false"></p>`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return html.join('');
}

export function uploadedFileId(uploadResult) {
  const value = typeof uploadResult === 'object' && uploadResult !== null && !Array.isArray(uploadResult)
    ? uploadResult
    : {};
  return stringValue(value.id ?? value.fileId ?? value.data?.id);
}

export function replaceImagePlaceholders(markdown, projectId, uploadedImages) {
  let next = stringValue(markdown);
  for (const image of uploadedImages) {
    if (!image.placeholder || !image.fileId) continue;
    const downloadUrl = `/ms/vteam/api/user/file/${encodeURIComponent(projectId)}/download/${encodeURIComponent(image.fileId)}`;
    next = next.split(image.placeholder).join(downloadUrl);
  }
  return next;
}

export function extractPastedImagePlaceholders(markdown) {
  return Array.from(new Set(stringValue(markdown).match(/cteam-pasted-image:\/\/[^)\s]+/gu) ?? []));
}

function normalizeFieldDefinitions(definitions) {
  return Array.isArray(definitions)
    ? definitions.filter((field) => typeof field === 'object' && field !== null && !Array.isArray(field))
    : [];
}

function normalizeSubmittedFields(fields) {
  return typeof fields === 'object' && fields !== null && !Array.isArray(fields) ? fields : {};
}

function nonEmptyFieldValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return stringValue(value).trim() !== '';
}

function serializeFieldValue(value) {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join(',');
  return stringValue(value);
}

export function selectDemandModel(modelData, overrides = {}) {
  const groups = Array.isArray(modelData?.issueModelTypes) ? modelData.issueModelTypes : [];
  const demandGroup = groups.find((group) => group?.typeClassify === 'DEMAND');
  const types = Array.isArray(demandGroup?.issueModelTypes) ? demandGroup.issueModelTypes : [];
  const selected = types.find((type) => {
    if (overrides.modelTypeId && type.id === overrides.modelTypeId) return true;
    if (overrides.typeId && type.typeId === overrides.typeId) return true;
    if (overrides.typeName && type.typeName === overrides.typeName) return true;
    return false;
  }) ?? types.find((type) => type.apply === true && type.typeName === 'Story')
    ?? types.find((type) => type.apply === true)
    ?? types[0];

  if (selected === undefined) return { ...DEFAULT_DEMAND_MODEL, ...overrides };
  return {
    modelTypeId: stringValue(overrides.modelTypeId ?? selected.id),
    typeId: stringValue(overrides.typeId ?? selected.typeId),
    typeName: stringValue(overrides.typeName ?? selected.typeName),
    templateId: stringValue(overrides.templateId ?? selected.templateId),
  };
}

export function buildDemandCreateBody(input) {
  const submittedFields = normalizeSubmittedFields(input.fields);
  const definitions = normalizeFieldDefinitions(input.fieldDefinitions);
  const model = input.model ?? DEFAULT_DEMAND_MODEL;
  const desc = stringValue(input.descMarkdown ?? input.descHtml);
  const labelValue = submittedFields.labelId ?? submittedFields.label ?? [];
  const body = {
    title: stringValue(input.title),
    modelTypeId: model.modelTypeId,
    priority: stringValue(submittedFields.priority || 'CENTRAL'),
    editorType: 'MARKDOWN',
    desc,
    parentId: stringValue(submittedFields.parentId ?? submittedFields.parent_demand),
    relationIssue: { ...DEFAULT_RELATION_ISSUE },
    demandClassify: stringValue(input.categoryId),
    fileVO: [],
    labelId: Array.isArray(labelValue) ? labelValue.map(stringValue).filter(Boolean) : [stringValue(labelValue)].filter(Boolean),
    instanceValue: [],
  };

  for (const field of definitions) {
    const name = stringValue(field.name || field.id);
    if (!name || name === 'priority' || name === 'label' || name === 'parent_demand' || name === 'parentId') continue;
    const rawValue = Object.hasOwn(submittedFields, field.id)
      ? submittedFields[field.id]
      : Object.hasOwn(submittedFields, name)
        ? submittedFields[name]
        : '';
    const value = serializeFieldValue(rawValue);
    const fieldId = stringValue(field.fieldId || field.id);
    if (!fieldId) continue;
    body.instanceValue.push({
      fieldId,
      value,
    });
  }
  return body;
}

export function demandUrl(baseUrl, projectId, issueId) {
  const url = new URL(`/devops/console/vteam/${encodeURIComponent(projectId)}/twDemand`, baseUrl);
  url.searchParams.set('vmode', 'table');
  if (issueId) url.searchParams.set('id', issueId);
  return url.toString();
}

export function normalizeCreatedIssue(data) {
  const issue = typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {};
  return {
    id: stringValue(issue.id ?? issue.issueId),
    number: stringValue(issue.number ?? issue.issueNo),
    title: stringValue(issue.title),
    raw: data,
  };
}
