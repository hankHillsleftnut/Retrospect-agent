import type { IntegrationSourceItemInput } from '../types';
import type { IntegrationConnector } from './connector';
import { oauthJson } from './oauth-http';

interface PinterestBoard {
  id: string;
  name?: string;
  description?: string;
  privacy?: string;
  pin_count?: number;
  follower_count?: number;
  created_at?: string;
  board_pins_modified_at?: string;
}
interface PinterestPage { items?: PinterestBoard[]; bookmark?: string | null }

export const pinterestConnector: IntegrationConnector = {
  providerId: 'pinterest',
  async sync(context) {
    const url = new URL('https://api.pinterest.com/v5/boards');
    url.searchParams.set('page_size', '100');
    if (typeof context.cursor.bookmark === 'string' && context.cursor.bookmark) {
      url.searchParams.set('bookmark', context.cursor.bookmark);
    }
    const page = await oauthJson<PinterestPage>(context, url.toString());
    const items: IntegrationSourceItemInput[] = (page.items ?? []).map((board) => {
      const payload = {
        board_id: board.id,
        name: board.name ?? '',
        description: board.description ?? '',
        privacy: board.privacy ?? '',
        pin_count: board.pin_count ?? 0,
        follower_count: board.follower_count ?? 0,
      };
      return {
        providerObjectType: 'board',
        providerObjectId: board.id,
        payload,
        canonicalType: 'saved_interest',
        canonicalText: `Pinterest board: ${payload.name}\n${payload.description}\nPins: ${payload.pin_count}`.trim(),
        normalizedData: payload,
        occurredAt: board.board_pins_modified_at ?? board.created_at,
        providerCreatedAt: board.created_at,
        providerUpdatedAt: board.board_pins_modified_at,
        parserVersion: 'pinterest-api-v1',
        normalizerVersion: 'pinterest-board-v1',
        contentType: 'pinterest',
        metadata: { source: 'pinterest', relationship: 'board' },
      };
    });
    return {
      cursorAfter: { bookmark: page.bookmark ?? '', completedAt: new Date().toISOString() },
      items,
    };
  },
};
