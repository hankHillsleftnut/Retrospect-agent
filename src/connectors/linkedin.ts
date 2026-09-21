import type { IntegrationSourceItemInput } from '../types';
import type { IntegrationConnector } from './connector';
import { oauthJson } from './oauth-http';

interface LinkedInUserInfo {
  sub?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
  email?: string;
  email_verified?: boolean;
}

export const linkedinConnector: IntegrationConnector = {
  providerId: 'linkedin',
  async sync(context) {
    const profile = await oauthJson<LinkedInUserInfo>(context, 'https://api.linkedin.com/v2/userinfo');
    const providerObjectId = profile.sub ?? profile.email ?? context.connectionId;
    const payload = {
      ...profile,
      relationship: 'authenticated_professional_profile',
    };

    const items: IntegrationSourceItemInput[] = [{
      providerObjectType: 'openid_profile',
      providerObjectId,
      payload,
      canonicalType: 'professional_profile',
      canonicalText: [
        `LinkedIn profile: ${profile.name ?? 'Unknown member'}`,
        profile.email ? `Email: ${profile.email}` : '',
        profile.locale ? `Locale: ${profile.locale}` : '',
      ].filter(Boolean).join('\n'),
      normalizedData: payload,
      parserVersion: 'linkedin-oidc-v1',
      normalizerVersion: 'linkedin-profile-v1',
      contentType: 'linkedin',
      metadata: {
        source: 'linkedin',
        relationship: 'authenticated_professional_profile',
        signal_class: 'professional_identity',
      },
    }];

    return {
      cursorAfter: { profileSyncedAt: new Date().toISOString() },
      items,
    };
  },
};
