# S-ERP

ERP and point of sale for **restaurants, bars and retail stores**. It runs as a Windows desktop app (an `.exe` installer) and keeps its data in **MySQL**.

| Module | What it does |
|---|---|
| **Point of Sale** | Retail till (barcode scanning, quick checkout), restaurant (floor plan, tables, guests, kitchen tickets, split bill, move table), bar (named tabs). Payments by **cash, card, mobile money (M-Pesa, EcoCash…)** or customer account, with split payments, change, refunds, voids, receipts and Z-reports. |
| **Kitchen / bar display** | Live screen for kitchen and bar staff. Tap an item to move it from sent to preparing to ready, with a sound alert for new tickets. |
| **VAS plugins** | Sell airtime, data and prepaid electricity through plugins. Includes a no-code REST connector for aggregators such as **My Wallet**, and a sandbox for testing. Tokens print on the receipt. |
| **Mobile money push** | Payment plugins can send a payment request to the customer's phone and wait for approval. |
| **Inventory** | Stocked items with moving-average cost, stock counts and adjustments, reorder list, stock-move history and CSV import. |
| **Purchasing** | Purchase orders: confirm, receive (full or partial), then turn into a supplier bill. |
| **Invoicing** | Customer invoices and supplier bills, partial payments and aged receivables/payables. |
| **Accounting** | Full double-entry ledger. Every sale, refund, purchase, payment and VAS sale posts automatically. Includes chart of accounts, manual journals, expenses, P&L, balance sheet, trial balance and VAT report. |
| **Sales reconciliation** | Daily check of takings per payment method: what the system expects against what was actually received (cash counted, card settlement, mobile money statement). Shows variances, flags re-used mobile money references, and needs sign-off by a second person. Variances are posted to the ledger. |
| **CRM** | Customer 360 page with lifetime spend, visits, average ticket, balance owed, favourite items, 12-month spend chart and a full timeline. Logs notes, calls, visits and meetings, and tracks follow-up tasks with due dates and owners. Includes tags, birthdays, segment filters (top spenders, inactive for 30/60/90 days) and emailing customers. |
| **HR & Payroll** | Employees, departments, leave (balances and approvals), and monthly payroll with **Lesotho PAYE** (RSL 2025/26 and 2026/27 tables built in). Payroll covers pre-tax pension, allowances, once-off overtime and bonuses, pro-rata pay for joiners and leavers, payslips, PAYE returns and ledger posting. The module and PAYE can each be turned on or off. |
| **Receipt & pay-by-QR** | A QR code on every receipt opens a digital receipt on the customer's phone, with **Add to Samsung Wallet / Google Wallet** buttons. Bills for open tables and tabs, and customer invoices, carry **pay-by-QR** codes for M-Pesa or EcoCash. |
| **End-of-day reports** | An HTML report (plus CSV) emailed to the recipients you set, every day at a set time, when a cashier closes a session, or on demand. |
| **Users & roles** | Admin, manager, accountant, cashier, waiter, bartender and kitchen. Staff log in to the POS with a PIN. |

---

## 1. Installing

1. **Install MySQL 8** (or MariaDB 10.6+) on the main computer, or use an existing server. On Windows, the *MySQL Installer*, XAMPP or Laragon all work.
2. Run **`S-ERP-Setup-1.0.0.exe`** and follow the wizard.
3. On first start, enter the MySQL host, user, password and database name. The database and tables are created for you.
4. Set up the business: company name, VAT %, currency (default **M / LSL**, VAT 15%) and the admin account with a PIN. You can tick **demo data** to try it with sample products.

> Windows SmartScreen may warn about an unsigned app. Click *More info → Run anyway*, or buy a code-signing certificate (see §7).

### Several tills on one network

The PC running S-ERP is also a server on port **8069**.

