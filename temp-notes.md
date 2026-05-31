- Is 66.16 planning on ingesting client data? or test data? If client, presumably there is
  a dependency on ID-62 (staging fixtures) and ID-64 (pre-re-ingest-readiness).
  - We should also review ID-42 (PullMD) for any outstanding actions may be unblocked now,
    or soon.
- We need to review and update the canonical pipeline sequencing doc - I noticed that it
  was removed from the continuation promts since s278, which presumably will have lead to
  reduced context each session, on how the in-flight tasks "fit together".
  - I'm not sure ID-67 is even on the sequencing doc, but presumably this is a key task
    that should be.
- As /scripts is public in the package, we should audit it and identify candidates to be
  archived - there are scripts there which are from projects prior to this one, for
  example, plus 07-collapse-list.md will like include others which are retiring as part of
  the pipeline implementation.
- We should create a new task for identifying what would be required, and the
  implications, of changing the repo from private to public, starting with our standard
  RESEARCH.md subtask.
- As you saw this session, there is a considerable amount of historical context - whilst
  helpful at times, it can also cause confusion, which was a big driver for implemeting
  our own docs-site (ID-9), mirroring Warp's approach, which includes skills and, a
  docubot, and our structured '/spec' setup, with the intention of creating clean,
  canonical documentation which can be referenced when required, removing any concern over
  whether documentation is outdated.
  - Firstly, I'd like to understand if our Astro docs-site is now deployed/visible to
    me/users? (For clarity, this isn't a doc site for the clients, it's specific to the
    knowledge hub product, so aimed at you and I). Is there a runbook, or guide for usage
    etc.
  - Secondly, I'd like to understand what we should do with everything under .planning, in
    terms of whether it should be external to the repo, or just remain gitignored, and the
    implications for tools like gitnexus, mempalace, and cocoindex-code, which presumably
    mine/index this currently e.g., is it better for it to be present, even if outdated,
    or removed and the doc-site relied on etc.
- Can/should `/spike` now be deleted?
- Is the .cache `task-view` repo still required?
