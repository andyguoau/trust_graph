# Chrome Web Store Submission Notes

## Name

Xtag

## Short Description

Show and edit your own local account labels on X/Twitter.

## Detailed Description

Xtag adds small local labels beside account names on x.com and twitter.com.

Use it to manually label accounts as trusted, scammer, suspect, propaganda, idiot, or neutral. The toolbar popup lets you add, edit, and delete labels.

You can publish your own label snapshot as a share link. Other users can paste that link into Xtag, preview the incoming labels, and manually import the labels they choose. Labels from imports keep source metadata, so users can review or bulk-delete labels from one source.

Labels are stored in Chrome extension local storage on the user's device. The extension does not require localhost, a local database, or a local server. Only snapshots the user explicitly publishes are uploaded to the HTTPS share backend they configure.

## Permissions

`storage`: stores user-created labels and lightweight settings on the user's device.

`https://x.com/*` and `https://twitter.com/*`: required to show badges beside X/Twitter account names and let users edit labels from those pages.

## Privacy

The extension reads visible X/Twitter account handles on pages the user visits so it can display local labels.

Label edits are stored in Chrome extension local storage. When the user clicks publish, the selected label snapshot may be uploaded to the configured HTTPS share backend and returned as a public link.

No user data is sold. The extension does not load or execute remotely hosted code. The extension does not use Google APIs.

## Pre-Submit Check

```bash
node --check extension/content.js
node --check extension/popup.js
./scripts/package_extension.sh
unzip -l dist/xtag-extension-v0.1.0.zip
```