* **Other Windows tills:** install the app and choose **"Use server"** on the first screen, entering `http://<main-pc-ip>:8069`.
* **Tablets or phones** (for example a waiter's tablet or the kitchen display): open `http://<main-pc-ip>:8069` in a browser.
* Allow port 8069 through the Windows firewall on the main PC.

Each till can also connect directly to a central MySQL server instead. The end-of-day email is sent only once even when several PCs share the database.

---

## 1a. One zip, built-in MySQL 8, 32-bit
- **S-ERP-<version>-Windows-64bit.zip** – unzip anywhere and run `S-ERP\S-ERP.exe` (or `Create shortcuts.cmd`). MySQL 8 is inside (`resources\mysql`): on first start choose **Use the built-in database**. It runs only while the app is open, listens on 127.0.0.1 (port 3307 or the next free one), keeps data in `%APPDATA%\S-ERP\mysql-data` and is backed up daily to `%APPDATA%\S-ERP\backups` (14 kept; *Back up now* in Settings → Updates & backup). Other tills connect to this PC's S-ERP (http://<this-pc>:8069), not to MySQL.
- **S-ERP-<version>-Windows-32bit.zip** – for 32-bit Windows. MySQL 8 has no 32-bit build, so this edition connects to a MySQL/MariaDB server or to the main S-ERP computer.
- Installers with the same contents: `S-ERP-Setup-<version>-x64.exe` / `-ia32.exe`.
- Build all of it: `npm run dist` (needs `vendor/mysql-win64` – the CI workflow downloads and trims MySQL 8.4 LTS automatically).

## 1b. Online updates from GitHub
1. Put the source on GitHub (run `publish-to-github.cmd`, or upload the folder on github.com). The workflow `.github/workflows/build-windows.yml` builds both editions and publishes a release **v<version>** whenever `package.json` has a new version.
2. Installed copies check `sepholokhabele-max/Maluti-ERP` by default (change it in **Settings → Updates & backup**), *Check for updates* → *Download & restart*. Normal updates only replace the program file (`app-<version>.asar`, a few MB, SHA-256 checked); when the Electron shell changes the full installer is downloaded instead. Private repositories need a read-only access token. Database changes run automatically at start-up.

## 1c. Setup guide
The first-time setup asks what kind of business this is (retail, butchery, restaurant, bar – tick all that apply) and then opens **🧭 Setup guide**: every step to get that business trading, in order – company details, VAT, payment methods, tills, staff PINs, categories, products, suppliers, opening stock, plus restaurant (floors, tables, kitchen tickets, waiters), bar (bottle weights, tots/glasses, bartenders, first bar count) and butchery steps (butchery mode, scale, starter cutting templates, prices & PLUs, barcode layout, first carcass, first breakdown, recipes). Each step explains why and what to enter, and opens the right screen; most tick themselves. Every setup input also has a yellow note explaining what is expected.

## 2. Daily use

* **Open a session** at the start of a shift and enter the cash float.
* **Retail:** scan barcodes (Enter adds the item), then press **Pay**.
* **Restaurant:** tap a table, enter the guests, add items with notes, then **Send order** (tickets go to the kitchen and bar screens). Pay when the guests leave.
* **Bar:** use **New tab** with the customer's name. Add rounds through the night, then pay.
* **Pay screen:** pick one or more methods. Cash shows the change. Mobile money needs a transaction reference. Card takes an approval code if you want one.
* **Close the session:** count the cash. The system shows over/short, posts it to the ledger and prints a Z-report.

Managers can give discounts, change prices, void and refund. Cashiers need a manager to log in for those.

---

## 2a. Sales reconciliation (Recon)

Do this each morning for the previous day, under **Recon**:

1. Open the day. **Expected** is everything the system recorded per payment method: POS and VAS sales, invoice payments and customer-account payments, less refunds. Sales charged to a customer account are left out because no money changed hands.
2. Enter **Actual** for each method:
   * **Cash:** the amount counted or banked. It is pre-filled from the counts at session close.
   * **Card:** the settlement batch total from the card machine or acquirer.
   * **Mobile money:** the day's total on the M-Pesa or EcoCash merchant statement.
3. Use **View** to see every transaction with its reference and phone number. You can tick lines off against the statement. References used more than once are highlighted in red.
4. **Submit for approval.** A *different* manager or accountant then **approves** it, or sends it back with a reason. Admins can approve their own.
5. Approval posts the variances to **6900 Cash Over/Short** against the method's account. Cash over/short already posted at session close is not posted twice.
6. An admin can **reopen** an approved day, which reverses the posting.

The dashboard warns when earlier days are not reconciled, and the EOD email shows the reconciliation status.

## 2b. CRM

* **CRM → Customers:** search; filter by tag or by "no visit in 30/60/90 days"; sort by spend, recency, orders or balance owed. Click a customer to open their 360 page.
* **Customer 360:** key figures, the pinned staff note, open follow-ups, quick logging (note, call, visit, meeting, SMS), a timeline of orders, invoices, payments and activities, favourite items, spend over the last 12 months and invoices. From here you can email the customer, receive a payment or start an invoice.
* **CRM → Activities:** your overdue, today's and upcoming follow-ups (or everyone's), plus birthdays this week. Tick an item to mark it done.
* Managers and accountants have CRM and Recon access. Cashiers and waiters do not.

