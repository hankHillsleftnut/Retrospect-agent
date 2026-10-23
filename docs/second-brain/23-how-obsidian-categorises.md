# 23 — How Obsidian categorises input (it doesn't)

Research on Obsidian's data model and organising mechanics, and what it implies
for a system that does the opposite.

---

## The one-line finding

**Obsidian categorises nothing.** It is deliberately, architecturally
unopinionated. Every structure in a vault was put there by the user, by hand,
and the tool's core design commitment is to never impose one.

That is its strength and the direct cause of its best-documented failure mode.

---

## 1. What it actually is

A **vault** is a folder of plain `.md` files on disk. Obsidian reads raw
Markdown with no rich-text layer, so every note remains readable in any text
editor if you stop using Obsidian entirely. There is no database, no server, no
schema.

> **→ In plain English.** It's a folder of text files with a nice window over
> it. That's the whole product. The radical choice is what it *refuses* to do.

**Three syntax extensions** on top of standard Markdown, all working with no
plugins:

- `[[wikilinks]]` — connect two notes
- `![[embeds]]` — pull one note's content into another
- `> [!NOTE]` callouts

---

## 2. The four mechanisms a user has

Everything a person can do to organise a vault reduces to these.

### Links — `[[note name]]`

Manual, typed by the person. **Backlinks are generated automatically** — any
note shows what points at it without anyone maintaining that list.

One genuinely good mechanic: **you can link to a note that doesn't exist yet.**
Obsidian creates the link to an empty note without complaint, and those dangling
links become a running list of what to write next, surfaced in the Unlinked
Mentions panel.

> **→ In plain English.** You write `[[the thing about my brother]]` and
> Obsidian doesn't object that no such note exists. It just holds the space. The
> gaps become a to-do list you never had to write.

### Tags — `#tag`

Flat or nested buckets. Good for status and broad topic, applied by hand.

### Properties — YAML frontmatter

A block at the top of the file, fenced by `---`. Obsidian's Properties panel is
a visual editor over the same YAML — the panel and the raw text are two views of
one thing. This is the only *structured* layer, and the schema is whatever the
user invents.

### Folders

Ordinary filesystem folders. Optional. **Binary** — a note is in one folder or
another, never both, and folders carry no structure of their own.

---

## 3. The methodologies are all bolted on

Because the tool imposes nothing, an entire culture of methodologies has grown
to fill the gap:

- **PARA** — Projects, Areas, Resources, Archive. Folder-based, action-oriented.
- **Zettelkasten** — atomic notes, densely linked, emergent structure.
- **MOCs (Maps of Content)** — pioneered by Nick Milo. A note that is a map of
  other notes. The pitch against folders: a note can be on many maps or none,
  where a folder forces exactly one.

The recurring community advice is telling:

> The "right system" emerges during practice after a long time. It's not
> designed up front.

> **→ In plain English.** Obsidian ships no opinion, so a whole cottage industry
> exists to sell people one. And the honest version of that advice is *you'll
> figure out your system eventually, after a long time of not having one.*
>
> That is a real cost being described as a feature.

---

## 4. The failure modes are well documented

This is the part worth taking seriously, because it is the consumer-scale
version of the lifelogging critique in doc 21 §3.

**The collector's fallacy.** Saving feels productive — clipping an article gives
a small hit — but collecting isn't learning. What accumulates is *an
ever-growing debt of unprocessed information*.

**The note graveyard.** A system optimised for input with no architecture for
output. For most people reporting frustration, **capture rate is high and
retrieve rate is near zero.** And the sharp formulation:

> A note you never find again is worse than no note, because it creates a false
> sense of having captured something.

**The maintenance tax.** Inboxes fill, tags drift inconsistent, links break,
notes go stale. That maintenance falls entirely on the user, and when it stops,
the system becomes unusable. The overhead frequently exceeds the value for
anyone who isn't a professional writer or researcher.

**The feedback loop is too long.** Hard to tell whether the system is working;
most people lose motivation before any value materialises.

> **→ In plain English.** The documented pattern is: enthusiastic setup, months
> of capture, an unreadable pile, abandonment. Not because people are lazy —
> because the tool's core commitment (impose nothing) hands the user a job that
> only compounds.
>
> Sellen & Whittaker said this about lifelogging in 2010 (doc 21 §3). Obsidian
> is the same argument running at consumer scale with a better editor.

