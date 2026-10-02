# Contributing to @teaflask/assistant

## This repository is a mirror

This repository is a read-only mirror of one directory in Teaflask's
private monorepo. A bot rewrites it when a production release publishes,
so the history and authorship here are the bot's, and nothing is edited
here directly.

## Issues

Issues are welcome. Use the bug report or feature request template, and
read the documentation at <https://docs.teaflask.com> first. A security
vulnerability goes to the address in [SECURITY.md](SECURITY.md), never to
an issue.

## Pull requests

Pull requests are not accepted yet. A workflow comments on each one and
closes it automatically: the bot would overwrite any merge on its next
release. Describe the change you want in an issue instead.

## How a release reaches npm

1. Each change to the package is written up under `## Unreleased` in
   `CHANGELOG.md`, in the source tree. Nobody edits the version in
   `package.json` by hand.
2. When a production release publishes and the files npm ships have
   changed since the last published version, the release cuts the next
   version: a patch, or a minor or major when an Unreleased entry says so.
   The Unreleased entries become that version's section, and the mirror
   sync lands the new tree here.
3. The same sync then pushes an annotated `vX.Y.Z` tag automatically, as
   the bot, whenever this repository does not already hold a tag for the
   version in `package.json`. No maintainer tags anything by hand. A
   release that changed only files npm never ships (tests, fixtures,
   workflows) lands here without a new version.
4. The tag push starts the publish workflow, which first checks that the
   tag names the version in `package.json`, then runs `npm test`,
   `npm run build` and `npm run check:package`, and finally `npm publish`.
5. npm receives the package with provenance, through trusted publishing
   rather than a token.

## Versioning while 0.x

While the package is 0.x, exports, props and types may be renamed or
removed between 0.x versions, with each change recorded in `CHANGELOG.md`;
from 1.0 the public surface is additive-only.

## Working in this tree

Use the Node version in `.nvmrc`. Then:

```sh
npm ci
npm test
npm run lint
npm run build
npm run check:package
```

`npm run generate:api` regenerates the client under `src/generated/` and
needs `SERVING_OPENAPI_SPEC` to point at an OpenAPI document that is not in
this repository. The generated code is committed, so a clone needs no spec.
