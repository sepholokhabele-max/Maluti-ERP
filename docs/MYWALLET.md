# My Wallet payments at the till (S-ERP 1.29)

S-ERP takes payments from My Wallet customers, and from customers of the other wallets on the national payment switch,
through the **My Wallet API v4** POS endpoints. This is the link between S-ERP and the v4 endpoints added to the My Wallet API
(`docs/API_V4.md` in the My Wallet API).

## How it fits together

```
Till (browser) ──► S-ERP server ──signed HTTPS──► My Wallet API v4 ──► customer's My Wallet app
                    (holds the key)                 /api/v4/pos/*          (approves with PIN)
                                                    /api/v4/merchant/activate
                                                         │
                                                         └──► national payment switch (M-Pesa, EcoCash, C-Pay, Khetsi)
```

- **No key in the browser:** the till never talks to My Wallet. It asks the S-ERP server, which signs each call with the shop's merchant key.
- **Signature:** HMAC-SHA256 over the timestamp, a single-use nonce, the method, the path and the SHA-256 of the body.
- **One key per installation:** the key secret is kept in the S-ERP database (setting `mywallet`). It is never returned to a browser and never logged.
- **Public API only:** only the public v4 endpoints are used. S-ERP still never touches My Wallet's core banking.

## Linking the shop

Go to *Settings → My Wallet payments*:

1. Enter the My Wallet address (for example `https://api.mywallet.co.ls`). You can also set it for every installation with `MALUTI_MYWALLET_API_URL`.
2. Enter the agent number and password, then press *Link and switch on*.
   - The agent number can be the till number (`1` + agent id, for example `100045`) or the agent's cell number.

S-ERP calls `POST /api/v4/merchant/activate` with the agent number, the password and the installation ID. My Wallet then:

- checks the agent, using the same PIN rules and lock as the app;
- issues a key for this installation, replacing any earlier key for the same installation;
- writes a message to the agent's inbox.

The same step runs when the owner activates S-ERP under *Settings → Activation*, or in the set-up wizard, while a My Wallet address is set. Without an address, activation stays local as in 1.28.

Keys can also be entered by hand: *Key id* and *Key secret*, from `php artisan v4:merchant-key <till>` on the My Wallet server.

**Demo mode** uses a built-in simulator, where the cashier presses *Simulate: customer approves*. Nothing leaves the computer.

## At the till

1. Choose **My Wallet** or **Other wallet (M-Pesa, EcoCash…)** on the payment screen. If the default cash line has not been touched, it makes room.
2. Press **Ask customer to pay**.
   - For My Wallet, the customer's number is optional; with it, they get the request on their phone.
   - For other wallets, choose the customer's wallet.
3. The till shows the QR code (`MWPAY:<code>`) and the short code.
   - The customer scans or types the code in the My Wallet app and approves with their PIN.
   - A customer of another wallet sends the amount to the shop's My Wallet number with the code as the reference.
4. When the line shows **paid**, press **Validate**. My Wallet can be combined with cash, with change.

The server checks it again when the sale is saved. The My Wallet payment must be:

- **PAID** at My Wallet;
- for exactly the amount of the payment line;
- made for the same payment method;
- not already used for another sale.

The sale's payment reference becomes `MW <code>`.

Closing the waiting window or pressing *Cancel the request* cancels the request at My Wallet. Requests that are still pending are checked every minute, and they expire after the set time (300 seconds by default).

## Refunds

Refund the sale at the till with **My Wallet** as the refund method. It is chosen by default when the sale was paid that way.

- **Where the money goes:**
  - My Wallet payments go back to the customer's wallet at once.
  - Payments from other wallets go back through the switch. They may show as pending until the switch confirms.
- **Last step:** the refund is sent to My Wallet as the last step of the refund. If My Wallet refuses it, the refund is undone in S-ERP too. The commonest reason is that the shop's My Wallet account is short, because the merchant fee is not returned.
- **No double refunds:** each refund carries its own idempotency key, so a retry never refunds twice.

## Accounting

- **The sale:** My Wallet takings are booked to **1150 – Digital takings due from MyWallet**.
- **The payout:** when My Wallet pays the money out, record it on the Smartel connection page with *Settle → digital takings*. The difference is the merchant fee.
- **Checks on the *My Wallet payments* screen:**
  - the amount due;
  - approved payments that never became a sale. These need a refund in My Wallet, or the sale needs finishing.

## Tables

| Table | Contents |
|---|---|
| `mywallet_payments` | One row per payment request: mode, channel, amount, code, My Wallet id and reference, status, order |
| `mywallet_refunds` | Each refund sent to My Wallet, with its refund order and status |

Both tables are created by migration 33.

## Tests

- **Smoke test (`server/test/smoke.js`):** covers demo, and live against `server/test/mock-mywallet.js`. The mock checks signatures exactly as the v4 middleware does.
- **Browser test:** `server/test/ui/ui36.js`.
- **Cross-check against the real My Wallet v4 server (PHP), passed on 17 Nov 2026:**
  1. activation checked by My Wallet;
  2. signed test call;
  3. payment request;
  4. the customer sees the request in the app and approves it;
  5. S-ERP sees PAID;
  6. sale;
  7. refund back to the wallet;
  8. cancel.
