# Xtag

Xtag is a Chrome extension for adding your own local labels to X/Twitter accounts.

It only does three things:

- manually label accounts on `x.com` / `twitter.com`
- publish your local label list as a share link
- preview and manually import labels shared by another user

There is no automatic merging and no local server requirement for the extension.

## Install Locally

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click Load unpacked
4. Select the `extension/` directory
5. Refresh `x.com`

The extension stores labels in Chrome extension local storage under `tg_labels_v1`.

## Manual Labels

Open the toolbar popup or click a badge beside an account name on X.

Supported labels:

- Trust
- Scammer
- Suspect
- Propaganda
- Idiot
- Neutral

You can add, update, or delete labels. Imported labels keep source metadata so you can see where they came from and bulk-delete labels from one source.

## Share Labels

The popup can publish your current local label snapshot to an HTTPS share backend.

The public link only points to the snapshot. Anyone with the link can view the shared label data.

The bundled share Worker allows public publishing by default and limits each IP to one publish per hour. For private deployments, set `PUBLISH_TOKEN` on the Worker and do not ship that token in the extension package.

## Import Labels

Paste another user's `/s/<id>` or `/api/shares/<id>` link into the popup.

Xtag shows a preview first. Nothing is merged until the user confirms. Conflicting labels are skipped unless the user explicitly enables overwrite.

## Free Share Backend

`share_worker/` contains a minimal Cloudflare Worker + KV backend for share links.

Deploy outline:

```bash
cd share_worker
npm install
npx wrangler kv namespace create SHARES
```

Copy the returned KV namespace id into `share_worker/wrangler.jsonc`, then deploy:

```bash
npx wrangler deploy
```

For private write access, set a Worker secret:

```bash
npx wrangler secret put PUBLISH_TOKEN
```

Do not put private tokens into the extension package.

## Package

Build the Chrome extension zip:

```bash
./scripts/package_extension.sh
```

Output:

```text
dist/xtag-extension-v<version>.zip
dist/xtag-extension-unpacked/
```

`dist/` is ignored by Git.