---

## 2c. HR & Payroll (Lesotho PAYE)

* **Turning it on or off:** use **HR → Settings**. The *HR & Payroll module* switch hides or shows the whole module; no data is deleted. The *Deduct Lesotho PAYE* switch sets the default for new payroll runs. PAYE can also be switched off for a single run, or for one employee (on their record).
* **PAYE calculation:** monthly taxable income is taxed at 20% up to the band and 30% above it, then the non-refundable monthly tax credit is subtracted.
  * 2026/27 (from 1 Apr 2026): band M6,480 and credit M1,020.
  * 2025/26: band M6,170 and credit M970.
  * The table in force for each pay month is used automatically. When new rates are announced, add a new tax year with its effective date.
* **Pay items:** set up recurring allowances (taxable or not) and deductions on each employee. Mark contributions to an *approved pension fund or retirement annuity* as **pre-tax**, so they reduce taxable income.
* **Monthly run:** go to **HR → Payroll → Run payroll**. Add once-off overtime, bonuses or deductions, then **Approve & post**. This posts Dr 6200 Salaries, Cr 2200 PAYE Payable, 2210 Deductions Payable and 2300 Net Salaries. Next, **Mark salaries paid**, which credits bank, cash or mobile money depending on how each employee is paid. Payslips (with your logo) and a CSV export are available.
* **PAYE return:** the **HR → PAYE return** tab lists each employee's taxable income and PAYE. The payment is due to RSL by the 15th of the following month. Use **Record payment to RSL** to clear 2200.

## 2d. QR codes on receipts and bills

* **Receipt QR:** customers scan it to open their digital receipt, which they can save, print or add to their wallet.
  * Configure it under **Settings → POS → QR codes**.
  * By default the link uses this PC's Wi-Fi address, so phones on the shop Wi-Fi can open it (allow S-ERP through the Windows firewall when asked).
  * For customers to open receipts anywhere, and for Samsung or Google Wallet to work, publish the server on the internet (for example with a Cloudflare Tunnel) and enter that `https://` address as the *Public address*.
* **Wallet buttons:** these come from plugins (**Settings → Plugins**).
  * *Google Wallet* needs an Issuer ID and a service account key from the Google Pay & Wallet Console.
  * *Samsung Wallet* needs Samsung Wallet Partner Portal onboarding (Card ID, Certificate ID).
* **Pay-by-QR:** in **Settings → Payment methods**, paste the text from your M-Pesa or EcoCash merchant QR into *Pay-by-QR payload*. Placeholders such as `{amount}` and `{reference}` are filled in for each bill.
  * Use the POS **Print bill with pay-by-QR** button on open tables and tabs.
  * Printed customer invoices show the same codes for the amount due.
  * A payment plugin can also generate dynamic QR codes through a `paymentQr(config, { amount, reference })` hook.

---

## 2e. Butchery mode
Turn it on in **Butchery → Settings** (an administrator). It adds:

