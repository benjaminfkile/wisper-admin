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

## Layout

```
src/app/            App Router: layout (theme + AuthProvider) + gated overview page
src/components/     UI: AdminGate (auth gate), AdminShell (AppBar/nav), HealthBadge
src/lib/auth/       Cognito auth: JWT decode, AuthProvider/context, token storage
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