---

## 5. The contrast, which is the actual point

Retrospect is inverted on every axis.

| | **Obsidian** | **Retrospect** |
|---|---|---|
| who categorises | the user, manually | the system, on ingest |
| structure | emergent, invented per person | fixed ontology — predicates |
| storage | Markdown files | typed rows with spans |
| linking | hand-typed `[[wikilinks]]` | derived: evidence → assertion → pattern |
| what is kept | everything given to it | only what a quote can prove |
| what is discarded | nothing | claims without spans, noise, duplicates |
| maintenance | the user's job, forever | lint, supersession, decay |
| when it degrades | user stops tidying | patterns stop recurring and die |
| **failure mode** | **note graveyard** | **wrong inference** |

That last row is the honest trade. Obsidian cannot be wrong about you, because
it never says anything about you — it only holds what you put in it. Retrospect
*can* be wrong, because it asserts. Those are genuinely different risks and the
second one is the one docs 17–22 exist to manage.

**The bet stated plainly:**

> Obsidian's failure is that nobody reads it back. The cost of being unopinionated
> is that the user must supply all the opinion, and the evidence is that they
> mostly don't.
>
> Retrospect's bet is that a system willing to discard, categorise, and assert —
> with a quote behind every claim — is worth the risk of being occasionally
> wrong, because the alternative reliably produces nothing at all.

---

## 6. What's worth stealing

**Dangling links as a to-do list.** Linking to a note that doesn't exist yet,
and surfacing those gaps, is the best mechanic here. Retrospect has structural
analogues already — ambiguous names held in `entity_resolution_candidates`,
patterns sitting below the promotion bar — but they are stored, not surfaced.
The Obsidian version makes the gap *visible and inviting*. Worth copying: **a
view of what the system is waiting to learn.**

**Automatic backlinks.** Obsidian generates them with no user effort. Retrospect
has richer versions — every fact knows its source entry, every pattern knows its
facts — and surfaces none of it. Backwards traversal from an entry ("what did
this produce?") is free to compute and currently unbuilt.

**Plain files, no lock-in.** Obsidian's durability argument is real and is why
people trust it with a decade of writing. Retrospect's data lives in Postgres
with no export. For a product asking someone to deposit their inner life,
"you can leave and take it with you" is worth more than it costs to build.

**Properties as a visual editor over raw structure.** The panel and the YAML
being two views of one thing is a good pattern — structure that is editable
without being hidden.

**What not to steal:** the unopinionated core. That is the source of the
graveyard, and it is precisely what this product exists to not do.

---

## Sources

- [Internal links and backlinks — Obsidian Help](https://deepwiki.com/obsidianmd/obsidian-help/4.2-internal-links-and-graph-view)
- [How to link notes in Obsidian: wikilinks, backlinks](https://www.obsibrain.com/blog/obsidian-linking-the-complete-guide-to-connecting-your-notes)
- [Obsidian properties: the complete guide](https://obsidianmate.com/article/obsidian-properties-complete-guide)
- [Markdown and properties with frontmatter](https://mbuege.com/2026/05/08/obsidian-markdown-properties-frontmatter/)
- [Front matter and tags — obsidiantools](https://deepwiki.com/mfarragher/obsidiantools/3.3-front-matter-and-tags)
- [Obsidian note organisation: folders vs MOCs vs tags](https://blog.shuvangkardas.com/obsidian-note-organization/)
- [Maps of Content: effortless organization for notes](https://obsidian.rocks/maps-of-content-effortless-organization-for-notes/)
- [PARA and Zettelkasten simultaneously — Obsidian Forum](https://forum.obsidian.md/t/taking-advantage-of-orderly-para-and-chaotic-zettelkasten-methodologies-simultaneously/47786)
- [Personal Knowledge Management is Bullshit](https://letter.otherlife.co/p/personal-knowledge-management-bullshit)
- [Personal knowledge management is broken](https://tryultrathink.com/blog/personal-knowledge-management-broken)
- [5 signs your PKM system is working against you](https://frankanaya.com/knowledge-management/5-signs-your-pkm-system-works-against-you/)