- **Weighing at the till** – products marked *Sold by weight* ask for kg at the POS, or read a serial (RS-232/USB) scale through the desktop app.
- **Scale barcode labels** – EAN-13 labels with price or weight embedded (default `2X PPPPP VVVVV C`). Scanning one charges exactly the printed price; a tampered price is refused.
- **Carcass breakdown** – cut a carcass or primal into retail cuts against a cutting template. Cost is shared by selling value. Bone and fat count as yield loss.
- **Carcass trace** – tick *Carcass / primal* on the product. When receiving, weigh each carcass and give it its tag, so every carcass becomes its own batch. *Butchery → Carcass trace* follows every kg through cuts, processing, sales, write-offs and bone/fat/drip loss until 100% is accounted for. It also shows sales against cost per carcass. Any batch can be traced forwards (*Where did it go?*) and backwards (*Made from*).
- **Sausage & processing** – recipes (meat, fat, casings, water/ice, soy/rusk binders, spices…) and production runs. Each ingredient is weighed (⚖ reads the scale). The ingredient batches are consumed and linked to the new batch. Each run shows meat content %, yield and cost per kg.
- **Any animal** – beef, pork, lamb/mutton, goat, chicken/poultry, game. *Cutting templates → Starter templates* creates the carcass product, cut products (with scale PLUs and shelf life) and typical yields per animal; set the prices and adjust the yields to your own results. Products carry an **Animal** field; cuts inherit it from the carcass when cut.
- **Live weight & dressing %** – when receiving carcasses, enter each animal's live weight to get its dressing % (carcass ÷ live). *Butchery → By animal* compares carcasses, dressing %, cutting yield, sales, margin and waste per animal.
- If a cut has no selling price yet, the carcass cost is shared by weight (with a warning) instead of by value.
- **Waste with reasons**, **batches & use-by dates** (first-expiry-first-out), and **pre-pack labels**.

A ⚖ button appears next to every weight field (breakdown, production, waste, receiving, labels) when a scale is enabled in settings.

## 2f. Bar – spirits & wine by measure
- On a bottle product, fill in the **Bar** section: bottle size (ml), empty weight with pourer (g), and full weight (g, optional; it sets the density).
- Create a product for each measure, e.g. *Gin tot 25 ml*, *Wine glass 175 ml*. Set its type to *Made to order*, then choose **poured from** the bottle and the ml. Selling a measure takes its ml off the bottle stock, costed as that share of the bottle. Refunds put it back.
- **Bar → Stock count**: count the full bottles, then put each open bottle on the scale. The system converts grams to ml left and compares the count with the system stock. Posting adjusts stock: shortages go to 5150, surpluses to 4950.
- **Bar → Pour check**: weigh the bottle before and after a pour to see over- or under-pours, and what each over-pour costs. Put any open bottle on the scale to see the ml and tots left.
- **Bar → Poured / sold**: ml and bottles used per spirit for any period.

## 2g. Sales, promotions, bank recon, expense claims, attendance (v1.7)
- **Sales → Quotations & orders**: new quotation (prices excl. VAT, discounts, promotions apply) → *Print / PDF* or *Email* → *Customer accepted* (becomes sales order SO/…) → *Create invoice* (stock leaves when the invoice is posted).
- **Promotions** (Sales → 🏷 Promotions): rules by product / category / everything, customers (everyone, a tag such as `wholesale`, one customer), minimum quantity, days, times (happy hour, also past midnight) and dates. Kinds: % off, amount off each, special price incl. VAT, multi-buy. The highest discount wins; rules don't stack. Manual discounts still need the *discount* permission.
- **Accounting → 🏦 Bank & M-Pesa recon**: import CSV (any column layout; day-first dates such as 04/11/2026 are understood), auto-match by amount, date (±5 days) and reference, *Create entry* for charges, interest, cash deposits, customer/supplier payments, then *Finish reconciliation*.
- **Expense claims** (tile): any staff member submits; managers/accountants approve (not their own), reject with a reason, and *Pay back*. Booked Dr expense (+ VAT input) / Cr 2250 Staff expense claims payable, then Dr 2250 / Cr cash or bank.
- **Approvals** (tile): pending claims, purchase orders above the limit (set on the same page), recons to sign off.
- **Attendance** (tile): clock in/out from the login screen (🕐) or the till (🕐). Managers correct shifts; overtime above 9 h a day or 45 h a week (Labour Code) at 1.25×; link employees to their login in HR to estimate overtime pay and add it to a draft payroll run.

## 3. Email end-of-day reports

Go to **Settings → Email & EOD reports** and fill in:

| Provider | SMTP host | Port | SSL |
|---|---|---|---|
| Gmail (use an *App password*) | smtp.gmail.com | 465 | ✓ |
| Outlook / Office 365 | smtp.office365.com | 587 | ✗ |
| Your hosting provider | mail.yourdomain.com | 465/587 | per provider |

Then add the recipients (comma separated), tick **Send automatically** and pick the time. Use **Send test email** to check the settings. The app must be running at that time on at least one PC.

The report covers sales, VAT, discounts, cost and gross profit, payments by method, sales by business type, category, product and staff, VAS sales and commission, cashier sessions with cash differences, open tabs and low stock.

