# wisper-admin

The **admin** web app for **Wisper** — a separate, standalone site gated to the `admin` role: platform overview (revenue, active leases, host/consumer counts), policy & pricing rules, host and consumer moderation, payouts, and the audit log.

Next.js (App Router) + MUI + TypeScript. Deployed on Vercel; it talks to the **wisper-api** control-plane (the `/v1/admin/*` surface).

## Stack

- **Next.js 14** (App Router) + **React 18** + **TypeScript**
- **MUI v9** (`@mui/material`) with `@mui/material-nextjs` for App-Router SSR styling (amber accent to distinguish the admin surface)
- **Vitest** + Testing Library for tests
- API access via a small typed client (`src/lib/wisper`) over a same-origin `/wisper/*` proxy (no CORS)

## Configure

The app calls same-origin `/wisper/*`; Next rewrites that to the Wisper API (see `next.config.mjs`), so there is no browser CORS. Point it at your Wisper host:

```sh
cp .env.example .env.local
# set WISPER_API_URL=https://<your-wisper-host>   (defaults to http://localhost:8080)
```

## Develop

```sh
npm install
npm run dev      # http://localhost:3000
npm run build    # production build (type-check + lint)
npm test         # Vitest
```

## Local development (no Cognito, API-key sign-in)

To run the admin app against a **local wisper-api** with no Cognito, sign in with
a pasted API key instead of the Hosted UI.

1. In `wisper-api`, define an **admin-scoped** key in the `Auth:ApiKeys` config
   map — a `wck_live_<64-hex>` key whose scopes include `admin`. (Keys are minted
   via `/v1/me/api-keys`, which is JWT-only; for local dev you just declare one in
   config.) Start the API on `127.0.0.1:8090`.
2. In this app, point the proxy at that API and leave the Cognito vars unset:

   ```sh
   # .env.local
   WISPER_API_URL=http://127.0.0.1:8090
   # (no NEXT_PUBLIC_COGNITO_DOMAIN / NEXT_PUBLIC_COGNITO_CLIENT_ID)
   ```

3. `npm run dev`, open the app, and paste the admin-scoped key into the sign-in
   form (a password field — the key is never echoed or logged).

The gate authorizes the key **by asking the backend**: it probes
`GET /v1/admin/overview` with the key as the bearer — `200` signs you in, `403`
shows *not authorized* (the key lacks the `admin` scope), and `401` clears the
bad/revoked key. This is backend-authoritative, unlike the Cognito path's
client-side JWT decode (a UX fast-path only). Sign-out clears whichever
credential is held.

## Layout

```
src/app/            App Router: layout (theme + AuthProvider) + gated overview page
src/components/     UI: AdminGate (auth gate), ApiKeySignIn (local-dev key form), AdminShell, HealthBadge
src/lib/auth/       auth: JWT decode, gate resolution (JWT/API-key), AuthProvider/context, credential storage
src/lib/wisper/     typed API client + /v1/admin client + types (mirrors wisper-api)
src/theme.ts        MUI dark theme (admin amber accent)
```

## Auth

The app is gated to the Cognito `admin` group. `AuthProvider` decodes the
Cognito ID token (from `localStorage`, or captured from a Hosted-UI redirect
fragment) purely to drive the UI: `AdminGate` renders the app for an admin, a
clear **not-authorized** screen for a signed-in non-admin, and a sign-in prompt
otherwise. The `/v1/admin` API client sends the token as a bearer credential; the
Wisper API independently verifies the signature and group on every call, so the
client-side decode is never trusted for security. Configure the Hosted UI via
`NEXT_PUBLIC_COGNITO_DOMAIN` / `NEXT_PUBLIC_COGNITO_CLIENT_ID` (see `.env.example`).

When those vars are unset (local dev), the sign-in screen instead accepts a
pasted Wisper **API key** (`wck_…`) as the bearer, authorized against the backend
— see **Local development** above.
