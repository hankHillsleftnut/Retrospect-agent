import type { IntegrationSourceItemInput } from '../types';
import type { ConnectorContext, IntegrationConnector } from './connector';
import { oauthJson } from './oauth-http';

interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  trashed?: boolean;
  createdTime?: string;
  modifiedTime?: string;
}
interface DriveList { files?: DriveFile[]; nextPageToken?: string }
interface DriveStartToken { startPageToken: string }
interface DriveChanges {
  changes?: { fileId: string; removed?: boolean; file?: DriveFile }[];
  nextPageToken?: string;
  newStartPageToken?: string;
}
interface DocNode { paragraph?: { elements?: { textRun?: { content?: string } }[] }; table?: { tableRows?: { tableCells?: { content?: DocNode[] }[] }[] }; }
interface GoogleDoc { title?: string; body?: { content?: DocNode[] } }

const docsMimeType = 'application/vnd.google-apps.document';

function documentText(nodes: DocNode[] = []): string {
  return nodes.flatMap((node) => {
    const paragraph = node.paragraph?.elements?.map((element) => element.textRun?.content ?? '').join('') ?? '';
    const table = node.table?.tableRows?.flatMap((row) => row.tableCells?.flatMap((cell) => documentText(cell.content)) ?? []).join('\n') ?? '';
    return [paragraph, table].filter(Boolean);
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function documentItem(context: ConnectorContext, file: DriveFile): Promise<IntegrationSourceItemInput | null> {
  const doc = await oauthJson<GoogleDoc>(context, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(file.id)}`);
  const content = documentText(doc.body?.content);
  if (!content) return null;
  const payload = {
    document_id: file.id,
    title: doc.title ?? file.name,
    content,
    created_time: file.createdTime,
    modified_time: file.modifiedTime,
  };
  return {
    providerObjectType: 'document',
    providerObjectId: file.id,
    payload,
    canonicalType: 'document_section',
    canonicalText: `# ${doc.title ?? file.name}\n\n${content}`,
    normalizedData: payload,
    occurredAt: file.modifiedTime,
    providerCreatedAt: file.createdTime,
    providerUpdatedAt: file.modifiedTime,
    parserVersion: 'google-docs-api-v2',
    normalizerVersion: 'document-v2',
    contentType: 'google_docs',
    metadata: { source: 'google_docs_api', title: doc.title ?? file.name },
  };
}

async function materializeDocuments(context: ConnectorContext, files: DriveFile[]): Promise<IntegrationSourceItemInput[]> {
  const items: IntegrationSourceItemInput[] = [];
  for (const file of files) {
    if (file.trashed || file.mimeType && file.mimeType !== docsMimeType) continue;
    const item = await documentItem(context, file);
    if (item) items.push(item);
  }
  return items;
}

export const googleDocsConnector: IntegrationConnector = {
  providerId: 'google_docs',
  async sync(context) {
    const changesPageToken = typeof context.cursor.changesPageToken === 'string' ? context.cursor.changesPageToken : '';
    if (changesPageToken) {
      const url = new URL('https://www.googleapis.com/drive/v3/changes');
      url.searchParams.set('pageToken', changesPageToken);
      url.searchParams.set('pageSize', '100');
      url.searchParams.set('includeRemoved', 'true');
      url.searchParams.set('fields', 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,trashed,createdTime,modifiedTime))');
      const result = await oauthJson<DriveChanges>(context, url.toString());
      const changedFiles = (result.changes ?? [])
        .filter((change) => !change.removed && !change.file?.trashed && change.file?.mimeType === docsMimeType)
        .map((change) => change.file!)
        .filter(Boolean);
      const deletedProviderObjectIds = (result.changes ?? [])
        .filter((change) => change.removed || change.file?.trashed)
        .map((change) => change.fileId);
      return {
        cursorAfter: {
          changesPageToken: result.nextPageToken ?? result.newStartPageToken ?? changesPageToken,
          completedAt: new Date().toISOString(),
        },
        items: await materializeDocuments(context, changedFiles),
        deletedProviderObjectIds,
      };
    }

    const scanStartToken = typeof context.cursor.scanStartToken === 'string' && context.cursor.scanStartToken
      ? context.cursor.scanStartToken
      : (await oauthJson<DriveStartToken>(context, 'https://www.googleapis.com/drive/v3/changes/startPageToken')).startPageToken;
    const filesPageToken = typeof context.cursor.filesPageToken === 'string' ? context.cursor.filesPageToken : '';
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', `mimeType='${docsMimeType}' and trashed=false`);
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,trashed,createdTime,modifiedTime)');
    url.searchParams.set('orderBy', 'modifiedTime desc');
    url.searchParams.set('pageSize', '100');
    if (filesPageToken) url.searchParams.set('pageToken', filesPageToken);
    const list = await oauthJson<DriveList>(context, url.toString());
    return {
      cursorAfter: list.nextPageToken
        ? { filesPageToken: list.nextPageToken, scanStartToken }
        : { filesPageToken: '', scanStartToken: '', changesPageToken: scanStartToken, completedAt: new Date().toISOString() },
      items: await materializeDocuments(context, list.files ?? []),
    };
  },
};
