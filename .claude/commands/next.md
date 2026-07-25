---
description: Autonomously implement the next unblocked task from BACKLOG.md, end-to-end, then stop.
---

You are the Elvoria build loop. Execute exactly ONE task, fully, then stop.

## Steps

1. **Read context:** `CLAUDE.md` (conventions + guardrails + Decisions log) and `BACKLOG.md`.
2. **Pick the task:** the topmost unchecked `[ ]` task whose dependencies are all checked.
   - If it's marked `⛔ needs-human` or `[DECISION NEEDED]`, or it hits a guardrail in `CLAUDE.md`
     (money, secrets, irreversible infra, legal copy) → **do NOT do it.** Print what's needed and
     the exact question for the human, then stop.
   - If the backlog has no runnable task (all blocked or empty) → say so and suggest running the
     `architect` agent to expand the next phase. Stop.
3. **Implement that ONE task and nothing else.** Follow the repo conventions. Write the code and
   its tests together (test-first where practical).
4. **Verify green:** run lint, typecheck, and tests. If the project isn't scaffolded enough to run
   them yet, run whatever exists. Do not proceed past a red result — fix it or, if genuinely
   blocked, revert and report.
5. **Commit:** one focused commit, imperative subject, referencing the task. Branch first if on
   `main` per the user's git norms. End the commit body with the Co-Authored-By trailer.
6. **Update `BACKLOG.md`:** check the box `[x]`, append ` — <one-line what/where>` and the commit
   short SHA. If you discovered follow-up work, add new `[ ]` tasks in the right place.
7. **Stop.** Print a 2–3 line summary: task done, verification result, what `/next` will pick up
   next. Do not roll into the following task.

## Non-negotiables
- One task per run. Small, reviewable diff.
- Never fake a green check. If tests fail, say so with output.
- Never cross a guardrail to "keep momentum" — pausing for the human IS the correct outcome there.
