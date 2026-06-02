# Xtag Share Worker

Minimal Cloudflare Worker + KV backend for Xtag share links.

It stores label snapshots and serves:

- `POST /api/shares`
- `GET /api/shares/<id>`
- `GET /s/<id>`

Deploy:

```bash
npm install
npx wrangler kv namespace create SHARES
```

Copy the namespace id into `wrangler.jsonc`, then:

```bash
npx wrangler deploy
```

Optional private publishing:

```bash
npx wrangler secret put PUBLISH_TOKEN
```

If `PUBLISH_TOKEN` is not set, anyone can publish snapshots to the Worker. Use Cloudflare rate limiting if the endpoint is public.
