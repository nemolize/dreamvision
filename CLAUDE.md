# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## Issue labels

Every issue carries a `type:` label, and every issue that is not an
investigation also carries `severity:` and `area:`. For a generated repository,
create the labels listed below through GitHub before using the issue forms.
A form applies a label only when it already exists.

### Filing an issue yourself

Use `create_issue` with the labels set directly. Do not open the web form and do
not leave labelling to a later pass.

### Completing a human-filed issue

The forms under `.github/ISSUE_TEMPLATE/` set the `type:` label and nothing
else: the reporter's Area choice, and Severity where the form asks for it, land
in the issue body as text. When you pick such an issue up, read those sections
and apply the matching labels before starting work. Where the form has no
Severity section, judge `severity:` from the body with the table below; an
investigation takes none.

A section reading `not sure` is the reporter declining to guess — judge it
yourself from the body. A section reading `_No response_` was left empty.

### Choosing the values

`type:` — what kind of work it is.

| Label                | For                                                 |
| -------------------- | --------------------------------------------------- |
| `type:fix`           | Something behaves differently from what it promises |
| `type:feat`          | A capability the project does not have yet          |
| `type:docs`          | Documentation only                                  |
| `type:chore`         | Tooling, infra, dependencies, maintenance           |
| `type:investigation` | The question is what the behaviour even is          |

`severity:` — impact if nothing is done. Judge by who and what is affected,
never by how hard the fix looks: a one-line fix for data loss is `high`, and a
week-long refactor that changes no behaviour is `low`.

| Label             | Test                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| `severity:high`   | Blocks core functionality, or loses/corrupts data. No workaround         |
| `severity:medium` | Affects some users but core functions still work, or a workaround exists |
| `severity:low`    | Affects few users, or is largely cosmetic                                |

**Core functionality here is that a generated project builds, tests, and
deploys.** `pnpm run build`, the checks CI runs, and `pnpm run deploy` reaching
Cloudflare Workers — anything that stops one of those for every user of the
template is `high`. A project generated from this template replaces that
sentence with the flows its own users would lose: the screens and API calls an
app exists for, the public API of a library.

**`type:investigation` takes no severity.** Its impact is what the
investigation exists to find out, and recording an unmeasured impact as `low`
is indistinguishable from having measured it. Apply severity to the follow-up
issue the answer produces, not to the question.

`area:` — the layer the work starts in. The set here matches this template's
layers; a project that grows different ones updates its labels and the Area
dropdown in each form together.

| Label        | Covers                                           |
| ------------ | ------------------------------------------------ |
| `area:ui`    | Screens, components, styles                      |
| `area:api`   | Server-side request handling and business logic  |
| `area:build` | Build, compile, lint/format config, dependencies |
| `area:ci`    | CI pipelines and git hooks                       |
| `area:test`  | Test suites and coverage config                  |
| `area:infra` | Deployment target and runtime environment        |

When a change spans layers, label the one a fix starts in rather than every one
it touches.

There is no docs layer; `type:docs` already says the work is documentation. A
docs issue takes the `area:` of the layer the passage it is about describes
(the README's CI section is `area:ci`). A passage about the project as a whole,
such as setup, overview or agent instructions, takes `area:build`.
