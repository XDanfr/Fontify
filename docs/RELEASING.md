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
3. The first version uses the extension ID `fontify@xdan.me` from the Firefox manifest. Keep that ID stable.
4. On a version tag, the workflow runs `web-ext sign --channel unlisted`. A signed XPI is included in the artifact and Release.

Without credentials, the workflow succeeds with an explicitly named **unsigned** XPI. A signing failure with configured credentials fails the build so an unsigned package is never mistaken for a signed one. Mozilla may require source review; provide this repository and its locked dependency/build instructions. Automated unlisted signing does not create a public AMO listing.

## Cut a version

1. Update `package.json` and `package-lock.json` using `npm version <version> --no-git-tag-version`.
2. Update visible version text in `src/ui.js` and any versioned examples in the README.
3. Run unit tests, both builds, Firefox lint and Chromium integration tests.
4. Commit the version update.
5. Tag the corresponding commit, for example `git tag v1.0.0`, and push that tag.
6. Verify that the build and Release contain the expected version and signing results.

Do not reuse a Firefox version after it has been submitted to AMO. Do not expose signing secrets to forked pull requests; the workflow does not read credentials in PR runs.

Official references: [Chrome extension distribution](https://developer.chrome.com/docs/extensions/how-to/distribute/), [Firefox signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/), and [web-ext command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/).
