# Fontify privacy

Fontify has no accounts, analytics, telemetry or developer-operated server. It does not collect browsing history or send page text to XDan or Google.

## What stays in your browser

- Typography preferences, theme, favourites, hostname/font/selector exceptions, and saved overrides.
- Uploaded TTF/OTF files and downloaded Google font files, in extension-origin IndexedDB.
- A pending right-click override request, including the hostname, original font, block selector and up to 160 characters of selected text. The request is removed when saved/cancelled, or expires after one hour and is removed on a subsequent extension startup/install. A short text label stays in the saved override until that override is deleted.

Settings use extension-local storage, not account sync. Fontify reads computed typography on the page to determine what should change. It does not transmit that page data.

## Requests to Google

When Google font downloads are enabled, Fontify requests the selected family, weight and style from `fonts.googleapis.com` and its font data from `fonts.gstatic.com`. Google receives these requests and ordinary network metadata such as the IP address. Requests are made from the extension background context with no page URL or selected text included. Hovering or keyboard-focusing a font-picker entry can trigger a font preview download.

Font downloads are cached locally. Turning downloads off prevents uncached Google fonts from downloading; cached fonts and custom uploads still work. The bundled catalogue and interface do not need network access.

## Backups and deletion

An exported backup includes settings, rules, their labels and uploaded font data. Treat it as a personal file. Importing a backup replaces settings but keeps other uploaded fonts in the collection. You can delete individual uploads and rules, reset settings, and clear downloaded Google font data separately. Removing the extension normally removes its associated browser storage.
