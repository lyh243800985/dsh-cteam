window.__ModuleLoader__.load({
  id: 'dsh-cteam',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');
    const {
      Button,
      DisclosureRow,
      IconBrowseOutline16,
      IconCloseOutline16,
      IconEditOutline16,
      IconLinkOutline16,
      MarkdownText,
    } = require('@deepseek-ai/dsh-client-ui-primitives');

    const DETAIL_PRESENTATION_MARKER = 'dsh-cteam-detail-v1:';
    const PRD_AUTHORING_PRESENTATION_MARKER = 'dsh-cteam-prd-authoring-v1:';
    const SUBMISSION_PRESENTATION_MARKER = 'dsh-cteam-submission-v1:';
    const WIKI_DETAIL_PRESENTATION_MARKER = 'dsh-cteam-wiki-detail-v1:';
    const WIKI_IMPORT_PRESENTATION_MARKER = 'dsh-cteam-wiki-import-v1:';
    const CTEAM_BASE_URL = 'https://devops.cwoa.net';
    const PASTED_IMAGE_URL_PREFIX = 'cteam-pasted-image://';
    const AUTHORING_AUTOSAVE_PREFIX = 'dsh-cteam-prd-autosave:';
    const LAST_SUBMISSION_PREFIX = 'dsh-cteam-last-submission:';
    const AUTHORING_AUTOSAVE_INTERVAL_MS = 5000;
    const workbenchBySession = new Map();
    const listenersBySession = new Map();
    const pastedImagesByWorkspace = new Map();
    const authoringStateBySession = new Map();
    const pendingSubmissionBySession = new Map();
    const submissionResultBySession = new Map();
    const authoringLocksBySession = new Map();
    const authoringListenersBySession = new Map();
    const DEFAULT_AUTHORING_LOCK_STATE = { locked: false, reason: '' };
    const EMPTY_WORKBENCH = { activeId: '', items: [] };

    function itemIdForPayload(payload) {
      if (payload?.kind === 'authoring') {
        return `authoring:${authoringWorkspaceKey(payload.workspace)}`;
      }
      if (payload?.kind === 'wiki') {
        const wiki = payload.value?.wiki ?? {};
        return `wiki:${text(payload.value?.libraryId)}:${text(wiki.id || payload.value?.wikiId)}`;
      }
      const detail = payload?.kind === 'detail' ? payload.detail : payload;
      const issue = getIssue(detail);
      return `detail:${text(issue.id || issue.number || issue.url || JSON.stringify(detail).slice(0, 80), 'unknown')}`;
    }

    function itemMetaForPayload(payload) {
      if (payload?.kind === 'authoring') {
        const workspace = payload.workspace ?? {};
        return {
          label: text(workspace.title, '未命名 PRD'),
          eyebrow: 'PRD 草稿',
        };
      }
      if (payload?.kind === 'wiki') {
        const wiki = payload.value?.wiki ?? {};
        return {
          label: text(wiki.title, '未命名 Wiki'),
          eyebrow: 'Wiki',
        };
      }
      const detail = payload?.kind === 'detail' ? payload.detail : payload;
      const issue = getIssue(detail);
      return {
        label: text(issue.title, '未命名单据'),
        eyebrow: text(issue.number || issue.id, 'CTeam 单据'),
      };
    }

    function getWorkbench(sessionId) {
      return workbenchBySession.get(sessionId) ?? EMPTY_WORKBENCH;
    }

    function getSelected(sessionId) {
      const state = workbenchBySession.get(sessionId);
      if (!state || state.items.length === 0) return null;
      const active = state.items.find((item) => item.id === state.activeId) ?? state.items[state.items.length - 1];
      return active?.payload ?? null;
    }

    function subscribe(sessionId, callback) {
      let listeners = listenersBySession.get(sessionId);
      if (listeners === undefined) {
        listeners = new Set();
        listenersBySession.set(sessionId, listeners);
      }
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
        if (listeners.size === 0) listenersBySession.delete(sessionId);
      };
    }

    function select(sessionId, detail) {
      if (!sessionId || detail === null) return;
      if (detail?.kind === 'authoring') restoreAuthoringStateFromWorkspace(sessionId, detail.workspace);
      const id = itemIdForPayload(detail);
      const meta = itemMetaForPayload(detail);
      const current = workbenchBySession.get(sessionId) ?? EMPTY_WORKBENCH;
      const existingIndex = current.items.findIndex((item) => item.id === id);
      const nextItem = {
        id,
        payload: detail,
        label: meta.label,
        eyebrow: meta.eyebrow,
        updatedAt: Date.now(),
      };
      const items = existingIndex >= 0
        ? current.items.map((item, index) => index === existingIndex ? nextItem : item)
        : [...current.items, nextItem].slice(-8);
      workbenchBySession.set(sessionId, {
        activeId: id,
        items,
      });
      for (const listener of listenersBySession.get(sessionId) ?? []) listener();
    }

    function selectWorkbenchItem(sessionId, itemId) {
      const state = workbenchBySession.get(sessionId);
      if (!state || !state.items.some((item) => item.id === itemId)) return;
      workbenchBySession.set(sessionId, {
        ...state,
        activeId: itemId,
      });
      for (const listener of listenersBySession.get(sessionId) ?? []) listener();
    }

    function updateWorkbenchItem(sessionId, itemId, patch) {
      const state = workbenchBySession.get(sessionId);
      if (!state) return;
      let changed = false;
      const items = state.items.map((item) => {
        if (item.id !== itemId) return item;
        const next = { ...item, ...patch, updatedAt: Date.now() };
        changed = next.label !== item.label || next.eyebrow !== item.eyebrow || next.payload !== item.payload;
        return changed ? next : item;
      });
      if (!changed) return;
      workbenchBySession.set(sessionId, {
        ...state,
        items,
      });
      for (const listener of listenersBySession.get(sessionId) ?? []) listener();
    }

    function subscribeAuthoring(sessionId, callback) {
      let listeners = authoringListenersBySession.get(sessionId);
      if (listeners === undefined) {
        listeners = new Set();
        authoringListenersBySession.set(sessionId, listeners);
      }
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
        if (listeners.size === 0) authoringListenersBySession.delete(sessionId);
      };
    }

    function notifyAuthoring(sessionId) {
      for (const listener of authoringListenersBySession.get(sessionId) ?? []) listener();
    }

    function setAuthoringLocked(sessionId, locked, reason = '') {
      if (!sessionId) return;
      authoringLocksBySession.set(sessionId, {
        locked: locked === true,
        reason: text(reason),
      });
      notifyAuthoring(sessionId);
    }

    function getAuthoringLocked(sessionId) {
      return authoringLocksBySession.get(sessionId) ?? DEFAULT_AUTHORING_LOCK_STATE;
    }

    function setSubmissionResult(sessionId, result) {
      if (!sessionId) return;
      if (result === null) submissionResultBySession.delete(sessionId);
      else submissionResultBySession.set(sessionId, result);
      notifyAuthoring(sessionId);
    }

    function getSubmissionResult(sessionId) {
      return submissionResultBySession.get(sessionId) ?? null;
    }

    function setPendingSubmission(sessionId, submission) {
      if (!sessionId) return;
      if (submission === null) pendingSubmissionBySession.delete(sessionId);
      else pendingSubmissionBySession.set(sessionId, submission);
    }

    function getPendingSubmission(sessionId) {
      return pendingSubmissionBySession.get(sessionId) ?? null;
    }

    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    function parseMarkedPayload(block, marker) {
      if (!isRecord(block) || block.kind !== 'tool-result' || block.isError) return null;
      const view = isRecord(block.resultView) && block.resultView.card === 'generic'
        ? block.resultView
        : null;
      const content = Array.isArray(view?.content) ? view.content : [];
      const payloadText = content.find((item) => item?.type === 'text' && typeof item.text === 'string')?.text;
      if (typeof payloadText === 'string' && payloadText.startsWith(marker)) {
        try {
          const parsed = JSON.parse(payloadText.slice(marker.length));
          if (isRecord(parsed)) return parsed;
        } catch {
          // Fall through to durable metadata when the derived view is malformed.
        }
      }
      return null;
    }

    function parseDetail(block) {
      const parsed = parseMarkedPayload(block, DETAIL_PRESENTATION_MARKER);
      if (parsed !== null) return parsed;
      if (!isRecord(block) || block.kind !== 'tool-result' || block.isError) return null;
      const meta = isRecord(block.meta) ? block.meta : null;
      return meta && (isRecord(meta.demand) || isRecord(meta.issue)) ? meta : null;
    }

    function parseAuthoring(block) {
      return parseMarkedPayload(block, PRD_AUTHORING_PRESENTATION_MARKER);
    }

    function parseCteamPayload(block) {
      const authoring = parseAuthoring(block);
      if (authoring !== null) return { kind: 'authoring', workspace: authoring };
      const wiki = parseWikiPayload(block);
      if (wiki !== null) return wiki;
      const detail = parseDetail(block);
      if (detail !== null) return { kind: 'detail', detail };
      return null;
    }

    function parseSubmissionPayload(block) {
      const parsed = parseMarkedPayload(block, SUBMISSION_PRESENTATION_MARKER);
      if (isRecord(parsed)) return parsed;
      if (!isRecord(block) || block.kind !== 'tool-result' || block.isError) return null;
      const meta = isRecord(block.meta) ? block.meta : null;
      return meta;
    }

    function parseWikiDetail(block) {
      const parsed = parseMarkedPayload(block, WIKI_DETAIL_PRESENTATION_MARKER);
      return isRecord(parsed) && isRecord(parsed.wiki) ? parsed : null;
    }

    function parseWikiPayload(block) {
      const wiki = parseWikiDetail(block);
      if (wiki !== null) return { kind: 'wiki', value: wiki };
      return null;
    }

    function parseWikiImportPayload(block) {
      const parsed = parseMarkedPayload(block, WIKI_IMPORT_PRESENTATION_MARKER);
      if (isRecord(parsed)) return parsed;
      if (!isRecord(block) || block.kind !== 'tool-result' || block.isError) return null;
      return isRecord(block.meta) ? block.meta : null;
    }

    function parseSubmissionResult(block) {
      const meta = parseSubmissionPayload(block);
      if (!meta || meta.dryRun === true || meta.succeeded === false || typeof meta.markdown !== 'string') return null;
      return meta;
    }

    function toolResultText(block) {
      const content = [
        ...(Array.isArray(block?.content) ? block.content : []),
        ...(Array.isArray(block?.result?.content) ? block.result.content : []),
      ];
      const fromContent = content.map((item) => {
        if (typeof item?.text === 'string') return item.text;
        if (typeof item?.content === 'string') return item.content;
        return '';
      }).filter(Boolean).join('\n');
      return [
        fromContent,
        typeof block?.text === 'string' ? block.text : '',
        typeof block?.result === 'string' ? block.result : '',
      ].filter(Boolean).join('\n');
    }

    function failedSubmissionText(value) {
      return /(?:CTeam demand create failed|上传失败|创建失败|error=|failed)/iu.test(text(value));
    }

    function fallbackSubmissionResult(sessionId, block) {
      const pending = getPendingSubmission(sessionId);
      if (!pending) return null;
      const source = toolResultText(block);
      const issueUrl = source.match(/https?:\/\/\S+/iu)?.[0] ?? '';
      const issueNumber = source.match(/\b(?:p|P)\d+_\d+\b/u)?.[0] ?? '';
      return {
        ...pending,
        projectId: pending.projectId,
        dryRun: false,
        succeeded: true,
        markdown: pending.markdown,
        uploadedImages: [],
        issueUrl,
        issue: {
          id: '',
          number: issueNumber,
          title: pending.title,
          raw: {},
        },
      };
    }

    function cteamFileDownloadUrl(projectId, fileId) {
      if (!projectId || !fileId) return '';
      return `/ms/vteam/api/user/file/${encodeURIComponent(projectId)}/download/${encodeURIComponent(fileId)}`;
    }

    function attachSubmissionPreviewImages(sessionId, result) {
      if (!isRecord(result)) return result;
      const pending = getPendingSubmission(sessionId);
      const sourceImages = Array.isArray(pending?.images) ? pending.images : [];
      const uploadedImages = Array.isArray(result.uploadedImages) ? result.uploadedImages : [];
      if (sourceImages.length === 0 || uploadedImages.length === 0) return result;
      const byPlaceholder = new Map(sourceImages.map((image) => [text(image.url || image.placeholder), image]));
      const previewImages = uploadedImages.map((image) => {
        const source = byPlaceholder.get(text(image.placeholder || image.url));
        const downloadUrl = text(image.downloadUrl) || cteamFileDownloadUrl(result.projectId, text(image.fileId));
        return {
          source: 'authoring',
          sourceId: text(pending?.workspaceKey || pending?.workspaceId),
          url: downloadUrl,
          dataUrl: text(source?.dataUrl),
          alt: text(source?.alt || image.alt, 'enter image description here'),
        };
      }).filter((image) => image.url && image.dataUrl);
      if (previewImages.length === 0) return result;
      return {
        ...result,
        previewImages,
      };
    }

    function getIssue(detail) {
      return detail?.demand ?? detail?.issue ?? {};
    }

    function text(value, fallback = '') {
      if (value === undefined || value === null || value === '') return fallback;
      return String(value);
    }

    function shorten(value, max = 80) {
      const input = text(value);
      return input.length > max ? `${input.slice(0, max - 1)}…` : input;
    }

    function formatDate(value) {
      const input = text(value);
      if (!input) return '—';
      const date = new Date(input);
      return Number.isNaN(date.getTime()) ? input : date.toLocaleString();
    }

    function cteamUrl(value) {
      const input = text(value);
      if (!input) return '';
      if (/^https?:\/\//iu.test(input)) return input;
      return `${CTEAM_BASE_URL}${input.startsWith('/') ? '' : '/'}${input}`;
    }

    function imagePreviewUrl(value) {
      const input = text(value);
      if (!input) return '';
      if (/^(?:https?:|data:image\/|blob:)/iu.test(input)) return input;
      return cteamUrl(input);
    }

    function issueUrl(detail) {
      const issue = getIssue(detail);
      if (detail?.sourceUrl) return cteamUrl(detail.sourceUrl);
      const isBug = text(detail?.issueType).toUpperCase() === 'BUG';
      const moduleName = isBug ? 'twBug' : 'twDemand';
      const pageName = isBug ? 'bug' : 'demand';
      const projectId = encodeURIComponent(text(detail?.projectId));
      const issueId = encodeURIComponent(text(issue.id));
      return `${CTEAM_BASE_URL}/devops/console/vteam/${projectId}/${moduleName}/${pageName}?vmode=table&id=${issueId}`;
    }

    function safeDownloadName(value, fallback = 'cteam-prd') {
      const normalized = text(value, fallback).replace(/[\\/:*?"<>|]+/gu, '-').replace(/\s+/gu, ' ').trim();
      return normalized || fallback;
    }

    function downloadMarkdownCopy(result, options = {}) {
      const markdown = text(options.markdown ?? result?.markdown);
      if (!markdown) return;
      const issue = isRecord(result.issue) ? result.issue : {};
      const suffix = text(options.suffix);
      const baseName = text(options.filename || `${text(issue.number || issue.id || result.title, 'cteam-prd')} ${text(result.title)}`.trim());
      const name = safeDownloadName(`${baseName}${suffix ? ` ${suffix}` : ''}`);
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${name}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    function plainComment(value) {
      return text(value)
        .replace(/<br\s*\/?>/giu, '\n')
        .replace(/<\/p\s*>/giu, '\n')
        .replace(/<[^>]+>/gu, '')
        .replace(/&nbsp;/giu, ' ')
        .replace(/&amp;/giu, '&')
        .replace(/&lt;/giu, '<')
        .replace(/&gt;/giu, '>')
        .replace(/&#39;/giu, "'")
        .replace(/&quot;/giu, '"')
        .replace(/[ \t]+\n/gu, '\n')
        .trim();
    }

    function parseRichSegments(value) {
      const source = text(value);
      const segments = [];
      const imagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu;
      let cursor = 0;
      for (const match of source.matchAll(imagePattern)) {
        const index = match.index ?? 0;
        if (index > cursor) segments.push({ type: 'text', value: source.slice(cursor, index) });
        const htmlAlt = match[0].match(/\balt=["']([^"']*)["']/iu)?.[1];
        segments.push({
          type: 'image',
          url: match[2] || match[3],
          alt: match[1] ?? htmlAlt ?? '',
        });
        cursor = index + match[0].length;
      }
      if (cursor < source.length) segments.push({ type: 'text', value: source.slice(cursor) });
      return segments.length > 0 ? segments : [{ type: 'text', value: source }];
    }

    function findRichImage(images, source, sourceId, url, used) {
      const exactIndex = images.findIndex((image, index) => {
        return !used.has(index)
          && image.source === source
          && text(image.sourceId) === text(sourceId)
          && image.url === url;
      });
      if (exactIndex >= 0) {
        used.add(exactIndex);
        return images[exactIndex];
      }
      if (source === 'authoring' && text(url).startsWith(PASTED_IMAGE_URL_PREFIX)) return undefined;
      const fallbackIndex = images.findIndex((image, index) => {
        return !used.has(index) && image.source === source && text(image.sourceId) === text(sourceId);
      });
      if (fallbackIndex >= 0) used.add(fallbackIndex);
      return fallbackIndex >= 0 ? images[fallbackIndex] : undefined;
    }

    function renderRichContent(value, source, sourceId, images, keyPrefix) {
      const used = new Set();
      const segments = parseRichSegments(value);
      return React.createElement('div', { style: styles.richContent }, segments.map((segment, index) => {
        if (segment.type === 'text') {
          const content = source === 'comment' ? plainComment(segment.value) : segment.value;
          return content.trim()
            ? React.createElement(MarkdownText, { key: `${keyPrefix}-text-${index}`, text: content })
            : null;
        }
        const image = findRichImage(images, source, sourceId, segment.url, used);
        if (!image && source === 'authoring' && text(segment.url).startsWith(PASTED_IMAGE_URL_PREFIX)) {
          return React.createElement('figure', { style: styles.richImageFigure, key: `${keyPrefix}-image-${index}` },
            React.createElement('div', { style: styles.missingImage },
              '图片缓存已丢失，请删除该图片占位符并重新粘贴图片',
            ),
          );
        }
        const imageSrc = text(image?.dataUrl) || imagePreviewUrl(segment.url);
        const alt = text(image?.alt || segment.alt, 'CTeam 图片');
        return React.createElement('figure', { style: styles.richImageFigure, key: `${keyPrefix}-image-${index}` },
          React.createElement('img', {
            src: imageSrc,
            alt,
            loading: 'lazy',
            style: styles.image,
          }),
        );
      }));
    }

    function metaItem(label, value) {
      return React.createElement('div', { style: styles.metaItem, key: label },
        React.createElement('div', { style: styles.metaLabel }, label),
        React.createElement('div', { style: styles.metaValue, title: text(value) }, text(value, '—')),
      );
    }

    function Section({ title, count, children }) {
      return React.createElement('section', { style: styles.section },
        React.createElement('div', { style: styles.sectionHeading },
          React.createElement('h2', { style: styles.sectionTitle }, title),
          count === undefined ? null : React.createElement('span', { style: styles.sectionCount }, count),
        ),
        children,
      );
    }

    function clipboardImageFiles(clipboardData) {
      const files = [];
      for (const item of Array.from(clipboardData?.items ?? [])) {
        if (item?.kind !== 'file' || !/^image\//iu.test(text(item.type))) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      if (files.length > 0) return files;
      for (const file of Array.from(clipboardData?.files ?? [])) {
        if (/^image\//iu.test(text(file.type))) files.push(file);
      }
      return files;
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(text(reader.result)));
        reader.addEventListener('error', () => reject(reader.error ?? new Error('read pasted image failed')));
        reader.readAsDataURL(file);
      });
    }

    function rememberPastedImage(workspaceKey, dataUrl, alt) {
      let images = pastedImagesByWorkspace.get(workspaceKey);
      if (images === undefined) {
        images = new Map();
        pastedImagesByWorkspace.set(workspaceKey, images);
      }
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const url = `${PASTED_IMAGE_URL_PREFIX}${id}`;
      images.set(url, {
        source: 'authoring',
        sourceId: workspaceKey,
        url,
        dataUrl,
        alt,
      });
      return url;
    }

    function pastedImagesForWorkspace(workspaceKey) {
      return Array.from(pastedImagesByWorkspace.get(workspaceKey)?.values() ?? []);
    }

    function pastedImagePlaceholders(markdown) {
      return Array.from(new Set(text(markdown).match(/cteam-pasted-image:\/\/[^)\s]+/giu) ?? []));
    }

    function pastedImagesForMarkdown(workspaceKey, markdown) {
      const placeholders = new Set(pastedImagePlaceholders(markdown));
      if (placeholders.size === 0) return [];
      return pastedImagesForWorkspace(workspaceKey).filter((image) => {
        return placeholders.has(text(image.url)) && text(image.dataUrl).startsWith('data:image/');
      });
    }

    function missingPastedImagePlaceholders(markdown, images) {
      const available = new Set((Array.isArray(images) ? images : []).map((image) => text(image.url)).filter(Boolean));
      return pastedImagePlaceholders(markdown).filter((placeholder) => !available.has(placeholder));
    }

    function rememberAuthoringPreviewImages(workspaceKey, images) {
      if (!Array.isArray(images) || images.length === 0) return;
      let stored = pastedImagesByWorkspace.get(workspaceKey);
      if (stored === undefined) {
        stored = new Map();
        pastedImagesByWorkspace.set(workspaceKey, stored);
      }
      images.forEach((image) => {
        const url = text(image?.url);
        const dataUrl = text(image?.dataUrl);
        if (!url || !dataUrl) return;
        stored.set(url, {
          source: 'authoring',
          sourceId: workspaceKey,
          url,
          dataUrl,
          alt: text(image.alt, 'enter image description here'),
        });
      });
    }

    function rememberPastedImages(workspaceKey, images) {
      if (!Array.isArray(images) || images.length === 0) return;
      let stored = pastedImagesByWorkspace.get(workspaceKey);
      if (stored === undefined) {
        stored = new Map();
        pastedImagesByWorkspace.set(workspaceKey, stored);
      }
      images.forEach((image) => {
        if (!isRecord(image) || !text(image.url).startsWith(PASTED_IMAGE_URL_PREFIX)) return;
        stored.set(text(image.url), {
          source: 'authoring',
          sourceId: workspaceKey,
          url: text(image.url),
          dataUrl: text(image.dataUrl),
          alt: text(image.alt, 'enter image description here'),
        });
      });
    }

    function authoringAutosaveKey(workspaceKey) {
      return `${AUTHORING_AUTOSAVE_PREFIX}${workspaceKey}`;
    }

    function lastSubmissionKey(projectId, operation) {
      return `${LAST_SUBMISSION_PREFIX}${text(projectId, 'default')}:${text(operation, 'create')}`;
    }

    function loadLastSubmission(projectId, operation) {
      try {
        const raw = window.localStorage?.getItem(lastSubmissionKey(projectId, operation));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }

    function saveLastSubmission(projectId, operation, value) {
      try {
        window.localStorage?.setItem(lastSubmissionKey(projectId, operation), JSON.stringify({
          version: 1,
          projectId: text(projectId),
          operation: text(operation, 'create'),
          savedAt: Date.now(),
          ...value,
        }));
      } catch (error) {
        console.error('[dsh-cteam] failed to save last submission form', error);
      }
    }

    function loadAuthoringAutosave(workspaceKey) {
      try {
        const raw = window.localStorage?.getItem(authoringAutosaveKey(workspaceKey));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed) || typeof parsed.markdown !== 'string') return null;
        rememberPastedImages(workspaceKey, parsed.images);
        return {
          title: typeof parsed.title === 'string' ? parsed.title : '',
          markdown: parsed.markdown,
          images: Array.isArray(parsed.images) ? parsed.images : [],
          savedAt: Number(parsed.savedAt) || 0,
        };
      } catch {
        return null;
      }
    }

    function saveAuthoringAutosave(workspaceKey, title, markdown, images) {
      const savedAt = Date.now();
      try {
        window.localStorage?.setItem(authoringAutosaveKey(workspaceKey), JSON.stringify({
          version: 1,
          workspaceKey,
          title: text(title),
          markdown: text(markdown),
          images: Array.isArray(images) ? images : [],
          savedAt,
        }));
        return savedAt;
      } catch (error) {
        console.error('[dsh-cteam] failed to autosave PRD markdown', error);
        return 0;
      }
    }

    function compactDataImageMarkdown(source, workspaceKey) {
      return text(source).replace(/!\[([^\]]*)\]\((data:image\/[^)\s]+)\)/giu, (match, alt, dataUrl) => {
        const label = text(alt, 'enter image description here');
        return pastedImageMarkdown(rememberPastedImage(workspaceKey, dataUrl, label), label);
      });
    }

    function pastedImageMarkdown(url, alt) {
      return `![${text(alt, 'enter image description here')}](${url})`;
    }

    function pastedImageAlt(index, total) {
      const alt = total > 1 ? `enter image description here ${index + 1}` : 'enter image description here';
      return alt;
    }

    function rememberAuthoringState(sessionId, workspace, markdown, workspaceKey, title) {
      if (!sessionId) return;
      const nextTitle = text(title || workspace.title, '未命名需求');
      authoringStateBySession.set(sessionId, {
        projectId: text(workspace.projectId),
        title: nextTitle,
        sourceIssueId: text(workspace.sourceIssueId),
        sourceIssueUrl: text(workspace.sourceIssueUrl),
        workspaceId: text(workspace.workspaceId),
        workspaceKey,
        markdown: text(markdown),
        images: pastedImagesForMarkdown(workspaceKey, markdown),
      });
      updateWorkbenchItem(sessionId, `authoring:${workspaceKey}`, {
        label: nextTitle,
        eyebrow: 'PRD 草稿',
      });
      notifyAuthoring(sessionId);
    }

    function restoreAuthoringStateFromWorkspace(sessionId, workspace) {
      if (!sessionId || !workspace) return;
      const workspaceKey = authoringWorkspaceKey(workspace);
      const autosave = loadAuthoringAutosave(workspaceKey);
      const markdown = autosave?.markdown ?? compactDataImageMarkdown(workspace.markdown, workspaceKey);
      const title = text(autosave?.title || workspace.title, '未命名需求');
      rememberAuthoringState(sessionId, workspace, markdown, workspaceKey, title);
    }

    function applySubmittedAuthoringState(sessionId, result) {
      if (!sessionId || !isRecord(result)) return;
      const pending = getPendingSubmission(sessionId);
      const current = getAuthoringState(sessionId);
      const workspaceKey = text(result.workspaceKey || pending?.workspaceKey || current?.workspaceKey);
      const sourceMarkdown = text(result.sourceMarkdown || pending?.markdown || current?.markdown);
      if (!workspaceKey || !sourceMarkdown) return;
      const title = text(result.title || pending?.title || current?.title, '未命名需求');
      const previewImages = Array.isArray(result.previewImages) ? result.previewImages : [];
      const sourceImages = Array.isArray(pending?.images) && pending.images.length > 0
        ? pending.images
        : pastedImagesForMarkdown(workspaceKey, sourceMarkdown);
      rememberPastedImages(workspaceKey, sourceImages);
      rememberAuthoringPreviewImages(workspaceKey, previewImages);
      const savedAt = saveAuthoringAutosave(workspaceKey, title, sourceMarkdown, sourceImages);
      authoringStateBySession.set(sessionId, {
        projectId: text(result.projectId || pending?.projectId || current?.projectId),
        title,
        sourceIssueId: text(current?.sourceIssueId),
        sourceIssueUrl: text(current?.sourceIssueUrl),
        workspaceId: text(result.workspaceId || pending?.workspaceId || current?.workspaceId),
        workspaceKey,
        markdown: sourceMarkdown,
        images: pastedImagesForMarkdown(workspaceKey, sourceMarkdown),
        savedAt,
      });
      notifyAuthoring(sessionId);
    }

    function getAuthoringState(sessionId) {
      return authoringStateBySession.get(sessionId) ?? null;
    }

    function authoringWorkspaceKey(workspace) {
      return text(workspace.workspaceId)
        || `${text(workspace.projectId)}:${text(workspace.title)}:${text(workspace.sourceIssueId)}`;
    }

    function normalizedField(field) {
      const name = text(field?.name || field?.id);
      const multiple = field?.multiple === true || name === 'operator_user' || name === 'developers';
      return {
        ...field,
        multiple,
      };
    }

    function CteamPrdAuthoringPanel({ workspace, closeDetails, sessionId, tabs }) {
      const workspaceKey = authoringWorkspaceKey(workspace);
      const initialAutosave = loadAuthoringAutosave(workspaceKey);
      const [title, setTitle] = React.useState(() => text(initialAutosave?.title || workspace.title, '未命名需求'));
      const [markdown, setMarkdown] = React.useState(() => initialAutosave?.markdown ?? compactDataImageMarkdown(workspace.markdown, workspaceKey));
      const [pastedImages, setPastedImages] = React.useState(() => pastedImagesForWorkspace(workspaceKey));
      const [lastSavedAt, setLastSavedAt] = React.useState(() => initialAutosave?.savedAt ?? 0);
      const lastAutosavedMarkdownRef = React.useRef(markdown);
      const lastAutosavedTitleRef = React.useRef(title);
      const textareaRef = React.useRef(null);
      const lockState = React.useSyncExternalStore(
        (callback) => subscribeAuthoring(sessionId, callback),
        () => getAuthoringLocked(sessionId),
        () => getAuthoringLocked(sessionId),
      );
      const submittedResult = React.useSyncExternalStore(
        (callback) => subscribeAuthoring(sessionId, callback),
        () => getSubmissionResult(sessionId),
        () => getSubmissionResult(sessionId),
      );
      const appliedSubmissionRef = React.useRef('');
      React.useEffect(() => {
        const nextMarkdown = compactDataImageMarkdown(workspace.markdown, workspaceKey);
        const autosave = loadAuthoringAutosave(workspaceKey);
        const restoredMarkdown = autosave?.markdown ?? nextMarkdown;
        const restoredTitle = text(autosave?.title || workspace.title, '未命名需求');
        setTitle(restoredTitle);
        setMarkdown(restoredMarkdown);
        lastAutosavedMarkdownRef.current = restoredMarkdown;
        lastAutosavedTitleRef.current = restoredTitle;
        setLastSavedAt(autosave?.savedAt ?? 0);
        setPastedImages(pastedImagesForWorkspace(workspaceKey));
        setSubmissionResult(sessionId, null);
        setAuthoringLocked(sessionId, false);
        rememberAuthoringState(sessionId, workspace, restoredMarkdown, workspaceKey, restoredTitle);
      }, [sessionId, workspace, workspaceKey]);
      React.useEffect(() => {
        rememberAuthoringState(sessionId, workspace, markdown, workspaceKey, title);
      }, [title, markdown, pastedImages, sessionId, workspace, workspaceKey]);
      React.useEffect(() => {
        const timer = window.setInterval(() => {
          if (lockState.locked || (markdown === lastAutosavedMarkdownRef.current && title === lastAutosavedTitleRef.current)) return;
          const savedAt = saveAuthoringAutosave(workspaceKey, title, markdown, pastedImagesForMarkdown(workspaceKey, markdown));
          if (!savedAt) return;
          lastAutosavedMarkdownRef.current = markdown;
          lastAutosavedTitleRef.current = title;
          setLastSavedAt(savedAt);
        }, AUTHORING_AUTOSAVE_INTERVAL_MS);
        return () => window.clearInterval(timer);
      }, [lockState.locked, title, markdown, workspaceKey]);
      const pasteImages = React.useCallback((event) => {
        if (lockState.locked) return;
        const files = clipboardImageFiles(event.clipboardData);
        if (files.length === 0) return;
        event.preventDefault();
        const selectionStart = event.currentTarget.selectionStart ?? markdown.length;
        const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
        Promise.all(files.map(readFileAsDataUrl)).then((dataUrls) => {
          const before = markdown.slice(0, selectionStart);
          const after = markdown.slice(selectionEnd);
          const leadingBreak = before.length > 0 && !before.endsWith('\n') ? '\n\n' : '';
          const trailingBreak = after.length > 0 && !after.startsWith('\n') ? '\n\n' : '';
          const imageMarkdown = dataUrls.map((dataUrl, index) => {
            const alt = pastedImageAlt(index, dataUrls.length);
            return pastedImageMarkdown(rememberPastedImage(workspaceKey, dataUrl, alt), alt);
          }).join('\n\n');
          const inserted = `${leadingBreak}${imageMarkdown}${trailingBreak}`;
          setMarkdown(`${before}${inserted}${after}`);
          setPastedImages(pastedImagesForWorkspace(workspaceKey));
          requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            const cursor = selectionStart + inserted.length;
            textarea.focus();
            textarea.setSelectionRange(cursor, cursor);
          });
        }).catch((error) => {
          console.error('[dsh-cteam] failed to paste image into PRD markdown', error);
        });
      }, [lockState.locked, markdown, workspaceKey]);
      const changeMarkdown = React.useCallback((event) => {
        if (lockState.locked) return;
        setMarkdown(compactDataImageMarkdown(event.target.value, workspaceKey));
        setPastedImages(pastedImagesForWorkspace(workspaceKey));
      }, [lockState.locked, workspaceKey]);
      const savedText = lastSavedAt
        ? `已缓存 ${new Date(lastSavedAt).toLocaleTimeString()}`
        : '等待本地缓存';
      const previewMarkdown = typeof submittedResult?.markdown === 'string' && submittedResult.markdown
        ? submittedResult.markdown
        : markdown;
      const previewImages = Array.isArray(submittedResult?.previewImages) ? submittedResult.previewImages : pastedImages;
      React.useEffect(() => {
        if (!submittedResult) return;
        const submissionKey = text(submittedResult.issue?.id || submittedResult.issueUrl || submittedResult.markdown);
        if (!submissionKey || appliedSubmissionRef.current === submissionKey) return;
        appliedSubmissionRef.current = submissionKey;
        const sourceMarkdown = text(submittedResult.sourceMarkdown || markdown);
        const nextTitle = text(submittedResult.title || title, '未命名需求');
        rememberAuthoringPreviewImages(workspaceKey, submittedResult.previewImages);
        setTitle(nextTitle);
        setMarkdown(sourceMarkdown);
        setPastedImages(pastedImagesForWorkspace(workspaceKey));
        lastAutosavedMarkdownRef.current = sourceMarkdown;
        lastAutosavedTitleRef.current = nextTitle;
        const savedAt = saveAuthoringAutosave(workspaceKey, nextTitle, sourceMarkdown, pastedImagesForMarkdown(workspaceKey, sourceMarkdown));
        setLastSavedAt(savedAt);
      }, [submittedResult, workspaceKey]);
      const actionButtons = submittedResult ? React.createElement('div', { style: styles.authoringActions },
        React.createElement(Button, {
          size: 'sm',
          variant: 'outline',
          onClick: () => downloadMarkdownCopy(submittedResult),
        }, '保存副本'),
      ) : null;

      const previewColumn = React.createElement('section', { style: lockState.locked ? styles.authoringReadonlyColumn : styles.authoringColumn },
        React.createElement('div', { style: styles.authoringHeading },
          React.createElement('span', null, '预览'),
          actionButtons,
          lockState.locked ? React.createElement('span', { style: styles.authoringStatus }, text(lockState.reason, '右侧已只读')) : null,
        ),
        React.createElement('div', { style: styles.authoringPreview },
          previewMarkdown.trim()
            ? renderRichContent(previewMarkdown, 'authoring', workspaceKey, previewImages, 'authoring-preview')
            : React.createElement('p', { style: styles.muted }, '暂无内容'),
        ),
      );

      return React.createElement('aside', { style: styles.panel },
        React.createElement('header', { style: styles.panelHeader },
          React.createElement('div', { style: styles.headerCopy },
            React.createElement('div', { style: styles.eyebrow }, `CTeam PRD · ${text(workspace.projectId, '未选择项目')}`),
            lockState.locked
              ? React.createElement('h1', { style: styles.title }, title)
              : React.createElement('input', {
                value: title,
                onChange: (event) => setTitle(event.target.value),
                style: styles.titleInput,
                'aria-label': 'PRD 标题',
              }),
          ),
          React.createElement(Button, {
            size: 'sm',
            variant: 'toolbar',
            icon: React.createElement(IconCloseOutline16, { size: 16 }),
            'aria-label': '关闭 PRD 写作',
            title: '关闭 PRD 写作',
            onClick: closeDetails,
          }),
        ),
        tabs,
        React.createElement('div', { style: lockState.locked ? styles.authoringReadonlyShell : styles.authoringShell },
          lockState.locked ? null : React.createElement('section', { style: styles.authoringColumn },
            React.createElement('div', { style: styles.authoringHeading },
              React.createElement(IconEditOutline16, { size: 15 }),
              React.createElement('span', null, 'Markdown'),
              React.createElement('span', { style: styles.authoringStatus }, savedText),
            ),
            React.createElement('textarea', {
              ref: textareaRef,
              value: markdown,
              disabled: false,
              onChange: changeMarkdown,
              onPaste: pasteImages,
              spellCheck: false,
              style: styles.authoringTextarea,
            }),
          ),
          previewColumn,
        ),
      );
    }

    function selectCteamForm({ interactions }) {
      return interactions.find((item) => {
        if (item.kind !== 'question') return false;
        const question = Array.isArray(item.payload?.questions) ? item.payload.questions[0] : null;
        if (typeof question?.detail !== 'string') return false;
        try {
          const parsed = JSON.parse(question.detail);
          return isRecord(parsed) && parsed.kind === 'cteam-form';
        } catch {
          return false;
        }
      }) ?? null;
    }

    function selectCteamWikiImportForm({ interactions }) {
      return interactions.find((item) => {
        if (item.kind !== 'question') return false;
        const question = Array.isArray(item.payload?.questions) ? item.payload.questions[0] : null;
        if (typeof question?.detail !== 'string') return false;
        try {
          const parsed = JSON.parse(question.detail);
          return isRecord(parsed) && parsed.kind === 'cteam-wiki-import-form';
        } catch {
          return false;
        }
      }) ?? null;
    }

    function parseCteamFormPayload(wait) {
      const question = Array.isArray(wait.payload?.questions) ? wait.payload.questions[0] : null;
      if (typeof question?.detail !== 'string') return null;
      try {
        const parsed = JSON.parse(question.detail);
        return isRecord(parsed) && parsed.kind === 'cteam-form' ? parsed : null;
      } catch {
        return null;
      }
    }

    function parseCteamWikiImportPayload(wait) {
      const question = Array.isArray(wait.payload?.questions) ? wait.payload.questions[0] : null;
      if (typeof question?.detail !== 'string') return null;
      try {
        const parsed = JSON.parse(question.detail);
        return isRecord(parsed) && parsed.kind === 'cteam-wiki-import-form' ? parsed : null;
      } catch {
        return null;
      }
    }

    function categoryChildren(categories, parentId) {
      return categories.filter((category) => text(category.parentId) === text(parentId));
    }

    function categoryById(categories, id) {
      return categories.find((category) => text(category.id) === text(id));
    }

    function categoryIdPath(categories, categoryId) {
      const byId = new Map(categories.map((category) => [text(category.id), category]));
      const ids = [];
      let current = byId.get(text(categoryId));
      const seen = new Set();
      while (current && !seen.has(text(current.id))) {
        seen.add(text(current.id));
        ids.unshift(text(current.id));
        current = byId.get(text(current.parentId));
      }
      return ids;
    }

    function leafCategories(categories) {
      return categories.filter((category) => Number(category.childCount ?? 0) === 0);
    }

    function searchCategories(categories, query, leavesOnly = true) {
      const needle = text(query).trim().toLocaleLowerCase();
      if (!needle) return [];
      const source = leavesOnly ? leafCategories(categories) : categories;
      return source
        .filter((category) => text((category.path ?? []).join(' / ')).toLocaleLowerCase().includes(needle))
        .slice(0, 40);
    }

    function nextCategoryLevelOptions(categories, selectedIds) {
      if (selectedIds.length === 0) {
        return categories.filter((category) => Number(category.depth ?? 0) === 0);
      }
      return categoryChildren(categories, selectedIds[selectedIds.length - 1]);
    }

    function categorySelectionPath(categories, selectedIds) {
      const last = selectedIds[selectedIds.length - 1];
      const category = categoryById(categories, last);
      return Array.isArray(category?.path) ? category.path.map(String) : [];
    }

    function fieldInitialValue(field) {
      if (field.defaultValue !== undefined) {
        if (field.multiple === true) {
          return Array.isArray(field.defaultValue) ? field.defaultValue.map(text) : [text(field.defaultValue)].filter(Boolean);
        }
        return text(field.defaultValue);
      }
      return field.multiple === true ? [] : '';
    }

    function normalizeFieldValue(field, value) {
      if (value === undefined || value === null) return fieldInitialValue(field);
      if (field.multiple === true) return Array.isArray(value) ? value.map(text).filter(Boolean) : [text(value)].filter(Boolean);
      return Array.isArray(value) ? text(value[0]) : text(value);
    }

    function initialFieldValues(fields, providedValues) {
      const provided = isRecord(providedValues) ? providedValues : {};
      return Object.fromEntries(fields.map((field) => {
        return [field.id, Object.prototype.hasOwnProperty.call(provided, field.id)
          ? normalizeFieldValue(field, provided[field.id])
          : fieldInitialValue(field)];
      }));
    }

    function isDateOnlyField(field) {
      const typeName = text(field?.type).toLocaleUpperCase();
      const label = text(field?.label || field?.name || field?.id);
      return typeName === 'DATE' || /预计开始时间|预计结束时间|日期/u.test(label);
    }

    function isDateTimeField(field) {
      const typeName = text(field?.type).toLocaleUpperCase();
      return typeName === 'DATETIME' || typeName === 'DATE_TIME';
    }

    function toDateOnlyValue(value) {
      const input = text(value).trim();
      if (!input) return '';
      const normalized = input.replace(/\//gu, '-');
      const match = /^(\d{4}-\d{2}-\d{2})/u.exec(normalized);
      if (match) return match[1];
      const parsed = new Date(input);
      if (Number.isNaN(parsed.getTime())) return '';
      const pad = (number) => String(number).padStart(2, '0');
      return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
    }

    function toDateTimeLocalValue(value) {
      const input = text(value).trim();
      if (!input) return '';
      const normalized = input.replace(/\//gu, '-').replace(' ', 'T');
      const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?/u.exec(normalized);
      if (match) return `${match[1]}T${match[2]}`;
      const dateOnly = /^(\d{4}-\d{2}-\d{2})$/u.exec(normalized);
      if (dateOnly) return `${dateOnly[1]}T00:00`;
      const parsed = new Date(input);
      if (Number.isNaN(parsed.getTime())) return '';
      const pad = (number) => String(number).padStart(2, '0');
      return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
    }

    function fromDateTimeLocalValue(value) {
      const input = text(value).trim();
      if (!input) return '';
      const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/u.exec(input);
      return match ? `${match[1]} ${match[2]}:00` : input;
    }

    function optionMatches(option, query) {
      const needle = text(query).trim().toLocaleLowerCase();
      if (!needle) return true;
      return `${text(option.label)} ${text(option.value)} ${text(option.description)}`.toLocaleLowerCase().includes(needle);
    }

    function isOptionField(field) {
      return Array.isArray(field.options) && field.options.length > 0;
    }

    function CteamSearchSelect({ field, value, onChange, disabled }) {
      const [query, setQuery] = React.useState('');
      const [open, setOpen] = React.useState(false);
      const selected = Array.isArray(value) ? value : value ? [value] : [];
      const options = (Array.isArray(field.options) ? field.options : []).filter((option) => optionMatches(option, query)).slice(0, 80);
      const optionLabelByValue = React.useMemo(() => {
        const labels = new Map();
        (Array.isArray(field.options) ? field.options : []).forEach((option) => {
          labels.set(text(option.value), text(option.label || option.value));
        });
        return labels;
      }, [field.options]);
      const selectedItems = selected.map((item) => ({
        value: text(item),
        label: optionLabelByValue.get(text(item)) || text(item),
      })).filter((item) => item.value && item.label);
      const selectedLabels = selectedItems.map((item) => item.label);
      const toggle = (optionValue) => {
        if (field.multiple === true) {
          onChange(selected.includes(optionValue)
            ? selected.filter((item) => item !== optionValue)
            : [...selected, optionValue]);
          return;
        }
        onChange(optionValue);
        setOpen(false);
        setQuery('');
      };
      const clear = (event) => {
        event.stopPropagation();
        onChange(field.multiple === true ? [] : '');
      };
      const removeSelected = (event, optionValue) => {
        event.stopPropagation();
        onChange(selected.filter((item) => item !== optionValue));
      };
      return React.createElement('div', {
        style: styles.formSelect,
        onBlur: () => window.setTimeout(() => setOpen(false), 120),
      },
        React.createElement('button', {
          type: 'button',
          disabled,
          onClick: () => setOpen((current) => !current),
          style: styles.selectTrigger,
        }),
        React.createElement('div', {
          'aria-hidden': 'true',
          onClick: () => !disabled && setOpen((current) => !current),
          style: styles.selectTriggerOverlay,
        },
          selectedLabels.length === 0
            ? React.createElement('span', { style: styles.selectPlaceholder }, text(field.placeholder || `请选择${text(field.label)}`))
            : field.multiple === true
              ? React.createElement('span', { style: styles.selectTags },
                selectedItems.slice(0, 4).map((item) => React.createElement('span', { key: item.value, style: styles.selectTag },
                  React.createElement('span', { style: styles.selectTagLabel }, item.label),
                  !disabled ? React.createElement('button', {
                    type: 'button',
                    onClick: (event) => removeSelected(event, item.value),
                    style: styles.selectTagRemove,
                    'aria-label': `移除${item.label}`,
                    title: `移除${item.label}`,
                  }, '×') : null,
                )),
                selectedItems.length > 4 ? React.createElement('span', { style: styles.selectMore }, `+${selectedItems.length - 4}`) : null,
              )
              : React.createElement('span', { style: styles.selectValue }, selectedLabels[0]),
          selectedLabels.length > 0 && !disabled
            ? React.createElement('button', { type: 'button', onClick: clear, style: styles.selectClear }, '×')
            : null,
          React.createElement('span', { style: styles.selectCaret }, open ? '⌃' : '⌄'),
        ),
        open ? React.createElement('div', { style: styles.selectDropdown },
          React.createElement('input', {
            type: 'search',
            value: query,
            disabled,
            autoFocus: true,
            placeholder: `搜索${text(field.label)}`,
            onChange: (event) => setQuery(event.target.value),
            style: styles.formInput,
          }),
          React.createElement('div', { style: styles.optionList },
            options.length === 0
              ? React.createElement('div', { style: styles.optionEmpty }, '无匹配选项')
              : options.map((option) => {
                const optionValue = text(option.value);
                const checked = selected.includes(optionValue);
                return React.createElement('button', {
                  type: 'button',
                  key: optionValue,
                  disabled,
                  onMouseDown: (event) => event.preventDefault(),
                  onClick: () => toggle(optionValue),
                  style: checked ? styles.optionSelectedButton : styles.optionButton,
                },
                  React.createElement('span', { style: styles.optionMark }, field.multiple === true ? (checked ? '✓' : '') : (checked ? '●' : '')),
                  React.createElement('span', { style: styles.optionCopy },
                    React.createElement('span', { style: styles.optionLabel }, text(option.label || option.value)),
                    option.description ? React.createElement('span', { style: styles.optionDescription }, text(option.description)) : null,
                  ),
                );
              }),
          ),
        ) : null,
      );
    }

    function CteamCategoryPicker({ categories, selectedIds, setSelectedIds, disabled, searchLeavesOnly = true }) {
      const [query, setQuery] = React.useState('');
      const currentId = selectedIds[selectedIds.length - 1] ?? '';
      const currentNode = currentId ? categoryById(categories, currentId) : null;
      const currentChildren = nextCategoryLevelOptions(categories, selectedIds);
      const searchResults = searchCategories(categories, query, searchLeavesOnly);
      const pick = (category) => {
        const pathIds = categoryIdPath(categories, category.id);
        setSelectedIds(pathIds.length > 0 ? pathIds : [...selectedIds, category.id]);
        setQuery('');
      };
      const goBack = () => {
        if (selectedIds.length === 0 || disabled) return;
        setSelectedIds(selectedIds.slice(0, -1));
        setQuery('');
      };
      const selectedPath = categorySelectionPath(categories, selectedIds);
      const currentTitle = currentNode ? text(currentNode.name || currentNode.title) : '根目录';
      return React.createElement('div', { style: styles.categoryPicker },
        React.createElement('div', { style: styles.wikiTreePath },
          React.createElement('span', { style: styles.formHint }, '当前位置'),
          React.createElement('span', { style: styles.wikiTreePathText }, selectedPath.length > 0 ? selectedPath.join(' / ') : '根目录'),
        ),
        React.createElement('input', {
          type: 'search',
          value: query,
          disabled,
          placeholder: `搜索${currentTitle}下的分类`,
          onChange: (event) => setQuery(event.target.value),
          style: styles.formInput,
        }),
        query.trim()
          ? React.createElement('div', { style: styles.optionList },
            searchResults.length === 0
              ? React.createElement('div', { style: styles.optionEmpty }, '无匹配分类')
              : searchResults.map((category) => React.createElement('button', {
                type: 'button',
                key: category.id,
                disabled,
                onClick: () => {
                  setQuery('');
                  pick(category);
                },
                style: styles.optionButton,
              }, text((category.path ?? [category.name]).join(' / ')))),
          )
          : React.createElement('div', { style: styles.wikiTreeList },
            currentChildren.length === 0
              ? React.createElement('div', { style: styles.optionEmpty }, selectedIds.length > 0 ? '当前分类没有下级，可直接提交' : '暂无需求分类')
              : currentChildren.map((category) => {
                const categoryId = text(category.id);
                const hasChildren = Number(category.childCount ?? 0) > 0;
                const selected = currentId === categoryId;
                return React.createElement('button', {
                  type: 'button',
                  key: categoryId,
                  disabled,
                  onClick: () => pick(category),
                  style: selected ? styles.wikiTreeNodeSelected : styles.wikiTreeNode,
                  title: hasChildren ? '选择并查看下一级' : '选择此分类',
                },
                  React.createElement('span', { style: styles.wikiTreeNodeTitle }, text(category.name || category.title)),
                  React.createElement('span', { style: styles.wikiTreeNodeMeta },
                    hasChildren ? `${Number(category.childCount)} ›` : '选择',
                  ),
                );
              }),
          ),
        React.createElement('div', { style: styles.wikiTreeFooter },
          React.createElement(Button, {
            size: 'sm',
            variant: 'outline',
            disabled: disabled || selectedIds.length === 0,
            onClick: goBack,
          }, '返回上一级'),
          selectedPath.length > 0 ? React.createElement('span', { style: styles.formHint }, '确认无误后点击表单底部提交') : null,
          ),
      );
    }

    function CteamWikiTreePicker({ nodes, selectedIds, setSelectedIds, disabled }) {
      const [query, setQuery] = React.useState('');
      const currentId = selectedIds[selectedIds.length - 1] ?? '';
      const currentNode = currentId ? categoryById(nodes, currentId) : null;
      const currentChildren = currentId
        ? categoryChildren(nodes, currentId)
        : nodes.filter((node) => Number(node.depth ?? 0) === 0);
      const visibleNodes = currentChildren.filter((node) => {
        const needle = query.trim().toLocaleLowerCase();
        if (!needle) return true;
        return text((node.path ?? [node.name]).join(' / ')).toLocaleLowerCase().includes(needle)
          || text(node.name || node.title).toLocaleLowerCase().includes(needle);
      });
      const selectedPath = categorySelectionPath(nodes, selectedIds);
      const choose = (node) => {
        const nextPath = categoryIdPath(nodes, node.id);
        setSelectedIds(nextPath.length > 0 ? nextPath : [...selectedIds, node.id]);
        setQuery('');
      };
      const goBack = () => {
        if (selectedIds.length === 0 || disabled) return;
        setSelectedIds(selectedIds.slice(0, -1));
        setQuery('');
      };
      const currentTitle = currentNode
        ? text(currentNode.name || currentNode.title)
        : '根目录';
      return React.createElement('div', { style: styles.wikiTreePicker },
        React.createElement('div', { style: styles.wikiTreePath },
          React.createElement('span', { style: styles.formHint }, '当前位置'),
          React.createElement('span', { style: styles.wikiTreePathText }, selectedPath.length > 0 ? selectedPath.join(' / ') : '根目录'),
        ),
        React.createElement('input', {
          type: 'search',
          value: query,
          disabled,
          placeholder: `搜索${currentTitle}下的分类`,
          onChange: (event) => setQuery(event.target.value),
          style: styles.formInput,
        }),
        React.createElement('div', { style: styles.wikiTreeList },
          visibleNodes.length === 0
            ? React.createElement('div', { style: styles.optionEmpty }, query.trim() ? '当前层级无匹配分类' : '当前分类没有下级')
            : visibleNodes.map((node) => {
              const nodeId = text(node.id);
              const hasChildren = Number(node.childCount ?? 0) > 0;
              const selected = currentId === nodeId;
              return React.createElement('button', {
                type: 'button',
                key: nodeId,
                disabled,
                onClick: () => choose(node),
                style: selected ? styles.wikiTreeNodeSelected : styles.wikiTreeNode,
                title: hasChildren ? '选择并查看下一级' : '选择此分类',
              },
                React.createElement('span', { style: styles.wikiTreeNodeTitle }, text(node.name || node.title)),
                React.createElement('span', { style: styles.wikiTreeNodeMeta },
                  hasChildren ? `${Number(node.childCount)} ›` : '选择',
                ),
              );
            }),
        ),
        React.createElement('div', { style: styles.wikiTreeFooter },
          React.createElement(Button, {
            size: 'sm',
            variant: 'outline',
            disabled: disabled || selectedIds.length === 0,
            onClick: goBack,
          }, '返回上一级'),
        ),
      );
    }

    function CteamSubmissionComposer(props) {
      const payload = parseCteamFormPayload(props.matched);
      const authoring = getAuthoringState(props.sessionId);
      const categories = Array.isArray(payload?.categories) ? payload.categories : [];
      const fields = Array.isArray(payload?.fields) ? payload.fields.map(normalizedField) : [];
      const visibleFields = fields.filter((field) => field.defaultVisible !== false);
      const operation = text(payload?.operation, 'create');
      const lastSubmission = loadLastSubmission(payload?.projectId, operation);
      const [categoryIds, setCategoryIds] = React.useState([]);
      const [values, setValues] = React.useState(() => initialFieldValues(fields));
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const submittedRef = React.useRef(false);
      React.useEffect(() => {
        if (payload === null) return undefined;
        submittedRef.current = false;
        setSubmissionResult(props.sessionId, null);
        setAuthoringLocked(props.sessionId, true, '提交确认中，右侧已只读');
        return () => {
          if (!submittedRef.current) setAuthoringLocked(props.sessionId, false);
        };
      }, [props.sessionId, payload?.projectId, payload?.operation]);
      if (payload === null) return null;
      const categoryId = categoryIds[categoryIds.length - 1] ?? '';
      const category = categoryById(categories, categoryId);
      const categoryPath = categorySelectionPath(categories, categoryIds);
      const title = text(authoring?.title || payload.title, '未命名需求');
      const markdown = text(authoring?.markdown);
      const images = Array.isArray(authoring?.images) ? authoring.images : [];
      const setFieldValue = (fieldId, value) => setValues((current) => ({ ...current, [fieldId]: value }));
      const applyLastSubmission = () => {
        if (!lastSubmission) return;
        const lastCategoryId = text(lastSubmission.categoryId);
        if (lastCategoryId) setCategoryIds(categoryIdPath(categories, lastCategoryId));
        setValues((current) => ({
          ...current,
          ...initialFieldValues(fields, lastSubmission.fields),
        }));
        setError('');
      };
      const validate = () => {
        if (!markdown.trim()) return '当前没有可提交的 PRD Markdown 内容';
        const missingImages = missingPastedImagePlaceholders(markdown, images);
        if (missingImages.length > 0) {
          return `有 ${missingImages.length} 张图片的浏览器缓存已丢失，请在右侧 Markdown 中删除这些图片占位符并重新粘贴图片后再上传。`;
        }
        if (!categoryId) return '请选择需求分类';
        for (const field of visibleFields) {
          if (field.required !== true) continue;
          const value = values[field.id];
          if (Array.isArray(value) ? value.length === 0 : !text(value).trim()) {
            return `请填写${text(field.label || field.id)}`;
          }
        }
        return '';
      };
      const submit = () => {
        const validation = validate();
        if (validation) {
          setError(validation);
          return;
        }
        submittedRef.current = true;
        setAuthoringLocked(props.sessionId, true, '提交中，右侧已只读');
        saveLastSubmission(payload.projectId, operation, {
          categoryId,
          categoryPath,
          fields: values,
        });
        setPendingSubmission(props.sessionId, {
          projectId: payload.projectId,
          operation,
          title,
          workspaceId: text(authoring?.workspaceId),
          workspaceKey: text(authoring?.workspaceKey),
          markdown,
          images,
          categoryId,
          categoryPath,
          fields: values,
        });
        setBusy(true);
        setError('');
        props.matched.respond({
          ok: true,
          value: {
            sessionId: props.sessionId,
            answer: {
              answers: [{
                id: 'cteam_submission',
                selected: [],
                custom: JSON.stringify({
                  projectId: payload.projectId,
                  operation,
                  title,
                  workspaceId: text(authoring?.workspaceId),
                  workspaceKey: text(authoring?.workspaceKey),
                  markdown,
                  images,
                  categoryId,
                  categoryPath,
                  fields: values,
                }),
              }],
            },
          },
        }).then((receipt) => {
          if (!receipt.accepted) throw new Error(`提交表单响应被拒绝：${receipt.reason}`);
        }).catch((cause) => {
          submittedRef.current = false;
          setPendingSubmission(props.sessionId, null);
          setAuthoringLocked(props.sessionId, false);
          setBusy(false);
          setError(cause instanceof Error ? cause.message : String(cause));
        });
      };
      const cancel = () => {
        submittedRef.current = false;
        setPendingSubmission(props.sessionId, null);
        setAuthoringLocked(props.sessionId, false);
        setBusy(true);
        props.matched.respond({
          ok: false,
          error: {
            code: 'cancelled',
            message: 'the user cancelled CTeam submission confirmation',
            details: {},
          },
        }).catch((cause) => {
          setBusy(false);
          setError(cause instanceof Error ? cause.message : String(cause));
        });
      };
      return React.createElement('div', { style: styles.formFrame, 'data-cteam-form-key': props.matched.key },
        React.createElement('section', { style: styles.formCard },
          React.createElement('header', { style: styles.formHeader },
            React.createElement('div', { style: styles.headerCopy },
              React.createElement('div', { style: styles.eyebrow }, `CTeam 提交确认 · ${text(payload.projectId)}`),
              React.createElement('h2', { style: styles.formTitle }, title),
            ),
            React.createElement('button', { type: 'button', onClick: cancel, disabled: busy, style: styles.iconOnlyButton }, '×'),
          ),
          React.createElement('div', { style: styles.formBody },
            lastSubmission ? React.createElement('div', { style: styles.formReuseLine },
              React.createElement(Button, {
                size: 'sm',
                variant: 'outline',
                disabled: busy,
                onClick: applyLastSubmission,
              }, '沿用上一次提交信息'),
            ) : null,
            React.createElement('div', { style: styles.formField },
              React.createElement('span', { style: styles.formLabel }, '需求分类 *'),
              React.createElement(CteamCategoryPicker, {
                categories,
                selectedIds: categoryIds,
                setSelectedIds: setCategoryIds,
                disabled: busy,
              }),
              categoryPath.length > 0 ? React.createElement('span', { style: styles.formHint }, categoryPath.join(' / ')) : null,
            ),
            visibleFields.map((field) => React.createElement('div', { style: styles.formField, key: field.id },
              React.createElement('span', { style: styles.formLabel }, `${text(field.label || field.id)}${field.required ? ' *' : ''}`),
              isOptionField(field)
                ? React.createElement(CteamSearchSelect, {
                  field,
                  value: values[field.id],
                  disabled: busy,
                  onChange: (value) => setFieldValue(field.id, value),
                })
                : isDateOnlyField(field)
                  ? React.createElement('input', {
                    type: 'date',
                    value: toDateOnlyValue(values[field.id]),
                    disabled: busy,
                    placeholder: text(field.placeholder),
                    onChange: (event) => setFieldValue(field.id, event.target.value),
                    style: styles.formInput,
                  })
                : isDateTimeField(field)
                  ? React.createElement('input', {
                    type: 'datetime-local',
                    value: toDateTimeLocalValue(values[field.id]),
                    disabled: busy,
                    placeholder: text(field.placeholder),
                    onChange: (event) => setFieldValue(field.id, fromDateTimeLocalValue(event.target.value)),
                    style: styles.formInput,
                  })
                : field.type === 'textarea'
                  ? React.createElement('textarea', {
                    value: text(values[field.id]),
                    disabled: busy,
                    placeholder: text(field.placeholder),
                    onChange: (event) => setFieldValue(field.id, event.target.value),
                    style: styles.formTextarea,
                  })
                  : React.createElement('input', {
                    type: 'text',
                    value: text(values[field.id]),
                    disabled: busy,
                    placeholder: text(field.placeholder),
                    onChange: (event) => setFieldValue(field.id, event.target.value),
                    style: styles.formInput,
                  }),
              field.optionLoadError
                ? React.createElement('span', { style: styles.formHint }, `选项加载失败，暂按文本填写：${text(field.optionLoadError)}`)
                : field.optionsTruncated
                  ? React.createElement('span', { style: styles.formHint }, `仅显示前 ${field.options.length} 项，可先选择列表内候选`)
                  : null,
            )),
          ),
          React.createElement('footer', { style: styles.formFooter },
            React.createElement('div', { style: styles.formError, role: 'status' }, error),
            React.createElement('div', { style: styles.formActions },
              React.createElement(Button, { variant: 'outline', disabled: busy, onClick: cancel }, '取消'),
              React.createElement(Button, { variant: 'primary', disabled: busy, onClick: submit }, busy ? '提交中…' : '确认提交'),
            ),
          ),
        ),
      );
    }

    function CteamWikiImportComposer(props) {
      const payload = parseCteamWikiImportPayload(props.matched);
      const authoring = getAuthoringState(props.sessionId);
      const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
      const lastTarget = isRecord(payload?.lastImportTarget) ? payload.lastImportTarget : null;
      const [categoryIds, setCategoryIds] = React.useState([]);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const submittedRef = React.useRef(false);
      React.useEffect(() => {
        if (payload === null) return undefined;
        submittedRef.current = false;
        setAuthoringLocked(props.sessionId, true, 'Wiki 导入确认中，右侧已只读');
        return () => {
          if (!submittedRef.current) setAuthoringLocked(props.sessionId, false);
        };
      }, [props.sessionId, payload?.projectId, payload?.libraryId]);
      if (payload === null) return null;
      const parentId = categoryIds[categoryIds.length - 1] ?? '';
      const parentPath = categorySelectionPath(nodes, categoryIds);
      const title = text(authoring?.title || payload.title, 'wiki-import');
      const markdown = text(authoring?.markdown);
      const images = Array.isArray(authoring?.images) ? authoring.images : [];
      const applyLastTarget = () => {
        const lastParentId = text(lastTarget?.parentId);
        if (!lastParentId) return;
        setCategoryIds(categoryIdPath(nodes, lastParentId));
        setError('');
      };
      const validate = () => {
        if (!markdown.trim()) return '当前没有可导入的 Markdown 内容';
        const missingImages = missingPastedImagePlaceholders(markdown, images);
        if (missingImages.length > 0) {
          return `有 ${missingImages.length} 张图片的浏览器缓存已丢失，请在右侧 Markdown 中删除这些图片占位符并重新粘贴图片后再导入。`;
        }
        if (!parentId) return '请选择 Wiki 父级分类';
        return '';
      };
      const submit = () => {
        const validation = validate();
        if (validation) {
          setError(validation);
          return;
        }
        submittedRef.current = true;
        setAuthoringLocked(props.sessionId, true, 'Wiki 导入中，右侧已只读');
        setBusy(true);
        setError('');
        props.matched.respond({
          ok: true,
          value: {
            sessionId: props.sessionId,
            answer: {
              answers: [{
                id: 'cteam_wiki_import',
                selected: [],
                custom: JSON.stringify({
                  projectId: payload.projectId,
                  libraryId: payload.libraryId,
                  title,
                  markdown,
                  images,
                  parentId,
                  parentPath,
                }),
              }],
            },
          },
        }).then((receipt) => {
          if (!receipt.accepted) throw new Error(`Wiki 导入表单响应被拒绝：${receipt.reason}`);
        }).catch((cause) => {
          submittedRef.current = false;
          setAuthoringLocked(props.sessionId, false);
          setBusy(false);
          setError(cause instanceof Error ? cause.message : String(cause));
        });
      };
      const cancel = () => {
        submittedRef.current = false;
        setAuthoringLocked(props.sessionId, false);
        setBusy(true);
        props.matched.respond({
          ok: false,
          error: {
            code: 'cancelled',
            message: 'the user cancelled CTeam wiki import confirmation',
            details: {},
          },
        }).catch((cause) => {
          setBusy(false);
          setError(cause instanceof Error ? cause.message : String(cause));
        });
      };
      const lastLabel = lastTarget
        ? (Array.isArray(lastTarget.path) && lastTarget.path.length > 0
          ? lastTarget.path.join(' / ')
          : text(lastTarget.title || lastTarget.parentId))
        : '';
      return React.createElement('div', { style: styles.formFrame, 'data-cteam-form-key': props.matched.key },
        React.createElement('section', { style: styles.formCard },
          React.createElement('header', { style: styles.formHeader },
            React.createElement('div', { style: styles.headerCopy },
              React.createElement('div', { style: styles.eyebrow }, `CTeam Wiki 导入 · ${text(payload.projectId)}`),
              React.createElement('h2', { style: styles.formTitle }, title),
            ),
            React.createElement('button', { type: 'button', onClick: cancel, disabled: busy, style: styles.iconOnlyButton }, '×'),
          ),
          React.createElement('div', { style: styles.formBody },
            lastTarget ? React.createElement('div', { style: styles.formReuseLine },
              React.createElement(Button, {
                size: 'sm',
                variant: 'outline',
                disabled: busy,
                onClick: applyLastTarget,
              }, '沿用上次 Wiki 导入分类'),
              React.createElement('span', { style: styles.formHint }, lastLabel),
            ) : null,
            React.createElement('div', { style: styles.formField },
              React.createElement('span', { style: styles.formLabel }, 'Wiki 父级分类 *'),
              React.createElement(CteamWikiTreePicker, {
                nodes,
                selectedIds: categoryIds,
                setSelectedIds: setCategoryIds,
                disabled: busy,
              }),
            ),
          ),
          React.createElement('footer', { style: styles.formFooter },
            React.createElement('div', { style: styles.formError, role: 'status' }, error),
            React.createElement('div', { style: styles.formActions },
              React.createElement(Button, { variant: 'outline', disabled: busy, onClick: cancel }, '取消'),
              React.createElement(Button, { variant: 'primary', disabled: busy, onClick: submit }, busy ? '导入中…' : '确认导入'),
            ),
          ),
        ),
      );
    }

    function CteamSubmissionResultRow(props) {
      const { block, inspect, sessionId } = props;
      const [open, setOpen] = React.useState(true);
      const [dismissed, setDismissed] = React.useState(false);
      const rawResult = parseSubmissionResult(block);
      const meta = parseSubmissionPayload(block);
      const settled = isRecord(block) && block.kind === 'tool-result';
      const error = settled && block.isError;
      const failed = error || meta?.succeeded === false || failedSubmissionText(toolResultText(block));
      const result = attachSubmissionPreviewImages(
        sessionId,
        rawResult ?? (settled && !failed ? fallbackSubmissionResult(sessionId, block) : null),
      );
      const issue = isRecord(result?.issue) ? result.issue : {};
      React.useEffect(() => {
        if (!settled || !sessionId) return;
        const hadPendingSubmission = getPendingSubmission(sessionId) !== null;
        if (result) {
          if (hadPendingSubmission) {
            applySubmittedAuthoringState(sessionId, result);
            setSubmissionResult(sessionId, result);
            setPendingSubmission(sessionId, null);
            setAuthoringLocked(sessionId, false);
          }
        } else if (failed) {
          setSubmissionResult(sessionId, null);
          setPendingSubmission(sessionId, null);
          setAuthoringLocked(sessionId, false);
        }
      }, [failed, result, sessionId, settled]);
      const title = error ? 'CTeam 上传失败' : result ? 'CTeam 上传成功' : 'CTeam 上传中';
      const summary = error
        ? text(block.error?.code, '请求失败')
        : result
          ? `${text(issue.number || issue.id, '已创建')} · ${shorten(result.title, 72)}`
          : '创建中…';
      const sourceMarkdown = text(result?.sourceMarkdown || result?.markdown);
      const body = result ? React.createElement('div', { style: styles.submitResultBody },
        React.createElement('div', { style: styles.submitResultCopy },
          React.createElement('div', { style: styles.toolSummary }, '是否保存 Markdown 副本？'),
          React.createElement('div', { style: styles.formHint }, '原版保留工作台草稿内容；CTeam 版来自本次实际上传内容，图片链接已替换为 CTeam 文件地址。'),
          result.issueUrl ? React.createElement('a', {
            href: result.issueUrl,
            target: '_blank',
            rel: 'noreferrer',
            style: styles.originalLink,
          }, '打开 CTeam 需求') : null,
        ),
        dismissed
          ? React.createElement('span', { style: styles.formHint }, '已跳过保存')
          : React.createElement('div', { style: styles.formActions },
            React.createElement(Button, {
              size: 'sm',
              variant: 'primary',
              onClick: () => downloadMarkdownCopy(result, {
                markdown: sourceMarkdown,
                suffix: '原版',
              }),
            }, '保存原版'),
            React.createElement(Button, {
              size: 'sm',
              variant: 'primary',
              onClick: () => downloadMarkdownCopy(result, {
                markdown: result.markdown,
                suffix: 'CTeam版',
              }),
            }, '保存 CTeam 版'),
            React.createElement(Button, {
              size: 'sm',
              variant: 'outline',
              onClick: () => setDismissed(true),
            }, '不保存'),
          ),
      ) : null;

      return React.createElement('div', { style: styles.toolRow },
        React.createElement(DisclosureRow, {
          icon: React.createElement(IconBrowseOutline16, { size: 15 }),
          title,
          open: open && result !== null,
          expandable: result !== null,
          expandOnRowClick: true,
          keepContentWhenOpen: true,
          onToggle: () => setOpen((value) => !value),
          collapsedContent: React.createElement('span', { style: styles.toolCollapsed }, summary),
        }, body),
        inspect ? React.createElement('button', {
          type: 'button',
          onClick: inspect,
          style: styles.inspectButton,
        }, '查看调用') : null,
      );
    }

    function CteamWikiImportResultRow(props) {
      const { block, inspect, sessionId } = props;
      const [open, setOpen] = React.useState(true);
      const [dismissed, setDismissed] = React.useState(false);
      const settled = isRecord(block) && block.kind === 'tool-result';
      const meta = parseWikiImportPayload(block);
      const error = settled && (block.isError || meta?.succeeded === false);
      React.useEffect(() => {
        if (!settled || !sessionId) return;
        setAuthoringLocked(sessionId, false);
      }, [sessionId, settled]);
      const title = error ? 'CTeam Wiki 导入失败' : settled ? 'CTeam Wiki 导入完成' : 'CTeam Wiki 导入中';
      const summary = error
        ? text(meta?.error || block.error?.code, '请求失败')
        : settled
          ? `${text(meta?.filename, 'Markdown')} · 已导入`
          : '导入中…';
      const targetPath = text(meta?.parentPath?.join?.(' / ') || meta?.parentId, '未选择目录');
      const sourceMarkdown = text(meta?.sourceMarkdown || meta?.markdown);
      const cteamMarkdown = text(meta?.markdown);
      const canSave = Boolean(sourceMarkdown || cteamMarkdown);
      return React.createElement('div', { style: styles.toolRow },
        React.createElement(DisclosureRow, {
          icon: React.createElement(IconBrowseOutline16, { size: 15 }),
          title,
          open,
          expandable: settled,
          expandOnRowClick: true,
          keepContentWhenOpen: true,
          onToggle: () => setOpen((value) => !value),
          collapsedContent: React.createElement('span', { style: styles.toolCollapsed }, summary),
        }, settled ? React.createElement('div', { style: canSave ? styles.submitResultBody : styles.toolBody },
          React.createElement('div', { style: styles.submitResultCopy },
            React.createElement('div', { style: styles.toolSummary }, canSave ? '是否保存 Markdown 副本？' : summary),
            canSave ? React.createElement('div', { style: styles.formHint },
              error ? `${summary}。` : `文件：${text(meta?.filename, 'Markdown')}`,
            ) : null,
            canSave ? React.createElement('div', { style: styles.formHint },
              `目录：${targetPath}`,
            ) : null,
            React.createElement('div', { style: styles.formHint }, canSave
              ? `原版保留草稿；CTeam 版使用本次导入内容。图片 ${Number(meta?.uploadedImages?.length ?? 0)} 张，大小 ${Number(meta?.bytes ?? 0)} bytes`
              : text(meta?.error)),
          ),
          canSave
            ? dismissed
              ? React.createElement('span', { style: styles.formHint }, '已跳过保存')
              : React.createElement('div', { style: styles.formActions },
                React.createElement(Button, {
                  size: 'sm',
                  variant: 'primary',
                  onClick: () => downloadMarkdownCopy({
                    title: text(meta.title || meta.filename, 'wiki-import'),
                  }, {
                    markdown: sourceMarkdown,
                    suffix: '原版',
                  }),
                }, '保存原版'),
                React.createElement(Button, {
                  size: 'sm',
                  variant: 'primary',
                  disabled: !cteamMarkdown,
                  onClick: () => downloadMarkdownCopy({
                    title: text(meta.title || meta.filename, 'wiki-import'),
                  }, {
                    markdown: cteamMarkdown,
                    suffix: 'CTeam版',
                  }),
                }, '保存 CTeam 版'),
                React.createElement(Button, {
                  size: 'sm',
                  variant: 'outline',
                  onClick: () => setDismissed(true),
                }, '不保存'),
              )
            : null,
        ) : null),
        inspect ? React.createElement('button', {
          type: 'button',
          onClick: inspect,
          style: styles.inspectButton,
        }, '查看调用') : null,
      );
    }

    function CteamToolRow(props) {
      const { block, sessionId, inspect } = props;
      const [open, setOpen] = React.useState(false);
      const payload = parseCteamPayload(block);
      const detail = payload?.kind === 'detail' ? payload.detail : null;
      const workspace = payload?.kind === 'authoring' ? payload.workspace : null;
      const wiki = payload?.kind === 'wiki' ? payload.value?.wiki : null;
      const issue = getIssue(detail);
      const settled = isRecord(block) && block.kind === 'tool-result';
      const settledRef = React.useRef(settled);
      const error = settled && block.isError;
      const title = error
        ? 'CTeam 操作失败'
        : workspace ? '打开 PRD 写作模式' : wiki ? '读取 CTeam Wiki' : '读取 CTeam 单据';
      const summary = error
        ? text(block.error?.code, '请求失败')
        : workspace
          ? `${text(workspace.projectId, '未选择项目')} · ${shorten(workspace.title, 72)}`
          : wiki
          ? `${text(payload.value?.projectId, '未选择项目')} · ${shorten(wiki.title, 72)}`
          : detail
          ? `${text(issue.number || issue.id, '未编号')} · ${shorten(issue.title, 72)}`
          : settled ? '已完成' : '读取中…';
      const expandable = payload !== null;
      React.useEffect(() => {
        const wasSettled = settledRef.current;
        settledRef.current = settled;
        if (!settled || wasSettled || payload === null || !sessionId) return;
        select(sessionId, payload);
        props.openCteamDetails();
      }, [payload, props.openCteamDetails, sessionId, settled]);
      const openDetails = (event) => {
        event.stopPropagation();
        if (payload === null) return;
        select(sessionId, payload);
        props.openCteamDetails();
      };
      const body = payload === null ? null : React.createElement('div', { style: styles.toolBody },
        React.createElement('div', { style: styles.toolSummary }, workspace ? text(workspace.title, '未命名 PRD') : wiki ? text(wiki.title, '未命名 Wiki') : text(issue.title, '未命名单据')),
        React.createElement(Button, {
          size: 'sm',
          variant: 'outline',
          icon: React.createElement(IconBrowseOutline16, { size: 14 }),
          onClick: openDetails,
        }, '在右侧查看'),
      );

      return React.createElement('div', { style: styles.toolRow },
        React.createElement(DisclosureRow, {
          icon: React.createElement(IconBrowseOutline16, { size: 15 }),
          title,
          open: open && expandable,
          expandable,
          expandOnRowClick: true,
          keepContentWhenOpen: true,
          onToggle: () => setOpen((value) => !value),
          collapsedContent: React.createElement('span', { style: styles.toolCollapsed }, summary),
        }, body),
        inspect ? React.createElement('button', {
          type: 'button',
          onClick: inspect,
          style: styles.inspectButton,
        }, '查看调用') : null,
      );
    }

    function CteamWorkbenchTabs({ sessionId, workbench }) {
      if (!workbench || workbench.items.length <= 1) return null;
      return React.createElement('div', { style: styles.workbenchTabs },
        workbench.items.map((item) => React.createElement('button', {
          key: item.id,
          type: 'button',
          onClick: () => selectWorkbenchItem(sessionId, item.id),
          style: item.id === workbench.activeId ? styles.workbenchTabActive : styles.workbenchTab,
          title: `${item.eyebrow} · ${item.label}`,
        },
          React.createElement('span', { style: styles.workbenchTabEyebrow }, item.eyebrow),
          React.createElement('span', { style: styles.workbenchTabLabel }, item.label),
        )),
      );
    }

    function CteamWikiDetailPanel({ value, closeDetails, tabs }) {
      const wiki = value?.wiki ?? {};
      return React.createElement('aside', { style: styles.panel },
        React.createElement('header', { style: styles.panelHeader },
          React.createElement('div', { style: styles.headerCopy },
            React.createElement('div', { style: styles.eyebrow }, `CTeam Wiki · ${text(value?.projectId, '未选择项目')}`),
            React.createElement('h1', { style: styles.title }, text(wiki.title, '未命名 Wiki')),
          ),
          React.createElement(Button, {
            size: 'sm',
            variant: 'toolbar',
            icon: React.createElement(IconCloseOutline16, { size: 16 }),
            'aria-label': '关闭 Wiki',
            title: '关闭 Wiki',
            onClick: closeDetails,
          }),
        ),
        tabs,
        React.createElement('div', { style: styles.panelScroll },
          React.createElement('div', { style: styles.metaGrid },
            metaItem('版本', wiki.version),
            metaItem('访问量', wiki.pageview),
            metaItem('创建人', wiki.createUser),
            metaItem('创建时间', formatDate(wiki.createTime)),
            metaItem('更新人', wiki.updatedUser),
            metaItem('更新时间', formatDate(wiki.updatedTime)),
          ),
          React.createElement(Section, { title: '内容' },
            text(wiki.content).trim()
              ? renderRichContent(wiki.content, 'wiki', wiki.id, [], 'wiki-detail')
              : React.createElement('p', { style: styles.muted }, '暂无内容'),
          ),
          value?.wikiUrl ? React.createElement('a', {
            href: value.wikiUrl,
            target: '_blank',
            rel: 'noreferrer',
            style: styles.originalLink,
          },
            React.createElement(IconLinkOutline16, { size: 15 }),
            '打开 CTeam Wiki',
          ) : null,
        ),
      );
    }

    function CteamDetailsPanel({ sessionId, closeDetails }) {
      const workbench = React.useSyncExternalStore(
        (callback) => subscribe(sessionId, callback),
        () => getWorkbench(sessionId),
        () => getWorkbench(sessionId),
      );
      const selection = getSelected(sessionId);
      const tabs = React.createElement(CteamWorkbenchTabs, { sessionId, workbench });
      if (selection?.kind === 'authoring') {
        return React.createElement(CteamPrdAuthoringPanel, {
          workspace: selection.workspace,
          closeDetails,
          sessionId,
          tabs,
        });
      }
      if (selection?.kind === 'wiki') {
        return React.createElement(CteamWikiDetailPanel, {
          value: selection.value,
          closeDetails,
          tabs,
        });
      }
      if (selection === null) {
        return React.createElement('div', { style: styles.emptyPanel }, '选择一条 CTeam 单据后在此查看');
      }
      const detail = selection?.kind === 'detail' ? selection.detail : selection;
      const issue = getIssue(detail);
      const comments = Array.isArray(detail?.comments) ? detail.comments : [];
      const images = Array.isArray(detail?.images) ? detail.images : [];
      const files = Array.isArray(issue.files) ? issue.files : [];
      if (detail === null) {
        return React.createElement('div', { style: styles.emptyPanel }, '选择一条 CTeam 单据后在此查看');
      }

      return React.createElement('aside', { style: styles.panel },
        React.createElement('header', { style: styles.panelHeader },
          React.createElement('div', { style: styles.headerCopy },
            React.createElement('div', { style: styles.eyebrow }, text(issue.number || issue.id, 'CTeam 单据')),
            React.createElement('h1', { style: styles.title }, text(issue.title, '未命名单据')),
          ),
          React.createElement(Button, {
            size: 'sm',
            variant: 'toolbar',
            icon: React.createElement(IconCloseOutline16, { size: 16 }),
            'aria-label': '关闭详情',
            title: '关闭详情',
            onClick: closeDetails,
          }),
        ),
        tabs,
        React.createElement('div', { style: styles.panelScroll },
          React.createElement('div', { style: styles.metaGrid },
            metaItem('状态', issue.stateName || issue.stateId),
            metaItem('优先级', issue.priorityName || issue.priority),
            metaItem('分类', issue.demandClassifyName || issue.demandClassifyId || issue.typeClassify),
            metaItem('创建人', issue.createUserName || issue.createUser),
            metaItem('创建时间', formatDate(issue.createTime)),
            metaItem('更新时间', formatDate(issue.updateTime)),
          ),
          React.createElement(Section, { title: '描述' },
            issue.desc
              ? renderRichContent(issue.desc, 'description', issue.id, images, 'description')
              : React.createElement('p', { style: styles.muted }, '暂无描述'),
          ),
          files.length > 0 ? React.createElement(Section, { title: '附件', count: files.length },
            React.createElement('div', { style: styles.fileList }, files.map((file, index) => {
              const url = cteamUrl(file.url);
              const name = text(file.name || file.id, `附件 ${index + 1}`);
              return url
                ? React.createElement('a', { href: url, target: '_blank', rel: 'noreferrer', style: styles.fileLink, key: file.id || url }, name)
                : React.createElement('span', { style: styles.muted, key: file.id || index }, name);
            })),
          ) : null,
          React.createElement(Section, { title: '评论', count: comments.length },
            comments.length === 0
              ? React.createElement('p', { style: styles.muted }, '暂无评论')
              : React.createElement('div', { style: styles.commentList }, comments.map((comment, index) => React.createElement('article', { style: styles.comment, key: comment.id || index },
                React.createElement('div', { style: styles.commentMeta },
                  React.createElement('span', null, text(comment.createUser, '未知用户')),
                  React.createElement('time', null, formatDate(comment.createTime)),
                ),
                comment.commentHtml
                  ? renderRichContent(comment.commentHtml, 'comment', comment.id, images, `comment-${comment.id || index}`)
                  : React.createElement('p', { style: styles.commentBody }, '空评论'),
              )),
            ),
          ),
          React.createElement('a', { href: issueUrl(detail), target: '_blank', rel: 'noreferrer', style: styles.originalLink },
            React.createElement(IconLinkOutline16, { size: 15 }),
            '打开 CTeam 原单据',
          ),
        ),
      );
    }

    const styles = {
      panel: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)',
      },
      panelHeader: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        padding: '18px 20px 16px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      headerCopy: { minWidth: 0 },
      eyebrow: {
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 12,
        lineHeight: '18px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      title: {
        margin: '3px 0 0',
        fontSize: 16,
        lineHeight: '24px',
        fontWeight: 600,
        overflowWrap: 'anywhere',
      },
      titleInput: {
        display: 'block',
        width: '100%',
        boxSizing: 'border-box',
        margin: '3px 0 0',
        padding: 0,
        border: 0,
        outline: 'none',
        color: 'var(--dsw-alias-label-primary)',
        background: 'transparent',
        fontSize: 16,
        lineHeight: '24px',
        fontWeight: 600,
      },
      panelScroll: { overflowY: 'auto', padding: '0 20px 24px' },
      workbenchTabs: {
        display: 'flex',
        gap: 6,
        padding: '8px 12px',
        overflowX: 'auto',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
      },
      workbenchTab: {
        appearance: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 120,
        maxWidth: 220,
        height: 32,
        padding: '0 10px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 6,
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-base)',
        cursor: 'pointer',
      },
      workbenchTabActive: {
        appearance: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 120,
        maxWidth: 220,
        height: 32,
        padding: '0 10px',
        border: '1px solid var(--dsw-alias-primary)',
        borderRadius: 6,
        color: 'var(--dsw-alias-primary)',
        background: 'var(--dsw-alias-fill-l4)',
        cursor: 'pointer',
      },
      workbenchTabEyebrow: {
        flex: '0 0 auto',
        fontSize: 11,
        lineHeight: '16px',
        color: 'inherit',
      },
      workbenchTabLabel: {
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: 12,
        lineHeight: '18px',
        color: 'inherit',
      },
      authoringShell: {
        flex: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: 0,
      },
      authoringReadonlyShell: {
        flex: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
      },
      authoringColumn: {
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--dsw-alias-border-l1)',
      },
      authoringReadonlyColumn: {
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      },
      authoringHeading: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        minHeight: 36,
        padding: '6px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 12,
        lineHeight: '18px',
      },
      authoringActions: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        marginLeft: 8,
      },
      authoringStatus: {
        marginLeft: 'auto',
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 12,
        lineHeight: '18px',
      },
      authoringTextarea: {
        flex: 1,
        minHeight: 0,
        width: '100%',
        boxSizing: 'border-box',
        resize: 'none',
        padding: 12,
        border: 0,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)',
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: 12,
        lineHeight: '20px',
        outline: 'none',
      },
      authoringTextareaLocked: {
        flex: 1,
        minHeight: 0,
        width: '100%',
        boxSizing: 'border-box',
        resize: 'none',
        padding: 12,
        border: 0,
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-l2)',
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: 12,
        lineHeight: '20px',
        outline: 'none',
        cursor: 'not-allowed',
      },
      authoringPreview: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: 12,
      },
      formFrame: {
        padding: '6px calc(var(--dsh-composer-side-clearance) + 16px) 10px',
        display: 'flex',
        justifyContent: 'center',
      },
      formCard: {
        width: '100%',
        maxWidth: 'var(--dsh-chat-content-width)',
        maxHeight: 'min(72vh, 680px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid var(--dsw-alias-border-l2-darkmode-thin)',
        borderRadius: 18,
        background: 'var(--dsw-specific-input-major)',
        color: 'var(--dsw-alias-label-primary)',
        boxShadow: 'var(--dsw-shadow-lv2)',
      },
      formHeader: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        padding: '16px 18px 10px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      formTitle: {
        margin: '2px 0 0',
        fontSize: 16,
        lineHeight: '22px',
        fontWeight: 600,
        overflowWrap: 'anywhere',
      },
      iconOnlyButton: {
        width: 28,
        height: 28,
        border: 0,
        borderRadius: 14,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'transparent',
        fontSize: 20,
        lineHeight: '26px',
      },
      formBody: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '12px 18px 4px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      },
      formSummary: {
        padding: 10,
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-l2)',
      },
      formMetaLine: {
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 12,
        lineHeight: '18px',
      },
      formReuseLine: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
      },
      formField: {
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        minWidth: 0,
      },
      formLabel: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 13,
        lineHeight: '20px',
        fontWeight: 600,
      },
      formHint: {
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 12,
        lineHeight: '18px',
        overflowWrap: 'anywhere',
      },
      formInput: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 34,
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 8,
        padding: '6px 10px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)',
        colorScheme: 'dark',
        outline: 'none',
        fontSize: 13,
        lineHeight: '20px',
      },
      formTextarea: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 78,
        resize: 'vertical',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 8,
        padding: '8px 10px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)',
        outline: 'none',
        fontSize: 13,
        lineHeight: '20px',
      },
      categoryPicker: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      },
      categoryLevels: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 8,
      },
      wikiTreePicker: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      },
      wikiTreePath: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '7px 9px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-l2)',
      },
      wikiTreePathText: {
        minWidth: 0,
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 12,
        lineHeight: '18px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      wikiTreeList: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        maxHeight: 260,
        overflowY: 'auto',
        padding: 4,
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-base)',
      },
      wikiTreeNode: {
        width: '100%',
        minHeight: 34,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '7px 9px',
        border: 0,
        borderRadius: 6,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        background: 'transparent',
        textAlign: 'left',
      },
      wikiTreeNodeSelected: {
        width: '100%',
        minHeight: 34,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '7px 9px',
        border: 0,
        borderRadius: 6,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-l2)',
        textAlign: 'left',
      },
      wikiTreeNodeTitle: {
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: 13,
        lineHeight: '20px',
      },
      wikiTreeNodeMeta: {
        flex: '0 0 auto',
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 12,
        lineHeight: '18px',
      },
      wikiTreeFooter: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      },
      formSelect: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      },
      selectTrigger: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 34,
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 8,
        padding: 0,
        cursor: 'pointer',
        background: 'var(--dsw-alias-bg-base)',
      },
      selectTriggerOverlay: {
        position: 'absolute',
        inset: '1px 1px auto 1px',
        minHeight: 32,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 30px 4px 10px',
        boxSizing: 'border-box',
        cursor: 'pointer',
        pointerEvents: 'auto',
      },
      selectPlaceholder: {
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 13,
        lineHeight: '20px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      selectValue: {
        minWidth: 0,
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        lineHeight: '20px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      selectTags: {
        minWidth: 0,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
      },
      selectTag: {
        maxWidth: 170,
        padding: '1px 6px',
        borderRadius: 4,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-l2)',
        fontSize: 12,
        lineHeight: '18px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
      },
      selectTagLabel: {
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      selectTagRemove: {
        flex: '0 0 auto',
        width: 14,
        height: 14,
        border: 0,
        borderRadius: 3,
        padding: 0,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-tertiary)',
        background: 'transparent',
        fontSize: 12,
        lineHeight: '14px',
      },
      selectMore: {
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 12,
        lineHeight: '20px',
      },
      selectClear: {
        marginLeft: 'auto',
        border: 0,
        background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary)',
        cursor: 'pointer',
        fontSize: 16,
        lineHeight: '18px',
        padding: '0 2px',
      },
      selectCaret: {
        position: 'absolute',
        right: 9,
        top: 6,
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 13,
        lineHeight: '20px',
        pointerEvents: 'none',
      },
      selectDropdown: {
        position: 'absolute',
        top: 38,
        left: 0,
        right: 0,
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-base)',
        boxShadow: '0 8px 22px rgba(8, 30, 64, 0.14)',
      },
      optionList: {
        maxHeight: 190,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 4,
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-base)',
      },
      optionButton: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        width: '100%',
        minHeight: 32,
        border: '1px solid transparent',
        borderRadius: 7,
        padding: '6px 8px',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        background: 'transparent',
        textAlign: 'left',
      },
      optionSelectedButton: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        width: '100%',
        minHeight: 32,
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 7,
        padding: '6px 8px',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-interactive-bg-hover)',
        textAlign: 'left',
      },
      optionMark: {
        flex: '0 0 18px',
        width: 18,
        color: 'var(--dsw-alias-state-business-primary)',
        fontSize: 12,
        lineHeight: '20px',
        textAlign: 'center',
      },
      optionCopy: {
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
      },
      optionLabel: {
        fontSize: 13,
        lineHeight: '20px',
        overflowWrap: 'anywhere',
      },
      optionDescription: {
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 12,
        lineHeight: '18px',
        overflowWrap: 'anywhere',
      },
      optionEmpty: {
        padding: '8px 10px',
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 12,
        lineHeight: '18px',
      },
      formFooter: {
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 14px 12px 18px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      formError: {
        minHeight: 18,
        color: 'var(--dsw-alias-state-error-primary)',
        fontSize: 12,
        lineHeight: '18px',
      },
      formActions: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
      },
      metaGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '14px 16px',
        padding: '18px 0 4px',
      },
      metaItem: { minWidth: 0 },
      metaLabel: {
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 11,
        lineHeight: '16px',
      },
      metaValue: {
        marginTop: 2,
        fontSize: 13,
        lineHeight: '20px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      section: { paddingTop: 22 },
      sectionHeading: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 },
      sectionTitle: { margin: 0, fontSize: 13, lineHeight: '20px', fontWeight: 600 },
      sectionCount: {
        minWidth: 18,
        padding: '0 5px',
        borderRadius: 9,
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-l2)',
        fontSize: 11,
        lineHeight: '18px',
        textAlign: 'center',
      },
      muted: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: '20px' },
      fileList: { display: 'flex', flexDirection: 'column', gap: 6 },
      fileLink: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 13,
        lineHeight: '20px',
        overflowWrap: 'anywhere',
        textDecoration: 'none',
      },
      richContent: { display: 'flex', flexDirection: 'column', gap: 10 },
      richImageFigure: { margin: 0 },
      missingImage: {
        padding: 12,
        border: '1px dashed var(--dsw-alias-border-l2)',
        borderRadius: 8,
        color: 'var(--dsw-alias-label-tertiary)',
        background: 'var(--dsw-alias-bg-l2)',
        fontSize: 12,
        lineHeight: '18px',
      },
      image: {
        display: 'block',
        width: '100%',
        maxHeight: 260,
        objectFit: 'contain',
        background: 'var(--dsw-alias-bg-l2)',
        border: '1px solid var(--dsw-alias-border-l1)',
      },
      commentList: { display: 'flex', flexDirection: 'column', gap: 12 },
      comment: { paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-l1)' },
      commentMeta: { display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, lineHeight: '16px' },
      commentBody: { margin: '5px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13, lineHeight: '20px' },
      originalLink: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginTop: 24,
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 13,
        lineHeight: '20px',
        textDecoration: 'none',
      },
      emptyPanel: { padding: 24, color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 },
      toolRow: { padding: '1px 0' },
      toolCollapsed: { color: 'var(--dsw-alias-label-secondary)' },
      toolBody: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '3px 0 4px 24px' },
      submitResultBody: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, padding: '6px 0 6px 24px' },
      submitResultCopy: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
      toolSummary: { minWidth: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      inspectButton: { margin: '0 0 2px 24px', padding: 0, border: 0, color: 'var(--dsw-alias-label-tertiary)', background: 'transparent', fontSize: 11, cursor: 'pointer' },
    };

    function apply(ctx) {
      const layout = ctx.layout;
      const closeCteamDetails = () => layout.closeDetails();
      ctx.slots.inject('tool.call.toolview', () => {
        const openCteamDetails = () => layout.openDetails();
        return [
          ctx.slots.register(
            { name: 'tool.call.toolview', key: 'cteam_get_demand_detail' },
            (props) => React.createElement(CteamToolRow, { ...props, openCteamDetails }),
          ),
          ctx.slots.register(
            { name: 'tool.call.toolview', key: 'cteam_get_issue_detail' },
            (props) => React.createElement(CteamToolRow, { ...props, openCteamDetails }),
          ),
          ctx.slots.register(
            { name: 'tool.call.toolview', key: 'cteam_get_wiki_detail' },
            (props) => React.createElement(CteamToolRow, { ...props, openCteamDetails }),
          ),
          ctx.slots.register(
            { name: 'tool.call.toolview', key: 'cteam_open_prd_authoring' },
            (props) => React.createElement(CteamToolRow, { ...props, openCteamDetails }),
          ),
          ctx.slots.register(
            { name: 'tool.call.toolview', key: 'cteam_submit_prd_demand' },
            (props) => React.createElement(CteamSubmissionResultRow, props),
          ),
          ctx.slots.register(
            { name: 'tool.call.toolview', key: 'cteam_create_demand_from_submission' },
            (props) => React.createElement(CteamSubmissionResultRow, props),
          ),
          ctx.slots.register(
            { name: 'tool.call.toolview', key: 'cteam_submit_wiki_markdown' },
            (props) => React.createElement(CteamWikiImportResultRow, props),
          ),
          ctx.slots.register(
            { name: 'tool.call.toolview', key: 'cteam_upload_wiki_markdown' },
            (props) => React.createElement(CteamWikiImportResultRow, props),
          ),
          ctx.slots.register(
            { name: 'tool.call.toolview', key: 'cteam_import_wiki_markdown' },
            (props) => React.createElement(CteamWikiImportResultRow, props),
          ),
        ];
      });
      ctx.slots.inject('details', () => ctx.slots.register(
        { name: 'details', id: 'dsh-cteam-details', priority: -100 },
        (props) => React.createElement(CteamDetailsPanel, { ...props, closeDetails: closeCteamDetails }),
      ));
      ctx.slots.inject('conversation.composer', () => ctx.slots.register(
        {
          name: 'conversation.composer',
          select: selectCteamForm,
          priority: -10,
        },
        CteamSubmissionComposer,
      ));
      ctx.slots.inject('conversation.composer', () => ctx.slots.register(
        {
          name: 'conversation.composer',
          select: selectCteamWikiImportForm,
          priority: -9,
        },
        CteamWikiImportComposer,
      ));
    }

    exports.inject = ['slots', 'layout'];
    exports.apply = apply;
    return module.exports;
  },
});
