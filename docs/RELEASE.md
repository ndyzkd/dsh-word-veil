# Release runbook

This file is for the maintainer. It contains no account names, local paths or
credentials; replace `<owner>` with the public repository owner.

## 1. Freeze the version

- `package.json` version: `1.0.0`
- plugin title: **词纱 / Word Veil**
- npm/repository slug: `dsh-word-veil`
- tag: `v1.0.0`

Run:

```powershell
node tools/build-client.mjs
node tools/check.mjs
npm test
node tools/privacy-check.mjs
npm pack --dry-run
```

All four checks must pass. `tools/check.mjs` also verifies that `lib/client.js`
matches the generated output.

## 2. Create a clean repository

Do **not** push the old development repository with `git push --mirror`: its
history contains internal acceptance notes and local paths. This release tree is
a fresh repository with one commit and no shared history.

```powershell
git status
git log --oneline
git remote -v
```

Expected: one `release: 词纱 v1.0.0` commit, no remote.

## 3. Create the GitHub repository

Create an empty repository named `dsh-word-veil` under the desired account or
organization. Keep it **private** until the privacy and license review below is
complete.

```powershell
git remote add origin https://github.com/<owner>/dsh-word-veil.git
git push -u origin main
git push origin v1.0.0
```

Do not force-push a repository that already has collaborators; start empty.

## 4. Privacy checklist

- The release repository has **one commit**, not the development history.
- `git log --format='%an <%ae>'` contains only the public identity you chose;
  never a personal email if you do not want it public.
- `node tools/privacy-check.mjs` passes.
- Run a human search for absolute home-directory paths, machine names and
  personal account names. Do not paste the exact strings into a public issue or
  commit message while investigating.
- No screenshots of a personal desktop, no browser tabs, no terminal history, no
  API keys, no exam dates, no wordbook exports.
- The GitHub account that owns the repository is public by definition. Use a
  dedicated account or organization if the repository itself should not be tied
  to a personal identity.

## 5. License review before public visibility

- Code: MIT.
- Pack headwords: the source terms are documented in `data/verified/README.md`
  and `docs/DATA.md`; they are **not cleared for redistribution** by this
  project. See `NOTICE.md`.
- If you cannot clear those terms, publish the code without `packs/` and
  `data/verified/`, or publish only the code and let users build packs locally.
  Do not label the pack data as MIT merely because the code is MIT.

## 6. npm (separate approval)

`npm publish` is a separate public channel from GitHub. Only run it after the
package name, version, license review and npm account are explicitly approved:

```powershell
npm whoami
npm publish --access public
```

Never commit an npm token or `.npmrc` containing one. If the package is not
published, keep the README's source-install instructions and do not claim that
`npm install dsh-word-veil` works.

## 7. After publishing

- Create a GitHub release from `v1.0.0` and attach the tarball only if its
  contents passed `npm pack --dry-run`.
- Enable private vulnerability reporting in the repository Security settings.
- Enable Dependabot if dependencies are added later (the current package has no
  runtime dependencies).
- Do not share the development repository archive; share this clean repository.
