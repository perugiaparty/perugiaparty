# PerugiaParty website

Public site for perugiaparty.com, deployed on Cloudflare.

- `public/index.html` is the whole site (no build step).
- `wrangler.jsonc` tells Cloudflare to serve the `public` folder.
- Every push to `main` is published automatically.
