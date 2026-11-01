<!--
Fill in every section. Where a section names its own wording for the empty
case, use that; otherwise write "N/A". Keep the heading either way, so a
reviewer can tell the section was considered rather than forgotten.

Delete these guidance comments as you go, but leave any other comment alone —
automation may keep a block of this description between marker comments of its
own, and deleting one of a pair breaks whatever maintains it.
-->

## Summary

<!--
What problem does this solve, and what does this change do about it? Two or
three sentences is usually enough.

Write what a reader cannot get from the diff itself — do not list the changed
files or narrate the diff; the Files tab shows that. State no reason, no
effect and no verification you cannot point at: a plausible motivation you
did not confirm reads to a reviewer exactly like one you did. Where a change
has no motivation beyond itself, such as a routine dependency bump, one line
naming it is enough.

Say what a user of the app will notice. Write "no user-visible change" when
that is the answer.

For a breaking change, start a paragraph with "**Breaking:**" and say what
breaks and what has to be done to migrate (config keys, secrets, stored data,
deploy shape).

For a visible change, include a before/after image or a short recording; it is
faster to review than any description of it. Say so if you could not capture
one, so its absence does not read as an oversight.
-->

## Context and links

<!--
Link whatever explains why this change exists — a GitHub issue, a tracker
ticket, a design doc, a chat thread.

To close a GitHub issue on merge, use a closing keyword: "Fixes #123" or
"Closes #123". Anything else is a reference rather than a trigger, so link it
with a word about what it is:

  Fixes #123
  Spec: <url>
  Reported in: <url>

Write "N/A" if this change stands on its own.
-->

## Verification beyond CI

<!--
Do not restate what CI already checks on this PR — the checks report
themselves. List only what CI cannot: a flow you exercised by hand, a device
or browser you tried it on. Write "no manual verification" if you did none;
never describe a check you did not actually run.
-->

## Notes for reviewers

<!--
Anything that speeds up review: which file to read first, a design decision
you are unsure about, alternatives you rejected, or work that is intentionally
out of scope (link a follow-up issue).

Write "N/A" if you have nothing to add.
-->
