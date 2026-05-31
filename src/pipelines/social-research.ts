import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { research } from '../services/perplexity';
import { runIngest } from './ingest';

export interface SocialHandle {
  platform: 'instagram' | 'tiktok' | 'twitter' | 'linkedin' | 'substack' | 'youtube' | 'other';
  handle: string; // raw handle or full URL
}

export interface SocialResearchOptions {
  userId: string;
  handles: SocialHandle[];
  triggeredBy?: 'http' | 'cron' | 'onboarding';
}

export interface SocialResearchSummary {
  handles_researched: number;
  queries_fired: number;
  raw_content_ids: string[];
  ingest_summary: Awaited<ReturnType<typeof runIngest>>;
}

// Clean a handle: strip @ prefix and URLs to get the bare username
function cleanHandle(handle: string): string {
  return handle
    .replace(/^https?:\/\/(www\.)?(instagram|tiktok|twitter|x|linkedin|substack|youtube)\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/$/, '')
    .trim();
}

function displayName(platform: SocialHandle['platform'], handle: string): string {
  const clean = cleanHandle(handle);
  const map: Record<string, string> = {
    instagram: `@${clean} on Instagram`,
    tiktok: `@${clean} on TikTok`,
    twitter: `@${clean} on X/Twitter`,
    linkedin: `${clean} on LinkedIn`,
    substack: `${clean} on Substack`,
    youtube: `${clean} on YouTube`,
    other: clean,
  };
  return map[platform] ?? clean;
}

// Build the set of speculative queries for a single handle
function buildQueries(platform: SocialHandle['platform'], handle: string): string[] {
  const clean = cleanHandle(handle);
  const display = displayName(platform, handle);

  const base: string[] = [];

  if (platform === 'instagram' || platform === 'tiktok') {
    base.push(
      `Who is ${clean} on ${platform}? What do they post about, what is their aesthetic, what values come through in their content?`,
      `"@${clean}" ${platform} bio interests values personality`,
      `What kind of person follows or creates content like ${display}? What does this content style reveal about identity, aspirations, and struggles?`,
      `${clean} ${platform} content themes — what topics does this creator return to repeatedly?`,
    );
  }

  if (platform === 'twitter') {
    base.push(
      `Who is @${clean} on Twitter/X? What do they tweet about, what are their recurring themes and opinions?`,
      `"@${clean}" site:twitter.com OR site:x.com interests beliefs`,
      `What does @${clean}'s Twitter presence reveal about their values, intellectual interests, and how they see themselves?`,
    );
  }

  if (platform === 'linkedin') {
    base.push(
      `${clean} LinkedIn profile — what is their career background, stated skills, and professional aspirations?`,
      `"${clean}" site:linkedin.com career background`,
      `What does ${clean}'s LinkedIn profile reveal about where they are in their career and where they want to go?`,
    );
  }

  if (platform === 'substack' || platform === 'youtube') {
    base.push(
      `What does ${display} write/create about? What are the central themes, the intellectual preoccupations, the emotional undertone?`,
      `${clean} ${platform} — what does this person care deeply about based on their public work?`,
    );
  }

  // Speculative cross-platform queries for any handle
  base.push(
    `"${clean}" personal website OR blog OR interview OR article — any long-form content that reveals how this person thinks`,
    `Who is ${clean} as a person — what are they working toward, what do they struggle with, what do they value publicly?`,
  );

  return base;
}

export async function runSocialResearch(
  options: SocialResearchOptions
): Promise<SocialResearchSummary> {
  const allRawContentIds: string[] = [];
  let totalQueries = 0;

  for (const socialHandle of options.handles) {
    const queries = buildQueries(socialHandle.platform, socialHandle.handle);
    const display = displayName(socialHandle.platform, socialHandle.handle);

    console.log(`[social-research] ${display} — firing ${queries.length} queries`);

    // Fire all queries in parallel
    const results = await Promise.allSettled(
      queries.map((q) =>
        research(
          q,
          `You are researching a real person's public social media presence and online identity.
Be thorough and specific. If you find their bio, summarize it verbatim.
If you find recurring themes in their content, describe them precisely.
If you find interviews, articles, or long-form content, extract the key claims about who this person is.
Be speculative where direct information is sparse — what does the available signal suggest about this person's values, struggles, and aspirations?`
        )
      )
    );

    totalQueries += queries.length;

    // Compile all findings into a single rich document
    const findings: string[] = [];
    let citationCount = 0;

    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.answer && !r.value.answer.includes('[perplexity disabled')) {
        findings.push(`## Query: ${queries[i]}\n\n${r.value.answer}`);
        citationCount += r.value.citations.length;
      } else if (r.status === 'rejected') {
        console.warn(`[social-research] Query failed: ${queries[i]} — ${r.reason}`);
      }
    });

    if (findings.length === 0) {
      console.warn(`[social-research] No results for ${display} — skipping`);
      continue;
    }

    const content = `# Social Web Research: ${display}
Researched: ${new Date().toISOString()}
Platform: ${socialHandle.platform}
Handle: ${socialHandle.handle}
Queries run: ${queries.length} | Results returned: ${findings.length} | Citations: ${citationCount}

${findings.join('\n\n---\n\n')}`;

    // Save as raw_content so the normal ingestion pipeline picks it up
    const { data: row, error } = await supabase
      .from(Tables.RAW_CONTENT)
      .insert({
        user_id: options.userId,
        content_type: 'social_web_research',
        content,
        processing_status: 'pending',
        metadata: {
          platform: socialHandle.platform,
          handle: socialHandle.handle,
          queries_fired: queries.length,
          results_returned: findings.length,
          citation_count: citationCount,
          triggered_by: options.triggeredBy ?? 'http',
        },
      })
      .select('id')
      .single();

    if (error) {
      console.error(`[social-research] Failed to save raw_content for ${display}: ${error.message}`);
      continue;
    }

    allRawContentIds.push(row!.id);
    console.log(`[social-research] Saved ${display} → raw_content ${row!.id}`);
  }

  // Run ingestion on the newly created rows
  const ingestSummary = await runIngest({
    userId: options.userId,
    rawContentIds: allRawContentIds,
    triggeredBy: 'http',
    notes: `social-research — ${options.handles.map((h) => `${h.platform}:${h.handle}`).join(', ')}`,
  });

  return {
    handles_researched: options.handles.length,
    queries_fired: totalQueries,
    raw_content_ids: allRawContentIds,
    ingest_summary: ingestSummary,
  };
}
