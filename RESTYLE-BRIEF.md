# Restyle brief — Northwind Freight

> **New look, same behaviour.** This app is an automated-testing **target** for AegisRunner's
> crawler, which grounds real assertions against its DOM and URLs. You may freely replace the CSS,
> the HTML structure, the templating, and even the framework — but every **contract** in
> "Preserve exactly" below must survive unchanged, or the tests that run against this app break silently.

## What this app is (verbatim from `server.js`)
> NORTHWIND FREIGHT — a booking wizard, not a CRUD grid.
> 
> Meridian is flat: every entity is one form, one page, one save. A generator
> can do well there by filling whatever it finds. This app is deliberately the
> other shape, because the interesting failures live where Meridian has no
> surface:
> 
>   STATE ACROSS PAGES   a booking is assembled over four pages and only
>                        becomes real on the last one. A test that fills page
>                        three in isolation has tested nothing.
>   DERIVED MONEY        the total is computed from line items, a weight-tier
>                        discount, insurance and tax. Nobody types it, so an
>                        oracle has to know what it SHOULD be — the class of
>                        bug that is invisible to "did the form submit".
>   ORDER DEPENDENCE     step 3's options depend on what step 2 declared.
> 
> Faults are env-gated so the same image serves as healthy or faulty:
>   wizardamnesia  step 3 silently drops the cargo declared in step 2
>   badtotal       the weight discount is computed and then not applied
>   ghostbooking   confirm returns success without persisting the booking

## Preserve EXACTLY (load-bearing for the crawler)

**Routes** — keep every path + method (paths and `:id` shape are part of the contract):
```
GET  /login
POST /login
GET  /logout
GET  /
GET  /shippers
GET  /shippers/:id
GET  /bookings
GET  /bookings/:id
GET  /book/step1
POST /book/step1
GET  /book/step2
POST /book/step2
GET  /book/step3
POST /book/step3
GET  /book/review
POST /book/confirm
GET  /book/done
POST /api/reset
```

**Create → detail flow**
- Create form field `name=` attributes (keep these names): `shipperId`, `lane`, `desc`, `kg`, `insured`
- On a successful create the server **redirects to the new record's detail URL** (e.g. `/book/done?ref=${encodeURIComponent(booking.ref)}&total=${booking.total}`) — keep the redirect, not an inline success page.
- The **listing** must render each record's **visible identity** (its ref/name) as a **link to its detail page**.
- A detail URL for a record that does not exist must return **HTTP 404** (not a generic 200).

**Auth** — login form `POST /login` with fields `email` + `password`; session cookie **`freight_session_v1`**; demo creds `ops@northwind.test / ops12345`. Everything except `/login`, `/healthz`, `/api/reset` requires the session.

**Reset + fault injection** — DO NOT remove or rename:
- `POST /api/reset` guarded by request header **`X-Reset-Token`** (default `frt-reset`) → restores seed data.
- `GET /healthz` → `ok`.
- `DEMO_BUGS` env toggles faults: `badtotal`, `wizardamnesia`, `ghostbooking`. Healthy when empty. Keep **every** `BUGS.has("…")` branch and its exact flag name.

## Free to change
The stylesheet / design system, HTML markup + class names, the templating engine, the framework
(Express → Next / Fastify / Astro / Remix / …), and any client-side interactivity — provided the server
still serves the routes above with the **same field names, redirect targets, visible record identities,
404s, auth, `/api/reset`, `/healthz`, and `DEMO_BUGS` toggles**.

## Ship
- Keep a `Dockerfile` that builds a container listening on `PORT` and serving `/healthz`.
- Push to this repo's own remote: `https://github.com/Aegis-Runner/demo-northwind.git`.

---
_Auto-generated from `server.js`; if anything here disagrees with the code, the code wins — re-read it._
