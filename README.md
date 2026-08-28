# wisper-admin

The **admin** web app for **Wisper**: a separate, standalone site gated to the `admin` role: platform overview (revenue, wallet liability, host earnings, active leases, host/consumer counts, health), the versioned policy and pricing rules, host and consumer moderation, manual refunds and ledger adjustments, ledger-account forensics, and the audit log.

Next.js (App Router) + MUI + TypeScript. Deployed on Vercel; it talks to the **wisper-api** control plane (the `/v1/admin/*` surface).

## Stack

- **Next.js 14** (App Router) + **React 18** + **TypeScript**
- **MUI v9** (`@mui/material`) with `@mui/material-nextjs` for App-Router SSR styling (amber accent to distinguish the admin surface)
- **Vitest** + Testing Library for tests
- API access via a small typed client (`src/lib/wisper`) over a same-origin `/wisper/*` proxy (no CORS)

## Features

Every page is wrapped in `AdminGate` + `AdminShell` (brand, section nav, an API health chip that polls `GET /healthz` every 5 s, and an account menu with sign-out).

- **Overview** (`/`): `GET /v1/admin/overview` rendered as stat tiles (revenue, wallet liability, host earnings, active leases, hosts with the online count, consumers) plus a color-coded health chip. Money is formatted with `Intl.NumberFormat` (`en-US`, currency from the response), so amounts carry thousands separators; counts use the same locale grouping; a missing field renders a dash instead of `NaN`.
- **Policy & Pricing** (`/policy`): loads `GET /v1/admin/policy` (`{ active, versions }`) into a form and publishes a new versioned row with `PUT /v1/admin/policy`. Fields: platform fee (`fee_bps`, required, 0..10000), minimum top-up, max concurrent leases per user, max TTL cap, first top-up max, new-account window (hours) and per-day top-up cap, platform max spend per day, minimum isolation floor (`shared` / `sandboxed` / `vm`, or none), and an effective-from date-time. Dollar fields are entered in dollars and sent as integer cents; empty optional fields are omitted. A version-history table lists every revision.
- **Moderation** (`/moderation`): Hosts and Consumers tabs backed by `GET /v1/admin/hosts` and `GET /v1/admin/users`, with a client-side search box, status / online / isolation / Stripe-linkage chips, and Suspend (a required reason, `POST /v1/admin/{hosts|users}/:id/suspend`) / Unsuspend (`.../unsuspend`) actions.
- **Payouts** (`/payouts`): two money-moving forms, each guarded by an `Idempotency-Key` that is minted per submission and reused across retries of that submission so a re-click cannot double-post:
  - **Refund a consumer**: `POST /v1/admin/refunds` with `user_id`, `amount_cents`, optional `payment_intent`, and a reason.
  - **Ledger adjustment**: `POST /v1/admin/adjustments`, a balanced double-entry transfer (`debit_account_id` / `credit_account_id` / `amount_cents` / `reason`). The form takes one account id plus a credit/debit direction and uses a platform clearing account as the offsetting leg, previewing both legs and the zero net before posting.
- **Ledger** (`/ledger`): `GET /v1/admin/ledger/accounts/:id` read-only forensics for any ledger account id: balance, owner, and its entries.
- **Audit** (`/audit`): `GET /v1/admin/audit` newest first, filterable by actor, action, and target id, paged with the opaque `next_cursor` ("Load more", 50 per page).

## Configure

The app calls same-origin `/wisper/*`; Next rewrites that to the Wisper API (see `next.config.mjs`), so there is no browser CORS. Point it at your Wisper host:

```sh
cp .env.example .env.local
# set WISPER_API_URL=https://<your-wisper-host>   (defaults to http://localhost:8080)
```

