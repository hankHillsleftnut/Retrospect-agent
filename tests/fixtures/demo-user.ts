/**
 * Hand-crafted fixture data for the demo user.
 * Used by `npm run seed:demo` and `npm run scenarios`.
 *
 * The story:
 *   Sam has three goals — get back in shape, ship a side project,
 *   stop catastrophizing at work. They've been making slow progress
 *   but discounting it. They've also been doom-scrolling at night
 *   and avoiding the gym on Fridays. This data lets us test that
 *   the pipeline picks up the not-yet-realized Friday avoidance pattern
 *   and the discounting-positives distortion.
 */

export const DEMO_USER = {
  apple_user_id: 'demo-user-fixture',
  email: 'demo@retrospect-agent.local',
};

export const DEMO_GOALS = [
  {
    title: 'Get back into consistent fitness',
    description: 'Strength train 3x/week and walk daily. Stop the on-again off-again cycle.',
  },
  {
    title: 'Ship the side project',
    description: 'Spend at least 4 focused hours on the side project each week.',
  },
  {
    title: 'Stop catastrophizing at work',
    description: 'Notice when I am predicting the worst and bring myself back to evidence.',
  },
];

export const DEMO_PREFERENCES = {
  tone: 'direct, compassionate, no toxic positivity. Be honest with me.',
  trusted_voice_description:
    'an older brother who has been through this before — calm, matter-of-fact, occasional dry humor',
  focus_areas: ['fitness', 'side project follow-through'],
  avoid_topics: [],
  directives: [],
};

/**
 * Each item below becomes a row in raw_content for the demo user.
 * The dates are relative offsets (days ago) so the seed is repeatable.
 */
export const DEMO_RAW_CONTENT: { daysAgo: number; content_type: string; content: string }[] = [
  {
    daysAgo: 12,
    content_type: 'voice_recording',
    content: `Okay so I'm just walking back from the gym, did legs today which I hated but I did it.
That's three times this week actually if you count Monday. I keep thinking I'm not doing enough
but I guess three is the goal. I don't know, doesn't feel like it counts because Wednesday was
kinda half-assed. Whatever. Tomorrow's Friday, I'll probably skip but that's fine.`,
  },
  {
    daysAgo: 11,
    content_type: 'voice_recording',
    content: `Skipped the gym today. It's Friday I'm tired. I'll just go Saturday. The week was good
even with this. Side project — I opened the laptop for like 20 minutes and just closed it.
I keep thinking everyone's going to hate it when I ship. I can't even imagine actually putting
it out there.`,
  },
  {
    daysAgo: 9,
    content_type: 'voice_recording',
    content: `Big standup today, I was so sure my manager was going to push back on the plan I drafted
and she just said "this looks great." I almost want to argue with her. Like surely she missed
something. But also that's the fourth time this month she's praised something I made. So.
Anyway gym was good today, did 4 sets of squats. Sunday I'm going to do a long walk.`,
  },
  {
    daysAgo: 8,
    content_type: 'screen_time',
    content: `Total screen time: 6h 22m. Top apps: Instagram 2h 14m, TikTok 1h 8m, Slack 49m, VS Code 32m.
Pickups: 87. Most pickups between 10pm-12am. First pickup 6:47am.`,
  },
  {
    daysAgo: 7,
    content_type: 'voice_recording',
    content: `Sunday. Did NOT walk. Spent like four hours scrolling. I feel gross. I told myself this is
the week I ship the side project. We'll see. I keep saying that.`,
  },
  {
    daysAgo: 5,
    content_type: 'voice_recording',
    content: `Two gym sessions this week already and it's Tuesday. Feeling weirdly capable. Manager pinged me
to lead a small workstream — I immediately thought she's setting me up to fail. Then I caught myself.
Like, that thought just appears. It's automatic. She has literally never set me up to fail.`,
  },
  {
    daysAgo: 4,
    content_type: 'screen_time',
    content: `Total screen time: 4h 11m. Top apps: VS Code 1h 22m, Slack 41m, Instagram 1h 03m, YouTube 28m.
Pickups: 52. First pickup 7:12am. Productive apps up 38% vs prior week.`,
  },
  {
    daysAgo: 3,
    content_type: 'voice_recording',
    content: `Pushed the first version of the side project to staging today. It's ugly. It works.
I keep wanting to scrap it. But it works. That's three times this month I've shipped something
ugly that worked. I just had a thought — maybe I'm actually fine at finishing things and I'm
just dramatic about it. Anyway.`,
  },
  {
    daysAgo: 2,
    content_type: 'voice_recording',
    content: `Friday again. Skipped gym again. I keep going Mon-Wed and then collapsing on Friday.
I'm not even tired, I just don't go. I'll go Saturday. Same as last week, same as the week before.`,
  },
  {
    daysAgo: 1,
    content_type: 'voice_recording',
    content: `Saturday. Did go to the gym. Felt strong. Side project — opened it, panicked about whether
the architecture is right, closed it. Same pattern as last Saturday actually. Sundown is when I open
the laptop for the side project and Saturday afternoon is when I open it but only for like 15 minutes
before I bail. I'm noticing I bail when I have to make a design choice.`,
  },
];
