import {
  buildIssueFilterBody,
  normalizeIssueFilters,
  normalizeIssuePage,
  normalizeIssueRecord,
  parseIssueListToolArguments,
} from './issues.js';

export const normalizeDemandFilters = normalizeIssueFilters;

export function parseDemandToolArguments(args, options = {}) {
  const input = parseIssueListToolArguments(args, {
    ...options,
    defaultIssueType: 'DEMAND',
  });
  const { issueType: _issueType, ...demandInput } = input;
  return demandInput;
}

export function buildDemandFilterBody(input) {
  return buildIssueFilterBody(input);
}

export const normalizeDemandRecord = normalizeIssueRecord;

export function normalizeDemandPage(data) {
  const page = normalizeIssuePage(data);
  return {
    ...page,
    demands: page.issues,
  };
}
