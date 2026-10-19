import { googleDocsConnector } from './google-docs';
import { gmailConnector } from './gmail';
import { googleCalendarConnector } from './google-calendar';
import { spotifyConnector } from './spotify';
import { redditConnector } from './reddit';
import { youtubeConnector } from './youtube';
import { pinterestConnector } from './pinterest';
import { tiktokConnector } from './tiktok';
import { linkedinConnector } from './linkedin';
import { xConnector } from './x';
import { registerConnector, type IntegrationConnector } from './connector';

export const continuousIntegrationConnectors: IntegrationConnector[] = [
  googleDocsConnector,
  gmailConnector,
  googleCalendarConnector,
  spotifyConnector,
  redditConnector,
  youtubeConnector,
  pinterestConnector,
  tiktokConnector,
  linkedinConnector,
  xConnector,
];

export const continuousConnectorProviderIds = continuousIntegrationConnectors
  .map((connector) => connector.providerId)
  .sort();

export function registerContinuousIntegrationConnectors(): void {
  for (const connector of continuousIntegrationConnectors) registerConnector(connector);
}
