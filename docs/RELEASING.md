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
4. On a version tag, the workflow runs `web-ext sign --channel unlisted` with a human-readable review-source ZIP. A signed XPI is included in the artifact and Release. This signs for distribution outside the Mozilla Add-ons store and does not create a public store listing.

Without credentials, the workflow succeeds with an explicitly named **unsigned** XPI. A signing failure with configured credentials fails the build so an unsigned package is never mistaken for a signed one. Mozilla may require source review; provide this repository and its locked dependency/build instructions. Automated unlisted signing does not create a public AMO listing.

## Cut a version

1. Update `package.json` and `package-lock.json` using `npm version <version> --no-git-tag-version`.
2. Update versioned examples in the README and add `docs/releases/v<version>.md`. The interface version is injected automatically from package.json during the build.
3. Run unit tests, both builds, Firefox lint and Chromium integration tests.
4. Commit the version update.
5. Merge the verified changes to main, then tag that commit, for example `git tag v1.1.1`, and push the tag. Creating a GitHub release with a new tag on that commit also triggers the tag workflow.
6. Verify that the build and Release contain the expected version and signing results. The workflow rejects a tag that differs from the package version or has no matching release-notes file.

Tags trigger signing and release uploads automatically; a normal workflow_dispatch on main only produces development packages. To retry a tagged signing run, rerun that run after inspecting its failure rather than dispatching the workflow on main. Never publish a listed Mozilla version as part of this workflow.

The review-source archive uses an explicit list of application directories and metadata files. Local notes, unrelated root files, dependency installations, artifacts, and private keys are excluded.

Do not reuse a Firefox version after it has been submitted to AMO. Do not expose signing secrets to forked pull requests; the workflow does not read credentials in PR runs.

Official references: [Chrome extension distribution](https://developer.chrome.com/docs/extensions/how-to/distribute/), [Firefox signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/), and [web-ext command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/).