---

## 4. VAS plugins (airtime, electricity, …) and My Wallet

Enable plugins under **Settings → Plugins**. Enabled VAS plugins add an **⚡ Airtime / Power** button to every till.

### Connecting My Wallet (or another aggregator) without code

Open **REST VAS Connector** → *Configure* and fill in the details from your provider's API documentation:

* **Base URL, auth type, API key / merchant ID.**
* **Services (JSON):** the services and networks you sell, for example:
  ```json
  [{"code":"airtime","name":"Airtime","providers":[{"code":"VCL","name":"Vodacom"},{"code":"ECONET","name":"Econet"}],"fixedAmounts":[5,10,20,50]},
   {"code":"electricity","name":"Prepaid electricity","providers":[{"code":"LEC","name":"LEC"}],"needsLookup":true,"recipientLabel":"Meter number"}]
  ```
* **Purchase path and body template.** Placeholders are filled in at sale time: `{{service}} {{provider}} {{recipient}} {{amount}} {{amount_cents}} {{reference}} {{merchant_id}} {{api_key}}`.
* **Response mapping:** the paths to the success flag, provider reference, token and message (for example `data.token`).
* **Optional** lookup (meter validation), status and balance endpoints.

**How a sale works:** the cashier takes payment, the provider is called, and only a successful sale is recorded. If the provider declines, nothing is charged.

**Accounting:** Dr cash/card/momo, Cr *VAS Float* (amount less commission), Cr *VAS Commission Income*. Record float top-ups you pay to the provider under **VAS → Record float top-up**.

### Writing your own plugin

Add a folder to the plugins folder (in the desktop app: *File → Open plugins folder*) that contains:

```
my-provider/
  plugin.json   { "id": "my-provider", "name": "...", "version": "1.0.0", "type": "vas", "config": [ {"key":"api_key","label":"API key","type":"text","secret":true} ] }
  index.js      module.exports = (ctx) => ({
                  async listServices(config) { return [{ code: 'airtime', name: 'Airtime', providers: [...] }]; },
                  async lookup(config, { service, recipient }) { return { ok: true, name: 'JOHN DOE' }; },          // optional
                  async purchase(config, { service, provider, recipient, amount, reference }) {
                    const r = await ctx.http('https://api.example.com/vend', { method: 'POST', headers: {...}, body: {...} });
                    return { status: 'success' | 'pending' | 'failed', provider_ref, token, message, commission };
                  },
                  async checkStatus(config, { provider_ref }) { ... },   // optional
                  async balance(config) { return { balance: 1234.5 }; }  // optional
                })
```

Then click **Reload plugins**. A plugin with `"type": "payment"` implements `requestPayment(config, { phone, amount, reference })` and `checkStatus(config, { provider_ref })`. Attach it to a mobile-money payment method under **Settings → Payment methods**. See `plugins/momo-sandbox` for an example.

---

## 4a. Smartel POS backend – MyWallet services through the adapter (v1.18)

S-ERP **never connects to the MyWallet core / core-banking API**. Everything that touches MyWallet goes through the
Smartel POS backend adapters: **pos-api** (`/v1/sessions`, `/v1/agent/ops`, `/v1/payments/intents`, `/v1/register/scope`,
`/v1/portal/bulk-batches`) and **syncd** (`/v1/sync/batches`, `/v1/sync/changes`, `/v1/sync/cursor`). While the Smartel
connection is on, the old direct "My Wallet" VAS set-up is refused.

**Set up** (Settings → Smartel connection): pos-api and syncd addresses, then per till the Smartel terminal ID, the till's
client certificate and key (mTLS at the gateway). "Trusted gateway" mode sends `X-Terminal-ID` itself – only for a gateway in
the shop or a test backend. *Test the connection*, switch on, *Get updates now*.

**At the till**
- **💸 Agent services**: cash deposit, withdrawal with the customer's SMS PIN, till cash-out, send-through, NPS Switch cash-in,
  voucher redeem, airtime, LEC electricity, bills. Check → (PIN) → confirm. The PIN goes straight to pos-api and is never stored.
  A service MyWallet does not answer is *unknown*: it is never sent again; the system keeps asking pos-api, which resolves it
  from MyWallet's history or hands it to operations after 10 minutes. The customer cannot be closed while a line is open.