`WISPER_API_URL` is read by `next.config.mjs` when the rewrite table is built, so it must be present at **build** time (for Vercel, set it in the project's environment variables and redeploy after changing it). It is server-side only and never reaches the browser. The two `NEXT_PUBLIC_COGNITO_*` variables are baked into the client bundle at build time.

## Develop

```sh
npm install
npm run dev      # http://localhost:3000
npm run build    # production build (type-check + lint)
npm start        # serve the production build
npm run lint     # next lint
npm test         # Vitest, single run
npm run test:watch
```

## Local development (no Cognito, API-key sign-in)

To run the admin app against a **local wisper-api** with no Cognito, sign in with
a pasted API key instead of the Hosted UI.

1. In `wisper-api`, define an **admin-scoped** key in the `Auth:ApiKeys` config
   map: a `wck_live_<64-hex>` key whose scopes include `admin`. (Keys are minted
   via `/v1/me/api-keys`, which is JWT-only; for local dev you just declare one in
   config.) Start the API on `127.0.0.1:8090`.
2. In this app, point the proxy at that API and leave the Cognito vars unset:

   ```sh
   # .env.local
   WISPER_API_URL=http://127.0.0.1:8090
   # (no NEXT_PUBLIC_COGNITO_DOMAIN / NEXT_PUBLIC_COGNITO_CLIENT_ID)
   ```

3. `npm run dev`, open the app, and paste the admin-scoped key into the sign-in
   form (a password field; the key is never echoed or logged).

The gate authorizes the key **by asking the backend**: it probes
`GET /v1/admin/overview` with the key as the bearer. `200` signs you in, `403`
shows *not authorized* (the key lacks the `admin` scope), and `401` clears the
bad/revoked key; any other failure (for example the local API being down) keeps
the key so a reload can retry. This is backend-authoritative, unlike the Cognito
path's client-side JWT decode (a UX fast-path only). The key is held in
`localStorage` (`wisper.admin.apiKey`). Sign-out clears whichever credential is held.

## Layout

```
src/app/            App Router: layout (theme + AuthProvider) and the gated pages
                    / (overview), /policy, /moderation, /payouts, /ledger, /audit
src/components/     UI: AdminGate (auth gate), ApiKeySignIn (local-dev key form), AdminShell, HealthBadge,
                    OverviewDashboard + StatTile, PolicyEditor, Moderation, PayoutsPanel, LedgerAccountView,
                    AuditLog
src/lib/auth/       auth: JWT decode (jwt), gate resolution for JWT / API key (gate), AuthProvider + context,
                    credential storage + Hosted UI URL (storage)
src/lib/wisper/     typed API client (client), the /v1/admin client with tolerant unwrapping (admin), types
src/lib/            format (money / bps / numbers / dates), idempotency (key minting)
src/theme.ts        MUI dark theme (admin amber accent)
```

## Auth

The app is gated to the Cognito `admin` group. Sign-in redirects to the Cognito
**Hosted UI** (implicit flow, `response_type=token`, scope `openid email profile`,
`redirect_uri` = the app's origin, so that origin must be an allowed callback URL on
the app client). On return, `AuthProvider` captures the `#id_token=...` fragment,
strips it from the address bar, and stores the token in `localStorage`
(`wisper.admin.idToken`). It decodes the ID token purely to drive the UI: `AdminGate`
renders the app for a member of the `admin` group, a clear **not-authorized** screen
for a signed-in non-admin, and a sign-in prompt otherwise. An expired token is
treated as signed out (there is no refresh; sign in again). The `/v1/admin` API
client sends the token as a bearer credential; the Wisper API independently
verifies the signature and group on every call, so the client-side decode is never
trusted for security. Configure the Hosted UI via `NEXT_PUBLIC_COGNITO_DOMAIN` /
`NEXT_PUBLIC_COGNITO_CLIENT_ID` (see `.env.example`).

When those vars are unset (local dev), the sign-in screen instead accepts a
pasted Wisper **API key** (`wck_...`) as the bearer, authorized against the backend;
see **Local development** above.

## Known drift against wisper-api

The admin client unwraps envelopes tolerantly, but several shapes it sends or reads differ from what the current wisper-api defines (see its `docs/API.md` and `Admin/AdminModels.cs`). Until the client is updated:

- Ledger adjustment: the API requires both `debit_account_id` and `credit_account_id` to be ledger-account UUIDs; the form's platform clearing leg is sent as the literal string `platform`, which the API rejects. Post adjustments with two real account ids until this is fixed.
- Policy: `host_signups_enabled` is not part of the API's policy contract; the switch is sent but ignored and never comes back.
- Audit: the API parses `actor` and `target_id` as UUIDs (a non-UUID filter is a `validation_error`) and returns each row's details as `meta`, which the log's Details column does not read yet.
- Ledger forensics: the API returns `{ account: {...}, entries: [...] }` with `kind` / `owner_user_id` / `balance_cents` on `account` and `debit_cents` / `credit_cents` / `transaction_id` / `lease_id` per entry; the view reads a flat account and `amount_cents` / `running_balance` per entry.
- Moderation lists fetch only the first page (the API default of 25) and filter client-side; the API's `?query=`, `limit`, and `offset` are not used yet.
- `GET /v1/admin/leases` and `POST /v1/admin/leases/:id/end` (force-end) exist on the API but have no page here yet.
