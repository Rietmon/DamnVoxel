# Contributing to DamnVoxel

Thank you for helping. Bug reports, ideas, fixes, documentation and `.vox` files that break the editor are all welcome.

## Reporting a bug
Open an issue with:
- what you did, what you expected and what happened;
- the browser and the device (desktop, tablet, phone; mouse, touchpad, finger or pen);
- if a file is involved, the `.vox` itself — or a small one that shows the problem.

A `.vox` that MagicaVoxel opens but DamnVoxel reads wrongly (or the other way round) is especially valuable: it can join the test corpus in `tests/fixtures/vox`.

## Setting up
You need [Node.js](https://nodejs.org/) 22.12 or newer and [pnpm](https://pnpm.io/) 10.

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173 (`?demo` opens the example island). Read [docs/architecture.md](docs/architecture.md) before writing code — it is short and it explains the rules the code follows.

## The rules that matter most
- **Every change to a document is a command.** That is what makes undo, redo and the mirror work everywhere. Never write to a document any other way.
- **`core/` and `kernels/` do not know about the browser.** No DOM, WebGL, Svelte or `window` there; they are tested in Node. `pnpm lint` checks the layer direction.
- **`src/formats` imports nothing from the editor.** It is MIT-licensed so other programs can copy it.
- **`.vox` compatibility is not negotiable.** Opening and saving a file without edits must keep its content, including chunks we do not understand. Never write chunks of our own into `.vox`.
- **The first launch must stay under its size budget** ([docs/stack.md](docs/stack.md#budgets)). Windows, menus and anything not needed at start-up load on first use through `import()`.
- **Runtime dependencies need a reason.** Explain in the pull request what a new dependency gives, how much it weighs and why the platform or a few lines of our own will not do.
- **Touch is first-class.** A change to the interface should work with a mouse, a finger and a pen, on a desktop and in the phone layout (narrower than 700 px).
- **Do not rename the browser storage keys** (`voxels-…` in IndexedDB and localStorage, `voxels-keymap`): that would wipe people's autosave, versions, library and keys.

## Before you open a pull request
Run what CI runs:

```sh
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm size
```

- Add or update tests next to the code (`*.test.ts`). Tools are tested with synthetic rays (`core/tools/test-context.ts`).
- If people can see the change, update the [user guide](docs/user/README.md) and, if needed, the technical docs.
- Check visual changes in the browser on a desktop and in the phone layout. `node scripts/shot.ts <url> <out.png>` takes a screenshot without a window.
- Keep a pull request to one change, with a short description of what and why.

## Code style
- TypeScript in strict mode, formatted by Biome (`pnpm format`).
- Hot loops are plain functions over typed arrays: no objects per voxel, no closures inside the loop.
- Comments explain why, not what.
- Interface text is short and plain; tooltips read “Name · key”.

## Licensing of contributions
By submitting a contribution you agree that it is licensed under the licence of the files it changes: the GNU AGPL-3.0-or-later for the editor, MIT for `src/formats`, CC BY 4.0 for `docs/formats.md`. Add third-party data only with its licence, and list it in [NOTICE](NOTICE).
