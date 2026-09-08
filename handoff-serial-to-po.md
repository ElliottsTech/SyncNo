# Syncro: Linking a Serial Number to a Purchase Order (session-cookie method)

## The goal
In SyncroMSP, I need to go from a **serial number** to the **purchase order (PO)** it was received on. There is no public API endpoint that does this directly. I want to build this into an existing project using the same internal (session-cookie) endpoint the Syncro web UI uses.

## Background / what I already discovered (don't redo this)

I captured a HAR file of myself doing this manually in the Syncro UI:
1. Searched for serial `S7NXCV210250317`
2. It opened the product page for product `5201913` ("Asus ExpertBook 15.6" i5 16GB")
3. I clicked through to PO `1782586`

The relevant API calls in the HAR (subdomain `elliotts.syncromsp.com`):

```
GET /products/5201913/edit?sn=S7NXCV210250317              <- product page (entry point)
GET /products/5201913/product_serials/history?sn=S7NXCV210250317  <- serial history modal (THE BRIDGE)
GET /purchase_orders/1782586                               <- the PO I clicked to
```

### The bridge endpoint (this is what to build on)

```
GET https://elliotts.syncromsp.com/products/{product_id}/product_serials/history?sn={serial_number}
```

- Method: GET
- Returns: `text/html`, ~3101 bytes, status 200. It's a small HTML fragment / modal, not JSON.
- This endpoint is what knows serial→PO. It is an **internal** web endpoint, NOT part of the public API. It requires an authenticated technician session (cookie-based), not the API key.
- The PO link is embedded in this HTML response (that's how the UI renders the "click to open PO" link).
- Referer header sent by the browser: `https://elliotts.syncromsp.com/products/{product_id}/edit?sn={serial}`

**IMPORTANT — unknown detail:** The HAR did NOT capture the response body of this endpoint (HAR recording started mid-session and only later responses were captured). So I have not seen the exact HTML structure of the `/product_serials/history` response. The first thing to do in this project is hit this endpoint once with a valid session cookie and inspect the returned HTML to find how the PO number/ID is embedded, then write a parser for it. Based on the PO page HTML I did capture, PO references in Syncro's HTML appear as links like `/purchase_orders/1782586`.

### Why the public API cannot do this (verified)

- `GET /api/v1/products/{id}` → the product's `linked` block contains tickets + invoices, but **no purchase orders**.
- Serial records carry a `line_item_id`, but that is the **invoice** line item (the sale to a customer), NOT the PO line item. In the worked example, serial `line_item_id` = 103386605 (invoice 20059's line item), while the PO line item is a different record (`po_line_items_7698570`, id 7698570).
- PO line items (from `GET /purchase_orders/{id}`) DO reference `product_id`, so PO→product is stored — but there is **no API to search POs by product / line item**. There are ~3,256 POs in this instance and no filter for product on the PO list endpoint.
- `lookup_serial` returns serial + product + the *sale-side* relationships (ticket/invoice/estimate/asset). No PO.

Conclusion: Syncro stores the serial→PO relationship only at the DB level; the web app's serial-history modal queries it server-side. The public API never exposes it.

## Worked example (verified, all values confirmed against live data)

| Thing | Value |
|---|---|
| Subdomain | `elliotts` (full: `elliotts.syncromsp.com`) |
| Serial | `S7NXCV210250317` |
| Serial record id | 149785714 |
| Product id | 5201913 |
| Product name | Asus ExpertBook 15.6" i5 16GB |
| Serial `instance_price_cost` | 1230.9 |
| Target PO id | 1782586 |
| PO number | E-20241113-1 |
| PO status | Finished |
| PO vendor | Edsys (vendor_id 136076) |
| PO line item id | 7698570 (table row id `po_line_items_7698570`) |
| PO line `product_id` | 5201913 |
| PO line `cost` | 1230.9 (matches serial's `instance_price_cost`) |
| PO line `sku` | NBP1503CVAS70650X |
| Serial `created_at` | 2024-11-15 11:49:31 (+08:00) |
| PO line received (`updated_at`) | 2024-11-15 11:49:05 (+08:00) — 26s before serial created |
| PO `created_at` | 2024-11-13 10:26:09 (+08:00) |

The cost-match + timing match is consistent: when a serialized PO line is received, Syncro creates the serial record and copies the PO line's `cost` into the serial's `instance_price_cost`. This is the basis of the fallback heuristic (below).

## What to build (the session-cookie method)

1. Authenticate as a technician and obtain a valid session cookie (however my existing project handles Syncro web-session login — the cookie, not the API key).
2. Given a serial number, first resolve its `product_id` (can use the public API `GET /api/v1/products/lookup_serial?serial=...` or whatever is already in the project).
3. Hit the internal endpoint:
   ```
   GET https://{subdomain}.syncromsp.com/products/{product_id}/product_serials/history?sn={serial}
   ```
   with the session cookie and a `Referer: https://{subdomain}.syncromsp.com/products/{product_id}/edit?sn={serial}` header.
4. Parse the returned HTML for the purchase order reference. The PO appears as a link to `/purchase_orders/{id}`. (Inspect the first real response to confirm exact markup — e.g. a table row, a tooltip, or an `<a href="/purchase_orders/...">`.)
5. Extract the PO id and return it. Optionally fetch full PO details via the public API `GET /api/v1/purchase_orders/{id}`.

### Gotchas / caveats
- The session cookie can expire; build in re-auth/retry on 302-to-login or 401/403.
- This is an unofficial internal endpoint — it could change. Keep the parser tolerant (regex for `/purchase_orders/(\d+)` is more robust than exact DOM structure).
- Use the API key path (`GET /api/v1/purchase_orders/{id}`) for the rich PO data after you have the id; only use the scraped endpoint to *find* the id.

## Fallback (pure-API heuristic, no session cookie) — use if session method isn't available

If a web session isn't possible, the serial→PO link can be recovered heuristically:
1. `lookup_serial` → get `product_id`, `instance_price_cost`, and `created_at` (from `raw_json`).
2. From the product, get its `vendor_ids` (e.g. Edsys = 136076) and SKUs.
3. Enumerate POs filtered by that vendor and a date window around the serial's `created_at` (`GET /api/v1/purchase_orders?...`). Note: the list endpoint does NOT filter by product, so this is the narrowing step.
4. For candidate POs, `GET /api/v1/purchase_orders/{id}` and check each `line_item`: match on `product_id` AND `cost == instance_price_cost`. The PO whose line was received nearest to (just before) the serial's `created_at` is the match.
5. This is not 100% (two POs from the same vendor at the same cost in the same window could collide) but it's correct for the vast majority of cases, especially for serialized single-unit hardware.

## Useful extra data points from the captured PO page HTML (for parser reference)

On the PO show page, the line-items table looks like this (this WAS captured in the HAR):
```html
<tbody data-update-url="/purchase_orders/1782586/sort" class="sortable">
  <tr id="po_line_items_7698570">
    <td>1</td>
    <td><span data-title='ASUS Expertbook 15.6", i5,16GB, 512GB,W11Pro' class='tooltip-top'>
      <a href="/products/5201913/edit">Asus ExpertBook 15.6" i5 16GB</a>
    </span></td>
    <td>90NX0881-M00R50</td>          <!-- UPC -->
    <td>NBP1503CVAS70650X</td>         <!-- SKU -->
    <td>$1,499.00</td>                 <!-- retail -->
    <td>1 serialized</td>              <!-- order qty -->
    <td>$1,230.90</td>                 <!-- cost -->
    <td>$1,230.90</td>                 <!-- total -->
    <td>1</td>                         <!-- received qty -->
    ...
  </tr>
</tbody>
```
This confirms how PO line items reference products. The serial-history modal response is expected to contain the reverse (a reference back to a PO line / PO for a given serial), but its exact HTML is unverified — inspect it first.
