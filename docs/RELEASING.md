# Releasing Fontify

## Development artifacts

Push to `main`, wait for **Build Fontify**, then download `fontify-packages` from the run. The archive contains Chrome ZIP/CRX and Firefox ZIP/unsigned XPI. Keys are excluded.

## Stable Chrome identity

1. Run `npm run build && npm run package` locally.
2. Preserve the generated `artifacts/development-key.pem` privately, or use your own RSA PEM key.
3. Add the complete PEM text as the repository Actions secret `CHROME_PRIVATE_KEY`.
4. Do not commit the key. `.gitignore` excludes PEM files and the artifacts directory.

The key signs a CRX3; it does not grant a Chrome Web Store signature. For public Chrome distribution, upload the Chrome ZIP through the Chrome Web Store developer dashboard. Review permissions and the privacy disclosure during submission.

## Firefox signing

1. Create Mozilla Add-ons API credentials in your AMO developer account.
2. Add the key as `AMO_JWT_ISSUER` and the secret as `AMO_JWT_SECRET` in repository Actions secrets.
3. The Firefox manifest uses the extension ID `fontify@xdan.cc`. The domain migration changes the add-on identity: sign and distribute it as a new add-on, since it cannot update installations using the previous ID. Keep the new ID stable for subsequent releases.
4. On a version tag, the workflow runs `web-ext sign --channel unlisted`. A signed XPI is included in the artifact and Release.

Without credentials, the workflow succeeds with an explicitly named **unsigned** XPI. A signing failure with configured credentials fails the build so an unsigned package is never mistaken for a signed one. Mozilla may require source review; provide this repository and its locked dependency/build instructions. Automated unlisted signing does not create a public AMO listing.

## Cut a version

1. Update `package.json` and `package-lock.json` using `npm version <version> --no-git-tag-version`.
2. Update visible version text in `src/ui.js` and any versioned examples in the README.
3. Run unit tests, both builds, Firefox lint and Chromium integration tests.
4. Commit the version update.
5. Tag the corresponding commit, for example `git tag v1.1.0`, and push that tag.
6. Verify that the build and Release contain the expected version and signing results.

Do not reuse a Firefox version after it has been submitted to AMO. Do not expose signing secrets to forked pull requests; the workflow does not read credentials in PR runs.

Official references: [Chrome extension distribution](https://developer.chrome.com/docs/extensions/how-to/distribute/), [Firefox signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/), and [web-ext command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/).

## Signed manual dry run

Run **Build Fontify** using **Run workflow**, selecting the test branch. Manual
branch dispatches run only `signed-dry-run`; the ordinary build and release jobs
are skipped. No tag, GitHub Release, or public store listing is created. Mozilla
receives an unlisted submission for the existing `fontify@xdan.cc` identity.
All three signing secrets are required; missing credentials fail the run.

Each dispatch uses `0.0.<workflow run number>.<attempt>` in both manifests and
package filenames, leaving committed production versions untouched. This keeps
test versions below 1.1.0 and makes every retry distinct because AMO does not
allow a previously submitted version to be reused. Do not copy this job into
another workflow with a fresh run-number counter without changing its version
namespace. An AMO rejection still consumes that attempt; rerun the workflow,
which increments the attempt, rather than uploading the same version manually.

The four package artifacts are separate Chrome ZIP, stable-key signed CRX3,
Firefox ZIP, and Mozilla-signed XPI. A fifth artifact contains SHA-256 checksums
and verification results including Chrome identity, Firefox identity/version,
and Firefox release's signature and active-installation verdict. The unsigned
XPI and private key are never uploaded. Uploads occur only after all checks pass.
Chromium runs the existing interactive extension suite. Firefox runs manifest
lint plus a persistent signed-installation check, not the Chromium interaction
suite. Existing known dependency lint warnings remain visible.

A stable-key CRX signature is a developer signature, not Chrome Web Store
approval. Unlisted Mozilla signing still records the test version on AMO and
may require Mozilla review; a signing timeout is a failure, not a signed result.
