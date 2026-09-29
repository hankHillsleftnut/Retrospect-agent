# Capture everything

A design change, not a tweak. Prompted by a real dump on 2026-09-21: five
paragraphs went in, three facts came out. The two that fell on the floor were
a market-positioning insight ("SF tech bros want emotional intelligence... this
is the product for them") and a reflection on past fear. Neither was wrong.
Neither had anywhere to go.

---

## The defect

The extractor has one closed vocabulary — `stated_goal`, `skipped_or_avoided`,
`said_about_self`, `felt`, `attended`, `mentioned_person` and a few more — and
every one of them is about a person's **life**.

The user is a founder. A large share of what they write is about the thing they
are **building**: who it is for, why it matters, what to try next. The bank has
no vocabulary for any of it, so the extractor does the safe thing and drops it.

Under-extraction rather than wrong extraction — the correct failure mode, and
still a failure. Half of what someone writes falling silently on the floor is
not a second brain.

## The insight that makes this safe

Two constraints are currently tangled together and should not be:

| Question | Mechanism | Should it loosen? |
|---|---|---|
| **Is this true?** | Span verification — no quote, no fact | **Never.** |
| **What kind of thing is this?** | The predicate vocabulary | **Yes, a lot.** |

The span gate does not care what category a claim belongs to. So the taxonomy
can widen enormously without weakening truthfulness by one inch.

A second tangle, already identified for feelings and true more broadly:
**being captured and being analysed are different things.** A product thesis
should be banked, searchable and traceable. It should never be counted three
times and promoted to "a pattern about you."

## Consequence worth stating

Today a dropped candidate means either *"the model invented a quote"* or
*"we had nowhere to file it."* Those are opposite problems sharing one counter.

After this change, the drop rate becomes a **pure truthfulness signal** —
which is what makes it usable as the health metric doc 10 relies on.

---

## The model

Every span-verified claim is captured. Each carries a **domain** (for filing and
search) and follows an **analysis route** (what processing may touch it).

| Domain | What it holds | Analysis route |
|---|---|---|
| `behaviour` | What they did or avoided | **Patterns** — the promoter |
| `intention` | Goals, plans, what they want | **Supersession** — quitting retires |
| `self_narration` | How they talk about themselves | **Patterns**, grouped by stance |
| `state` | How they felt | **Themes** (doc 15) — questions, never verdicts |
| `relationship` | People, and how they are around them | **Entities + significance** |
| `work` | Theses, positioning, decisions about what they build | **Banked + change-tracked. No patterns.** |
| `idea` | Something they want to make or try | **Banked only.** |
| `reference` | External things named — a book, a tool, someone's advice | **Banked + linkable.** |
| `uncategorized` | Everything else, with the model's own label | **Banked. Reviewed to grow the vocabulary.** |

### Rules

1. **Nothing is dropped for lacking a category.** If no domain fits, it lands in
   `uncategorized` carrying the label the model proposed. Precedent exists in
   this codebase: `identity_inferences` already has an `emerging` domain with a
   free-text `domain_label`. Same escape hatch, same reason.
2. **Only `behaviour` and `self_narration` reach the promoter.** A thesis is not
   a habit. Repeating an idea three times does not make it a behavioural loop.
3. **`work` is change-tracked, not pattern-tracked.** The interesting question
   is not "how often did you say it" but "how has your answer moved." That is
   `changed_since`, which already exists.
4. **The span gate does not move.** No quote, no fact, in any domain.
5. **`uncategorized` volume is a metric.** A steady stream means the vocabulary
   has a hole; that is the signal to add a domain, deliberately, rather than
   letting the model invent categories per run.

---

## Filing it where it belongs

Capture is half the ask. The other half: a new claim should attach to what is
already known rather than landing alone.

- **People** resolve through `entity_aliases`, already built.
- **Topics** need the same treatment: the product, a project, a recurring
  concern. A `topic` entity type already exists in the schema and is unused.
- **Threads** — the open loops doc 04 calls `open_threads`. A new claim about
  something already open should join that thread, not start a new one.

Without this, "capture everything" becomes a bigger pile rather than a better
brain. The pile is not the product; the connections are.

---

## What this is not

- **Not a loosening of the Fact gate.** The gate is the reason any of this is
  trustworthy.
- **Not permission to infer more.** Wider capture, identical restraint about
  what may be concluded from it.
- **Not a reason to widen what the episode says.** A `work` fact being in the
  bank does not make it podcast material. Consumers stay constrained by the pack.

---

## Order of work

1. Widen the taxonomy: domains, the escape hatch, the routing table.
2. Route by domain — only behaviour and self-narration reach the promoter.
3. Emotional themes (doc 15) become one route inside this model rather than a
   separate feature.
4. Topic and thread resolution, so capture becomes connection.
5. Search, so any of it can be found. Capture without retrieval is a drawer.