- **One customer = one receipt**: goods, services and the goods tender together, with the **net cash** (BR-07). A
  services-only customer gets a non-fiscal `SVC/…` receipt.
- **Card, MyWallet and Switch** tenders are payment requests through pos-api (QR / card page on the customer's phone); the sale
  only completes when the request is PAID, and it must cover the whole bill. Other non-cash methods are refused on a Smartel till.
- **Offline**: goods for cash only; receipts are sealed and wait.
- **Recalls** block the product (or only the recalled lot – FEFO skips it) within one update and are acknowledged to Smartel.
  Barcodes not in the **National Product Register** are refused (or only warned) and a scan flag with the shop's location is sent.

**Sealed receipts**: every sale, services-only customer, delivery (GRN from purchase receiving), recall acknowledgement, scan
flag and heartbeat is an envelope `hash = sha256(prev | seq | body)` (first prev `GENESIS`) on that till's chain, pushed to
syncd oldest first. *Receipts sent* shows what was accepted, held or refused; *Check chain* re-verifies the chain locally.
A till whose chain Smartel rejects is held until Smartel support has fixed it.

**Books**: services are not sales (no VAT, no revenue). Service cash is booked against **2450 Agency cash clearing**;
commission **1160 / 4150**; card / MyWallet / Switch takings **1150 Digital takings due**; the business wallet **1170**.
*Agency cash & settlement* records what MyWallet paid out or what you moved.

**Updates from Smartel**: recalls (first), catalogue (links products by barcode, can add new ones), prices, and the daily
**Thoki** float line / stock advance.

**Wages by MyWallet**: from an approved payroll run, employees paid by *Mobile money* with a Lesotho number are sent as one
bulk batch from the business wallet; each paid line is booked (Dr 2300 / Cr 1170) and *Mark paid* leaves them out.

**Testing without Smartel**: `node server/test/mock-smartel.js 8790 <terminal-id>` runs a stand-in pos-api + syncd.

## 4b. Tax centre – VAT, PAYE, withholding, income tax and levies to RSL (v1.19)

**Tax centre** (home screen, accounting rights) lists everything due to Revenue Services Lesotho with its due date and status:
VAT monthly by the 20th, PAYE and withholding tax by the 15th, income tax instalments on 30 Sep, 31 Dec and 31 Mar with the
annual return by 30 Jun (for a March year-end), fringe benefit tax quarterly, and any other levy you add (plastic, gaming…).
Rates and due days are settings (defaults from rsl.org.ls, Nov 2026): VAT 15% (electricity 10%, exports and basic foods 0%);
income tax 25% (10% manufacturing and commercial farming); withholding 5% resident contractors, 10% non-resident contractors
and interest, 7.5% South African technical services. Published sources disagree on the fringe benefit tax rate – confirm it with RSL.

- **Prepare** works a return out from the books: VAT from the output / input VAT accounts with supplies and purchases by rate;
  PAYE from that month's payroll run; withholding from the withholding register; income tax instalments as thirds of the
  estimated tax (your estimate, last year's profit, or this year so far for 12 months); the annual return from profit before
  tax, add-backs, allowances and losses, less instalments and withholding tax certificates.
- **Filed with RSL** locks the figures and posts the closing entry (VAT 2100/1400 → 2110 payable or 1410 refund; income tax
  7100 → 2230; FBT 6470 → 2240; levies 6480 → 2250). An administrator can reopen a return that has no payments.
- **Pay**: by bank / EFT / M-Pesa / cash at RSL (recorded with the reference and any bank charge), or **through MyWallet** –
  a "pay a bill" service (biller `rsl`, your TIN as the account) on a till's open cashier session through the Smartel POS
  backend, never directly. MyWallet's fee is shown before you confirm and booked to 6450. Part payments are allowed.
- **Withholding tax**: record tax you withheld from a contractor (prints a certificate; owed to RSL by the 15th) or tax a customer
  withheld from you (a credit against income tax).

## 4c. Customer portal, web version and Android (v1.20)

**Customer portal** – *Settings → Customer portal*, then on a customer *🔗 Portal link*: a private link (with QR, SMS and
WhatsApp buttons) where the customer sees their balance, open invoices (printable) and a 6-month statement, in English or
Sesotho. They can **pay online** with MyWallet, card or Switch – a payment request through the Smartel POS backend on the
till you choose, never MyWallet directly; the money is put on their account (oldest invoices first) once it is confirmed – or
**upload proof** of a bank payment, which lands on the contact with a task for the office. *New link* switches an old link off.

**Web version (hosted)** – the same server without the desktop shell, in Docker:
```
cp .env.example .env      # set the passwords, PUBLIC_URL and MALUTI_SETUP_KEY
docker compose up -d                      # app + MySQL 8.4 on 127.0.0.1:8069
docker compose --profile https up -d      # optional: Caddy with automatic HTTPS for PUBLIC_DOMAIN
```
With `DB_HOST` set the database cannot be changed from the browser, and the first-run wizard asks for `MALUTI_SETUP_KEY`
so nobody else can claim a fresh server. `PUBLIC_URL` is used for portal / receipt links; `TRUST_PROXY` for the real client
address behind a proxy. Back up the `dbdata` volume (or use *Settings → Updates & backup*).

**Phones and tablets** – every screen adapts to a phone (the till stacks products above the cart). On Android or iPhone,
open the server address in the browser and choose *Install app* (it is a PWA: icon, full screen, quick start; money and stock
always come live from the server). The **Android app** (`mobile/`, Capacitor) is built by `.github/workflows/build-android.yml`
and attached to each release as `S-ERP-<version>.apk`; on first start it asks for the server address (the shop PC on the
Wi-Fi, e.g. `192.168.1.20:8069`, or the hosted address). See `mobile/README.md` for signed builds.

## 4d. Sesotho (v1.21)

Choose **ST** in the top bar: the help notes, setup guide and every screen text with a translation switch to Sesotho
(`public/js/sesotho_ui.js`, swapped at runtime by `public/js/i18n_dom.js`). **EN + ST** keeps English screens with
Sesotho help underneath. **Settings → Translations** lets a native speaker correct words or fill in missing ones (saved in the
database, applied to everyone at once; CSV export / import). Documents for customers and RSL stay in English.

## 5. Accounting

| Code | Account | Code | Account |
|---|---|---|---|
| 1000 | Cash on hand | 2000 | Accounts payable |
| 1010 | Card clearing | 2050 | Goods received not invoiced |
| 1020 | Mobile money wallet | 2100 | VAT output |
| 1050 | Bank | 3000 | Owner's equity |
| 1100 | Accounts receivable | 4000 | Sales |
| 1200 | Inventory | 4100 | VAS commission |
| 1300 | VAS float | 4900 | Sales returns |
| 1400 | VAT input | 5000 | Cost of goods sold |
| | | 6000–6900 | Expenses, cash over/short |

You can add accounts at any time. Every posting is balanced, and the automated test suite checks that the trial balance and balance sheet always balance.

---

## 6. Running from source / headless server

```bash
npm install
npm start                      # desktop app (Electron)
# or a headless server for Linux/Windows Server:
DB_HOST=localhost DB_USER=root DB_PASSWORD=secret DB_NAME=maluti_erp PORT=8069 npm run server
# end-to-end API test (needs a MySQL server):
DB_HOST=localhost DB_USER=root DB_PASSWORD=secret npm test
```

## 7. Building the Windows installer

* **On Windows:** install NSIS (`choco install nsis`), then run `npm install` and `npm run dist`. This builds the app with electron-builder and packages it with the plain NSIS script in `build/installer.nsi`. The installer installs per user without admin rights, offers to close a running copy before upgrading, and writes a log to `%TEMP%\S-ERP-Setup.log`. The output is `dist/S-ERP-Setup-<version>.exe`.
* **With GitHub:** push this folder to a GitHub repository. The workflow in `.github/workflows/build-windows.yml` tests against MySQL 8, builds the installer on Windows, and attaches it to a release when you push a tag such as `v1.0.1`.
* **Code signing (optional):** set `CSC_LINK` and `CSC_KEY_PASSWORD` to remove the SmartScreen warning.

Desktop data such as the connection settings, log file and user plugins is stored in `%APPDATA%\S-ERP`.

## 8. Not included yet (roadmap)

Multi-warehouse and lot/serial tracking, recipes/bill of materials for menu items, loyalty points, ESC/POS raw printing and cash-drawer kick (receipts currently print through the Windows printer driver), bank reconciliation, multi-currency, payroll, and an e-commerce connector.
