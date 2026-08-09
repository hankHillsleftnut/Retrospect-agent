import type { IntegrationSourceItemInput } from '../types';
import type { ConnectorContext, IntegrationConnector } from './connector';
import { oauthJson } from './oauth-http';

interface SpotifyArtist { id: string; name: string; genres?: string[]; popularity?: number; external_urls?: { spotify?: string } }
interface SpotifyTrack { id: string; name: string; artists: SpotifyArtist[]; album?: { name?: string }; external_urls?: { spotify?: string } }
interface RecentlyPlayed {
  items?: { played_at: string; track: SpotifyTrack }[];
  cursors?: { after?: string };
}
interface SavedTracks {
  items?: { added_at: string; track: SpotifyTrack }[];
  next?: string | null;
  offset?: number;
  limit?: number;
}
interface Playlists {
  items?: { id: string; name: string; description?: string; public?: boolean; collaborative?: boolean; tracks?: { total?: number }; owner?: { id?: string; display_name?: string }; external_urls?: { spotify?: string } }[];
  next?: string | null;
  offset?: number;
  limit?: number;
}
interface FollowedArtists { artists?: { items?: SpotifyArtist[]; cursors?: { after?: string }; next?: string | null } }

function cursorString(context: ConnectorContext, key: string): string {
  return typeof context.cursor[key] === 'string' ? context.cursor[key] as string : '';
}

function cursorNumber(context: ConnectorContext, key: string): number {
  return typeof context.cursor[key] === 'number' ? context.cursor[key] as number : 0;
}

function trackItem(track: SpotifyTrack, kind: 'play_event' | 'saved_track', occurredAt: string, objectId: string): IntegrationSourceItemInput {
  const artists = track.artists.map((artist) => artist.name);
  const payload = {
    track_id: track.id,
    title: track.name,
    artists,
    album: track.album?.name ?? '',
    occurred_at: occurredAt,
    relationship: kind === 'play_event' ? 'played' : 'saved',
    url: track.external_urls?.spotify ?? '',
  };
  return {
    providerObjectType: kind,
    providerObjectId: objectId,
    payload,
    canonicalType: 'music_preference',
    canonicalText: `${kind === 'play_event' ? 'Listened to' : 'Saved'} ${track.name} by ${artists.join(', ')}${track.album?.name ? ` from ${track.album.name}` : ''}.`,
    normalizedData: payload,
    occurredAt,
    parserVersion: 'spotify-api-v2',
    normalizerVersion: 'music-preference-v2',
    contentType: 'spotify',
    metadata: { source: 'spotify', relationship: payload.relationship, track_id: track.id },
  };
}

export const spotifyConnector: IntegrationConnector = {
  providerId: 'spotify',
  async sync(context) {
    const recentUrl = new URL('https://api.spotify.com/v1/me/player/recently-played');
    recentUrl.searchParams.set('limit', '50');
    if (cursorString(context, 'recentAfter')) recentUrl.searchParams.set('after', cursorString(context, 'recentAfter'));

    const savedUrl = new URL('https://api.spotify.com/v1/me/tracks');
    savedUrl.searchParams.set('limit', '50');
    savedUrl.searchParams.set('offset', String(cursorNumber(context, 'savedOffset')));

    const playlistsUrl = new URL('https://api.spotify.com/v1/me/playlists');
    playlistsUrl.searchParams.set('limit', '50');
    playlistsUrl.searchParams.set('offset', String(cursorNumber(context, 'playlistOffset')));

    const artistsUrl = new URL('https://api.spotify.com/v1/me/following');
    artistsUrl.searchParams.set('type', 'artist');
    artistsUrl.searchParams.set('limit', '50');
    if (cursorString(context, 'artistAfter')) artistsUrl.searchParams.set('after', cursorString(context, 'artistAfter'));

    const [recent, saved, playlists, followed] = await Promise.all([
      oauthJson<RecentlyPlayed>(context, recentUrl.toString()),
      oauthJson<SavedTracks>(context, savedUrl.toString()),
      oauthJson<Playlists>(context, playlistsUrl.toString()),
      oauthJson<FollowedArtists>(context, artistsUrl.toString()),
    ]);

    const items: IntegrationSourceItemInput[] = [
      ...(recent.items ?? []).map(({ played_at, track }) => trackItem(track, 'play_event', played_at, `${track.id}:${played_at}`)),
      ...(saved.items ?? []).map(({ added_at, track }) => trackItem(track, 'saved_track', added_at, track.id)),
      ...(playlists.items ?? []).map((playlist) => {
        const payload = {
          playlist_id: playlist.id,
          name: playlist.name,
          description: playlist.description ?? '',
          public: playlist.public ?? null,
          collaborative: playlist.collaborative ?? false,
          track_count: playlist.tracks?.total ?? 0,
          owner_id: playlist.owner?.id ?? '',
          owner_name: playlist.owner?.display_name ?? '',
          url: playlist.external_urls?.spotify ?? '',
        };
        return {
          providerObjectType: 'playlist',
          providerObjectId: playlist.id,
          payload,
          canonicalType: 'music_preference',
          canonicalText: `Spotify playlist: ${playlist.name}\n${payload.description}\nTracks: ${payload.track_count}`.trim(),
          normalizedData: payload,
          parserVersion: 'spotify-api-v2',
          normalizerVersion: 'music-playlist-v1',
          contentType: 'spotify',
          metadata: { source: 'spotify', relationship: 'playlist' },
        };
      }),
      ...(followed.artists?.items ?? []).map((artist) => {
        const payload = {
          artist_id: artist.id,
          name: artist.name,
          genres: artist.genres ?? [],
          popularity: artist.popularity ?? null,
          url: artist.external_urls?.spotify ?? '',
        };
        return {
          providerObjectType: 'followed_artist',
          providerObjectId: artist.id,
          payload,
          canonicalType: 'music_preference',
          canonicalText: `Follows artist ${artist.name}.${payload.genres.length ? ` Genres: ${payload.genres.join(', ')}.` : ''}`,
          normalizedData: payload,
          parserVersion: 'spotify-api-v2',
          normalizerVersion: 'music-artist-v1',
          contentType: 'spotify',
          metadata: { source: 'spotify', relationship: 'follows_artist' },
        };
      }),
    ];

    const nextSavedOffset = saved.next ? (saved.offset ?? 0) + (saved.limit ?? 50) : 0;
    const nextPlaylistOffset = playlists.next ? (playlists.offset ?? 0) + (playlists.limit ?? 50) : 0;
    return {
      cursorAfter: {
        recentAfter: recent.cursors?.after ?? cursorString(context, 'recentAfter'),
        savedOffset: nextSavedOffset,
        playlistOffset: nextPlaylistOffset,
        artistAfter: followed.artists?.next ? followed.artists.cursors?.after ?? '' : '',
        completedAt: new Date().toISOString(),
      },
      items,
    };
  },
};
