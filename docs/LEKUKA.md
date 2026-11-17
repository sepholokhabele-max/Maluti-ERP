# RSL Lekuka e-invoicing in S-ERP

S-ERP connects to Revenue Services Lesotho's Lekuka system. This follows the Value Added Tax (E-Invoicing) Regulations, 2026 (Legal Notice No. 25 of 2026, in force from 1 April 2026) and the E-Invoicing Gateway API specification v1.16. Each S-ERP installation is one **device** (an Electronic Billing System, EBS, in the Regulations).

## What the merchant does

1. **Request a device.** In S-ERP, open *Lekuka e-invoicing → Overview* to see the device serial number and the device model and version. Use these to request a device on the RSL self-service portal.
2. **Note the credentials.** RSL issues a **Device ID** and an 8-character **activation key**.
3. **Register.** In *Lekuka → Register*:
   - choose the mode: Demo, RSL test environment, or Live;
   - press *Check the taxpayer* (verifyTaxpayerInformation);
   - press *Register the device*. S-ERP makes its own ECC P-256 key, sends a certificate request (CSR) and stores the certificate (registerDevice), then loads the configuration and taxes (getConfig).
4. **Sell as usual.** Till receipts, customer invoices, refunds and cancelled invoices carry the Lekuka block: invoice number (counter/global), fiscal period, device serial and ID, the QR code and the verification code.

## What S-ERP does

- **Numbering and signing.** Inside the same database transaction as the sale, S-ERP numbers the document: the receipt counter per fiscal day and the global number. It then hashes it into the receipt chain and signs it, so there are no gaps in the numbering.
- **Sending in order.** A sender submits documents strictly in order, every minute and right after each sale:
  - openDay first (sent late if the device was offline);
  - then submitReceipt for each document;
  - then closeDay with the counters (Z report), after which it polls getStatus.
- **Closing the fiscal day.** The day closes when the manager presses *Close fiscal day*, at the configured time (default 23:50), and always before the maximum day length (taxPayerDayMaxHrs).
- **Offline devices.** For devices in Offline mode, the closed day is sent as a file (submitFile and getFileStatus). The same file can be downloaded under *Fiscal days* for manual upload on the self-service portal.
- **Upkeep.** S-ERP pings Lekuka at the reporting frequency and renews the certificate a month before it expires.
- **TIN check.** `verifyByTin` is available for checking a customer's TIN.

## Which documents become which Lekuka document

| S-ERP document | Lekuka document |
|---|---|
| Till sale | Receipt (with buyer data when the customer has a TIN) |
| Customer invoice to a customer with a TIN | FiscalInvoice with buyer data |
| Customer invoice to a customer without a TIN | Receipt |
| Till refund | CreditNote referring to the original sale; the refund reason becomes receiptNotes |
| Cancelled posted invoice | CreditNote for the full amount |

Water bills, rooms, hire, clinic, school and contract invoices all go through the same customer-invoice posting, so they are covered too.

- **Not reported:** airtime and electricity sold for third parties (VAS) are left out of the fiscal receipt.
- **Taxes:** each item's VAT rate is matched to the taxes RSL returns.
  - Items with 0% VAT are sent as zero-rated by default; this can be changed to exempt.
  - A non-VAT taxpayer's items use the NonVAT tax.
  - A VAT rate RSL does not have stops the sale with a clear message.
- **Payments:** each payment method is mapped to an RSL money type: Cash, Card, MobileWallet, Credit (on account), Coupon (voucher) or BankTransfer.

## Modes

| Mode | Where | Notes |
|---|---|---|
| Demo | A practice Lekuka built into S-ERP | Any device ID and 8-character key. Validates like RSL (colours, signatures, counters). Receipts are marked "DEMO – NOT SENT TO RSL". |
| Test | `https://lekukaapi.rsl.org.ls:8443` | Mutual TLS with the device certificate. Use this for UAT with RSL. |
| Live | `https://lekukaapi.rsl.org.ls` | Only allowed once S-ERP is accredited (see below). |

## Accreditation (Smartel Money)

Regulations 7, 8 and 13(8) require the manufacturer and supplier and the EBS model to be accredited. Supplying a non-accredited EBS is an offence (Schedule V). S-ERP therefore refuses Live mode until Smartel Money sets these on the server:

- `MALUTI_LEKUKA_MODEL_NAME`: the device model name registered at RSL (default `S-ERP`).
- `MALUTI_LEKUKA_MODEL_VERSION`: the model version registered at RSL (default `1.0`).
- `MALUTI_LEKUKA_ACCREDITED=1`: set once RSL confirms accreditation.

## Points to confirm with RSL during UAT

1. **HTTP methods.** The specification does not state the HTTP method for each endpoint. S-ERP uses POST for actions and GET for GetConfig, GetStatus, GetServerCertificate and SubmittedFileList (all in one table in `server/services/lekuka/client.js`). Check these against the Swagger page.
2. **Signature examples.**
   - Two of the receipt-hash examples in section 13.2.1 reproduce exactly (FiscalInvoice example 3 and CreditNote example 2).
   - The others print the same concatenated string but a different hash, so the document's printed hashes appear inconsistent.
   - The fiscal-day example in 13.3.1 mixes "15" and "15.00" and the CASH/CARD order. S-ERP follows the written rules: two decimals, and money types in enum order.
   - Test case TC-025 (closeDay) will confirm this.
3. **Signature format.** S-ERP signs with ECDSA P-256 over SHA-256 (DER signature, base64). RSA 2048 is also supported by the code path if RSL prefers it.
4. **Not yet generated by S-ERP:**
   - levies (tobacco, alcohol, plastic; TC-016 to TC-019);
   - Payout and DebitNote documents (TC-020, TC-022);
   - lay-by (TC-021).
   The data model and signatures support them; the item set-up does not yet.
5. **Buyer data.** Till sales above `thresholdForMandatoryBuyerData` without a customer TIN will be flagged red by RSL. Train cashiers to choose the customer.

## Files

- `server/services/lekuka/index.js`: registration, document building, issuing, sending, fiscal days, offline files.
- `sign.js`: hashes, signatures, QR codes and verification codes (section 11 and 13).
- `pki.js`: keys, CSR (PKCS #10), certificates (demo CA).
- `client.js`: endpoints and HTTPS with mutual TLS.
- `simulator.js`: practice Lekuka.
- `mock.js`: HTTPS stand-in for tests.
- `server/routes/lekuka.js`: the API.
- `public/js/lekukaui.js`: the screen.
- `public/js/fiscal.js`: the printed block.
