# Northwind Freight

A fictional demo application used as an AegisRunner testing target (no third-party IP).

## What it exercises

```
NORTHWIND FREIGHT — a booking wizard, not a CRUD grid.

Meridian is flat: every entity is one form, one page, one save. A generator
can do well there by filling whatever it finds. This app is deliberately the
other shape, because the interesting failures live where Meridian has no
surface:

  STATE ACROSS PAGES   a booking is assembled over four pages and only
                       becomes real on the last one. A test that fills page
                       three in isolation has tested nothing.
  DERIVED MONEY        the total is computed from line items, a weight-tier
                       discount, insurance and tax. Nobody types it, so an
                       oracle has to know what it SHOULD be — the class of
                       bug that is invisible to "did the form submit".
  ORDER DEPENDENCE     step 3's options depend on what step 2 declared.

Faults are env-gated so the same image serves as healthy or faulty:
  wizardamnesia  step 3 silently drops the cargo declared in step 2
  badtotal       the weight discount is computed and then not applied
  ghostbooking   confirm returns success without persisting the booking
```

## Run

```sh
docker build -t demo-northwind .
docker run -p 3000:3000 -e DEMO_RESET_TOKEN=changeme demo-northwind
```

Fault injection is env-gated via `DEMO_BUGS` (comma-separated); healthy when empty. Reset via `POST /api/reset` with header `X-Reset-Token`.
