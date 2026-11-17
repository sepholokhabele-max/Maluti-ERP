## S-ERP 1.29.0

**My Wallet payments at the till (My Wallet API v4).**

- **Two new ways to pay:** *My Wallet* and *Other wallet (M-Pesa, EcoCash…)*.
  - The cashier presses *Ask customer to pay* and can type the customer's number, so the request also appears on their phone.
  - The till shows a QR code and a short code. The customer approves in the My Wallet app with their PIN.
  - Customers of other wallets send the money through the national payment switch with the code as the reference.
  - The till sees the payment arrive and only then can the sale be finished.
- **Checked again on the server:** a sale only accepts a My Wallet payment that was approved, for exactly that amount and method, and only once.
- **Split payments:** My Wallet can be combined with cash, with change.
- **Refunds** chosen as *My Wallet* go back the way the money came: to the customer's wallet, or through the switch.
  - The refund is sent as the last step, so if My Wallet refuses, nothing is refunded in S-ERP either.
  - The refund screen picks My Wallet by default when the sale was paid that way.
- **Linking the shop:** activation with the My Wallet agent number and password is now checked by My Wallet itself when a My Wallet address is set (*Settings → My Wallet payments*, or `MALUTI_MYWALLET_API_URL`).
  - My Wallet returns this installation's own payment key. Nobody copies keys by hand.
  - Without an address the check stays local, as in 1.28.
- **Security:** every call to My Wallet is signed (HMAC-SHA256 with a timestamp and a single-use nonce) and carries an idempotency key, so a retry never charges or refunds twice.
  - The key secret stays on the S-ERP server; tills and browsers never see it.
  - Only My Wallet's public v4 POS endpoints are used, never core banking.
- **Demo mode:** a built-in simulator where the cashier can play the customer (approve or decline). Nothing leaves the computer.
- ***My Wallet payments* screen:**
  - status, linking, options;
  - takings today and the amount due from My Wallet (account 1150);
  - approved payments that never became a sale;
  - recent requests with their sale.
- **Background check:** pending requests are refreshed every minute.
- **Tested:**
  - smoke tests for demo and live (against a stand-in that checks signatures the way My Wallet does);
  - browser test ui36;
  - a cross-check against the real My Wallet v4 server: link, customer approves in the app, sale, refund back to the wallet, cancel.

## S-ERP 1.28.0

**RSL Lekuka e-invoicing (VAT E-Invoicing Regulations, 2026).**

- **Register:** register S-ERP as a Lekuka device with the Device ID and activation key from RSL.
  - S-ERP checks the taxpayer, makes its own ECC key, sends a certificate request and keeps the certificate.
  - It then loads the taxes and settings from RSL.
- **Every document is reported:** till sales, customer invoices (including water bills, rooms, hire, clinic, school and contracts), till refunds and cancelled invoices.
  - They are numbered (receipt counter per fiscal day and global number) and signed in a chain, in the same transaction as the sale, so there are never gaps.
  - Receipts and A4 invoices print the Lekuka block: TIN and VAT No, invoice No, fiscal period, device serial and ID, QR code and verification code.
  - Refunds and cancellations become credit notes referring to the original.
  - Customers with a TIN get fiscal invoices with buyer data. Each customer's TIN can be checked with RSL.
- **Sent strictly in order:** open day, receipts, close day with the signed Z report (counters).
  - Without internet, selling goes on and documents catch up when the connection returns.
  - The fiscal day closes on request, at a set time, and always before RSL's maximum length.
  - Offline-mode devices send each day as a file, which can also be downloaded for the self-service portal.
  - Pings and certificate renewal are automatic.
- **Three modes:**
  - **Demo:** a practice Lekuka inside S-ERP that validates like RSL. Nothing is sent.
  - **RSL test environment:** mutual TLS.
  - **Live:** only once S-ERP's accreditation is confirmed (Regulations 7, 8 and 13(8)).
- **Lekuka screen:** status, documents and RSL's remarks (green / yellow / red), fiscal days, options and taxes. There is also a link from the Tax centre.
- **Checked against RSL's examples:** signatures match RSL's published hash examples; see `docs/LEKUKA.md` for the points to confirm in UAT.

**Activation with a My Wallet agent number and password.**

- The set-up wizard asks for the business's My Wallet agent number and password. S-ERP is then activated for good: no 30-day trial, no activation codes, no expiry dates.
- The owner can sign in with the agent number and password.
- "Just try it first" starts in demo mode with practice data, with no time limit.
- For now the agent number and password are checked by S-ERP itself and kept only as a one-way hash. The live check with My Wallet will come through the Smartel adapter.
- Installations activated with a code stay activated, and their end dates no longer apply.
- Businesses that are not yet My Wallet agents can still send their application with KYC documents to My Wallet.

## S-ERP 1.27.0

**Two ways to run S-ERP, and signing in from anywhere.**

- **Option 1 – Office server (desktop app):** tick *This computer is the office server* in *Settings → Access & security*. S-ERP then starts with Windows, keeps running in the tray when the window is closed, and shows the addresses other computers use. Built-in database with daily backups.
- **Option 2 – Server edition:**
  - On Windows Server: Start menu → *S-ERP → Server edition → Install S-ERP Server*. It runs as a background task that starts with Windows, needs no one signed in, restarts itself, opens the firewall and keeps its data and log in `%ProgramData%\Maluti ERP`.
  - Built-in HTTPS with your certificate (.pfx or .pem), with plain http redirected to https.
  - Uses the built-in database (30 days of backups) or your own MySQL. On Linux or the cloud it runs with Docker and Caddy.
- **Working from anywhere:**
  - S-ERP recognises the office network. Anyone coming through a VPN, a secure tunnel, a proxy or the internet counts as "away from the office".
  - **Two-step sign-in** with an authenticator app: set up by scanning a QR code at the first sign-in. Required by default for managers, accountants and auditors away from the office; can be required for everyone, or always.
  - Choose who may sign in from outside: everyone, chosen roles, or nobody.
  - Away from the office there is no PIN sign-in and no staff list, sessions are shorter, and idle sessions are signed out.
  - Accounts are locked for a while after repeated wrong passwords.
  - **My account:** change password, switch two-step sign-in on or off, see where you are signed in and sign other devices out.
  - **Administrators:** a checklist of what to finish before staff work from outside, every active session (who, where, device, how) with sign-out, and reset two-step sign-in for a lost phone.
  - First-run set-up only runs from the office network or with the set-up key. Security headers are added to every page.
- **Guide:** `docs/DEPLOYMENT.md` explains which option suits which kind of organisation and how to open S-ERP to staff outside the office safely.

## S-ERP 1.26.0

**Organisation & governance – the organogram decides who approves what.**

- **Organogram:** units (board, executive, departments, sections, committees) and positions with reporting lines, holders, employee records, grades and acting appointments (always with an end date). Shown as an interactive chart that exports to PDF / Word. Start from a standard or water-utility structure.
- **Delegation of authority:** a matrix of positions × documents with approval limits and "must agree first" (concurrence) rights. It now drives approvals in every module:
  - purchase orders, expense claims, manual journals, payroll runs, leave (in days), approval to procure, procurement waivers, contract awards, budgets, asset disposals and write-offs, policies and legal documents.
  - The approver is the first manager up the requester's reporting line with enough authority; concurring positions (e.g. Finance) sign first.
  - Nobody approves their own request; a person acting in a position signs for it; requests waiting longer than the unit's escalation period appear for the next level up.
  - The organogram overrides role permissions: a supervisor with a plain staff login can approve what the DoA gives them, and a manager outside the line cannot.
  - Document types with no authorities defined keep the module's previous approval rules.
- **Approvals inbox:** everything routed to a person from any module, with the full approval path; an "Approvals (n)" tile appears on their home screen. "Who approves?" simulator and a full approval history for audit.
- **Decision rights (RACI)** and **communication:** for every position – who it reports to, direct reports, peers, escalation path, communication style, channels and meetings. Every user gets a "My role" page.

**Policies.**

- 29 editable templates across governance & ethics, finance, procurement, human resources, IT, operations / health & safety and customer service (including water disconnection and billing).
- The Delegation of Authority policy is filled from the live organogram. Drafts and numbered versions; approval through the DoA; "read and acknowledge" tracking with an unread-policies tile.

**Legal.**

- 17 Lesotho document templates (employment contract under the Labour Act, 2024; NDA; supply, service-level and consultancy agreements; lease; loan; letter of demand; warning, hearing and termination letters; board resolution; power of attorney; MOU; contract from a tender award; water connection agreement; privacy notice).
- Documents are filled from S-ERP records; missing details are highlighted. They can be edited in the browser and exported to Word / PDF.
- "Legal document" buttons on employee, water account and awarded tender pages.
- Contract register: approval by contract value through the DoA, signing freezes the text, renewal / expiry alerts, renew and terminate.
- Compliance register: statutory obligations (Companies Act, licensing, tax, workmen's compensation, data protection, LEWA) with recurring due dates.
- Every template carries a notice to have it reviewed by a Lesotho legal practitioner. Figures not confirmed in the law are left for you to fill in.

## S-ERP 1.25.0

**Finance centre – Sage-level general ledger.**

- **Chart of accounts:** each account sits in its place in the financial statements (current / non-current assets and liabilities, equity, revenue, cost of sales, other income, operating expenses, finance costs, tax) and in the cash flow statement. Control accounts (debtors, creditors, stock, VAT, payroll) can only be changed by their own documents. Accounts with a balance cannot be made inactive.
- **Cost centres:** departments, projects, branches and funds on every journal line, with reports per cost centre.
- **Journals:** numbered, saved as drafts, approved by a second person above your limit, reversed automatically on a chosen date (accruals and prepayments) and recurring (monthly, quarterly, yearly). A posted entry is never edited or deleted – it is reversed.
- **Periods:** lock the books up to a date. Year-end closes income and expenses to retained earnings, and a year can be reopened by an administrator (by reversal). There is also a month-end close checklist covering bank recs, depreciation, journals, tills, VAT, payroll, the trial balance and the lock.
- **Reports:**
  - trial balance with opening, movement and closing balances;
  - general ledger with running balance and drill-down to every entry;
  - classified income statement against last year, the prior period or the budget, and month by month;
  - classified balance sheet with comparatives;
  - cash flow statement (indirect method), checked against the movement in cash;
  - financial ratios (liquidity, margins, debtor / creditor / stock days, gearing).
  - Every report exports to PDF, Word and Excel.
- **Budgets:** per account, month and cost centre. A budget can be started from last year's actuals plus a %, and is approved by a second person.

**Audit.**

- **Tamper-evident ledger:** every journal entry is sealed into a SHA-256 hash chain; any later change to an entry or its lines is detected.
- **Integrity checks:** unbalanced or empty entries, and postings to inactive accounts.
- **Control account reconciliations:** debtors and creditors per customer / supplier, stock, fixed assets.
- **Exception reports:** manual journals to control accounts, back-dated, after-hours and round-amount journals, large self-posted journals, possible duplicate supplier bills, suppliers sharing details with staff, large cash payments, refunds and voids by cashier, invoice number gaps, failed logins. Plus Benford's law analysis.
- **Audit trail:** every change made by anyone, and login history.
- **Audit queries:** raised on an entry and answered by staff.
- **Audit pack:** the year-end pack for the external auditors, with every schedule, in one Excel workbook.
- **Roles:** a read-only external auditor role.

**Internal audit.**

- Audit universe with risk scores, and a risk-based annual plan.
- Engagements with standard work programmes: cash, procurement, payroll, inventory, revenue, journals, fixed assets, IT, water billing, fleet. Steps are linked to the data tests, so evidence comes straight from the books.
- Independent review.
- Findings written as condition / criteria / cause / effect / recommendation with a risk rating, management responses and action plans.
- Action owners update their own actions; internal audit verifies them.
- Audit committee dashboard, and a full engagement report exported to PDF, Word and Excel.
- An internal auditor role, independent of management.

### Also in 1.24.0

**New module: e-Procurement – tenders, RFQs and waivers, with nationality and gender scorecards.**

- Methods: open tender (with a public tender page where suppliers register themselves), restricted tender, request for quotations and waiver (direct procurement) – with your thresholds, e.g. no RFQ above M 1 000 000.
- Supplier register: registration, tax clearance and trader's licence with expiry alerts, and ownership – Basotho citizen %, women %, youth %, disability, business size. Suppliers can be suspended or debarred.
- Each step is approved and recorded: approval to procure (not by the person who prepared it), invitations, online sealed bids on each supplier's private page (prices hidden until opening, each bid fingerprinted), questions and addenda, closing time enforced, bid opening with at least two committee members, conflict-of-interest declarations before scoring, committee scoring, evaluation, recommendation, award approval (not by the recommender or a committee member), standstill period with challenges, contract as a purchase order, supplier rating. A full audit trail and a printable evaluation report.
- Scoring: technical + price + preference points adding to 100 (e.g. 80/20, 90/10, or 70/20/10 quality-and-cost). Preference points come from the ownership scorecard (citizen, women, youth, disability, SMME), with the shares set in Settings.
- Scorecards: spend by citizen / joint / foreign ownership, women-, youth- and disability-owned and SMME suppliers, by district and by procurement method, the share of awards made through waivers, savings against estimates and days from approval to award. Plus a waiver register and a list of expiring supplier documents.

**New module: Asset register.**

- Asset categories with their accounts and depreciation rules (straight line or reducing balance, useful life, residual value). Assets can be bought for cash, bought on account, already on a supplier bill, brought in with depreciation to date, or donated.
- Monthly depreciation posted to the books (missed months are caught up). Moves between locations and custodians are recorded. Physical asset counts with QR labels. Disposal or write-off with the gain or loss booked.
- The cost and depreciation roll-forward for the annual financial statements, plus warranty and insurance alerts.

**Fleet management, upgraded.**

- Service schedules by km and months, with service and repair records posted to the books. Driver licence and PrDP expiry. One "Due & alerts" list for services, papers and licences.
- Staff ask for a pool vehicle; the fleet office approves only vehicles that are free and have enough seats (no double booking). Keys handed over and returned with the odometer.
- Fines, accidents and insurance claims. Cost per km including depreciation from the asset register, and fuel efficiency against the expected km per litre (warns at below 80%).

**Kind of organisation.**

- The first-run wizard and Settings → Company ask what kind of organisation it is: informal trader, sole trader, partnership, private company, public company / corporate, parastatal, government body, NGO, cooperative or trust.
- The tax centre follows it: company tax, personal tax, or no income tax for government and exempt NGOs.
- The KYC documents follow it: an informal trader is not asked for a registration certificate.
- Parastatals and government bodies get e-Procurement, the asset register and fleet switched on.

### Also in 1.23.0

**New module: Water utility – prepaid and postpaid water in one place.**

- **Connections**: every customer gets a water account with a meter, a tariff, a zone and prepaid or postpaid billing. New connections, meter installs and replacements, disconnections and reconnections are field jobs; the connection and reconnection fees are invoiced automatically and store materials used come off stock.
- **Tariffs**: stepped (block) prices per m³ with a cheap lifeline block, a monthly service charge, sewerage as a % of water, a minimum charge and VAT – with a calculator to try them.
- **Postpaid**: a meter reading sheet that works on a phone (or printed), checks for readings that go backwards, very high or zero use, estimated bills when a meter could not be read, one-click monthly billing that makes ordinary customer invoices, and printable bills with a usage chart.
- **Prepaid**: sell water at the office or from any POS till (💧 Water button). Old debt is recovered with a % of every purchase, the monthly service charge comes off the first purchase, and the rest is turned into m³ at the tariff. Tokens come from your STS vending server through a plugin (TEST tokens for training).
- **Money**: bill payments at the till land in the cash-up, deposits are held on their own account (2430) and pay the final bill when an account is closed. New accounts: 4870 Water sales, 4875 Service & sewer charges, 4876 Connection & reconnection fees, 5500 Network materials used.
- **Collections**: a disconnection list by your own rules, "Water bills" in payment reminders (SMS / WhatsApp / email), and the customer link now shows water use and the last tokens.
- **Water loss**: type each zone's bulk meter and see how much water was not billed or sold (non-revenue water).
- **WASCO tariffs in one click** (Water utility → Tariffs → Load WASCO tariffs): domestic bands A–D (M6.11 / 10.39 / 18.29 / 25.24 per kl), business & industry, government, schools, churches and standpipes with their standing charges; no standing charge while a domestic customer stays in band A; sewerage M9.85 per kl on 85% (waterborne) or 65% (non-waterborne) of the water used – choose the sewer type on each connection; VAT 15% by default (changeable per tariff).
- **Meter readers**: a new "meterreader" role that only sees the reading sheet and their jobs. Water utility is a new business type with setup-guide steps, help notes in English and Sesotho, and an importer for existing water customers.

**New module: Payment partners – let M-Pesa, EcoCash, banks, agents and shops collect for you.**

- Add a partner, give their developers a test key and the built-in API guide; when they are ready, "Go live" gives them a live key.
- The collections API (/api/collect/v1): look up an account (water account, meter number or invoice number) and show the customer's name and amount due; send a payment and get back the receipt – or the prepaid water token; ask about a payment; download the day's transactions for reconciliation.
- Safe by design: keys are stored only as fingerprints, a test key can never move real money, every payment carries the partner's own reference and is never recorded twice, optional IP allow-list, per-partner limits and the kinds of payment allowed, suspend at any time, and a log of every call.
- Money they collect is owed to you (1180 Collections due from payment partners) until they pay it over; "Record settlement" puts it in the bank and books their commission (6420).

### Also in 1.22.0

**Maluti ERP is now S-ERP, by Smartel Money.**

- The new name is on every screen, the login page, emails, the installer, desktop and Start-menu shortcuts, the phone app and the help notes (English and Sesotho).
- Nothing else changes: your data, logins, activation code, settings and updates carry on exactly as before. The old "Maluti ERP" shortcuts are replaced by "S-ERP" ones when the update installs.

### Also in 1.21.1


**Fix: three account codes were shared by two modules.**

- Levies filed in the Tax centre were posted to the same account as staff expense claims (2250). Levies now have their own account **2260 Other taxes & levies payable (RSL)**.
- Hire income shared 4900 with *Sales returns & refunds*; it now has **4880 Hire income**.
- Clinic consultation fees shared 4950 with *Stock count gains*; they now have **4960 Medical & consultation fees**.
- Entries already posted are moved to the right account automatically when the update starts; nothing has to be re-entered. Reports for past months now show these amounts on the correct lines.

### Also in 1.21.0

**The whole program in Sesotho, a translation review screen, and fewer ways to lose work.**

- **Full Sesotho screens**: choose *ST* at the top and menus, buttons, table headings, forms, the till, settings and messages switch to Sesotho (about 2 100 screen texts), on top of the Sesotho help notes and setup guide. Receipts, invoices and documents for customers and RSL stay in English.
- **Settings → Translations**: a native speaker can correct any Sesotho word or fill in texts that are still English (they are collected automatically as people use the program, most-seen first). Corrections apply to everybody at once – no new version needed. Export to CSV / Excel to work offline and import it back.
- **KYC requests go to kyc@smartelmoney.com**, with the KYC documents attached; if this computer cannot send email, the screen says so and gives a ready-to-send email link.
- **Foolproofing**:
  - A missing required field is outlined in red, the screen scrolls to it and says which one to fill in.
  - Typing in a form and then pressing ✕, Escape or clicking beside it asks before throwing the typing away.
  - "Failed to fetch" and server errors are replaced by plain instructions (is the shop computer on, same Wi-Fi?), and an action that fails always shows a message instead of doing nothing.

### Also in 1.20.1

**Tax centre: checks before filing, VAT supplies by class, and the RSL payment fee up front.**

- **VAT checks before filing** (as in the Smartel design, P11): VAT that does not match its line, sealed receipts refused by Smartel or not sent yet, a held receipt chain, unusually many voids or refunds, prices far from the list price, and input VAT claimed from suppliers without a VAT number. A serious problem must be fixed – or confirmed – before the return is marked filed.
- The VAT return shows **standard-rated, zero-rated and exempt** supplies separately.
- **Fee for paying RSL through MyWallet**: the confirmation shows tax + fee = total before you pay. MyWallet's own quote is used when it gives one; otherwise the tariff under *Tax centre → Settings* (fixed + % with an optional cap). The fee is booked as a tax payment fee, and *What is due* shows taxes and fees paid this tax year.
- **RSL acknowledgement & papers**: attach the e-Tax acknowledgement, assessments and receipts to each return.

### Also in 1.20.0

**Customer portal, a web version and an Android app.**

- **Customer portal**: send each account customer a private link (QR, SMS or WhatsApp). On their phone they see what they owe, their open invoices and a 6-month statement, in English or Sesotho, and can **pay with MyWallet, card or Switch** (through the Smartel POS backend – the payment goes straight onto their account) or **upload proof of a bank payment** (it arrives on their contact with a task to check it). Links can be renewed or switched off; visits are logged.
- **Web version**: run S-ERP on a server or in the cloud with Docker (app + MySQL, optional automatic HTTPS). A set-up key protects the first start, and the database cannot be changed from the browser.
- **Phones and tablets**: the screens and the till work on a phone; install it from the browser as an app (PWA). An **Android app** is built automatically with every release – it connects to the shop PC on the Wi-Fi or to the web version.
- Fix: the welcome tour no longer stays on screen when you open another app.
- Setup-guide step and help notes in English and Sesotho.

### Also in 1.19.0

**Tax centre: every RSL tax in one place – worked out from the books, filed and paid.**

- **What is due**: a calendar of VAT (20th), PAYE and withholding tax (15th), income tax instalments (30 Sep, 31 Dec, 31 Mar) and the annual return (30 Jun), fringe benefit tax each quarter and any other levy – with what is owed now per tax and overdue items in red.
- **Returns from the books**: VAT with output and input VAT and supplies by rate; PAYE from the payroll run; withholding tax from the register; income tax instalments from your estimate (or last year's profit); the annual income tax return with add-backs, allowances, losses, instalments and withholding credits. Print any return.
- **Filed with RSL** locks the return and posts the closing entry; **Pay** records bank / EFT / M-Pesa / cash payments, in parts if needed – or pays RSL **through MyWallet at the till** via the Smartel POS backend, with MyWallet's fee shown first and booked.
- **Withholding tax**: tax withheld from contractors with a printable certificate, and certificates from customers claimed against income tax.
- Settings for TIN, VAT registration, rates, due days and year-end (defaults from RSL, Nov 2026). Setup-guide steps and help notes in English and Sesotho.

### Also in 1.18.0

**Smartel POS backend: MyWallet agent services, card / MyWallet / Switch payments and sealed receipts – never a direct line to the core banking system.**

- **Settings → Smartel connection**: pos-api and syncd addresses, one Smartel terminal ID and certificate per till, test button, connection state, and a plain explanation of what goes where. S-ERP only talks to the Smartel adapters; the old direct "My Wallet" VAS set-up is switched off while the connection is on.
- **💸 Agent services at the till**: cash deposit, withdrawal (customer's SMS PIN), till cash-out, send money, cash-in to another network (NPS Switch), redeem a Switch voucher, airtime, LEC electricity and bills (DStv, WASCO and others). MyWallet's name check and fee are shown before you confirm. The PIN is never stored. A service MyWallet does not answer is never sent twice – it is checked until MyWallet's history settles it.
- **One customer, one receipt**: goods and services on the same receipt with the **net cash** in or out of the drawer; services-only customers get a session receipt. Cash-up expects exactly the net of all cash effects.
- **Card, MyWallet (scan to pay) and Switch** for goods: the customer approves on their own phone; the sale completes only when the payment is confirmed.
- **Sealed, chained receipts** (sale, services, deliveries, recall acknowledgements, scan flags, heartbeats) are sent to Smartel automatically, oldest first after an outage; you can see what was accepted or refused and re-check the chain.
- **Recalls and the National Product Register**: recalled products (or only the recalled lot) cannot be sold; unregistered barcodes are refused or warned, and reported with the shop's location. Catalogue links, price updates and the daily **Thoki** float line arrive automatically.
- **Wages by MyWallet**: pay staff on mobile money from an approved payroll run in one bulk batch from the business wallet, without double-booking when the run is marked paid.
- **Books**: payment services are not sales – agency cash, digital takings due, commission and the business wallet have their own accounts, with a screen to record settlements.
- Demo barcodes now carry correct check digits. Receipts no longer wrap amounts.
- Setup-guide steps and help notes in English and Sesotho for all of it.

### Also in 1.17.0

**Foolproof first start, KYC and activation.**

- **New first-run wizard**: one question per screen with big buttons and a progress bar – language (English, Sesotho or both) → where to keep the data (one click for the built-in database) → your business (name, phone, address, Maloti or Rand, "Are you VAT-registered? Yes / No / Not sure", logo) → what your business does (picture cards, shows which apps will be switched on) → your login (password strength, typed twice, show/hide) → KYC → a summary with "change" links → *Create my business*. Every answer is checked with a plain explanation of what is wrong; nothing is lost if the screen is reloaded; database errors are explained in plain words.
- **"What next?"** after setup: follow the setup guide, import data from another program, or look around – with a short **guided tour** of the home screen the first time.
- **KYC & activation**: every new business gets a **30-day trial**. To keep selling after that, My Wallet activates it: **existing My Wallet agents / merchants only give their agent or merchant number** (their KYC is already on file); new businesses upload photos or PDFs of their ID, business registration / trader's licence and proof of address (TIN / VAT certificate and bank letter if they have them). The request (and a KYC pack zip) goes to My Wallet, who sends back an **activation code** that only fits this installation. Until then a banner shows the days left; after the trial, selling (till, customer invoices, airtime / electricity) pauses while everything else keeps working.
- Login: Caps Lock warning and help for a forgotten password.
- Fix: the trip screen sometimes did not refresh after a vehicle left.

### Also in 1.16.0

**SMS & email campaigns, recruitment and staff appraisals.**

- **Campaigns**: send specials, events and news by SMS, email or both to a chosen audience – all customers, tenants, parents, patients, hire customers or suppliers, narrowed by **tags**, **bought in the last … days**, **not seen for … days** (win-back), **birthday month** and **total spent**. The screen shows how many people it reaches and how many SMS it will cost before you send; messages are personalised with {first_name}; send a test to yourself, send now or **schedule** (goes out within five minutes of the time). Every message is logged per customer and added to their CRM history.
- **Opt-out**: tick *No marketing* on a contact and they are never included; every message says how to stop them. Invoices and payment reminders still go.
- **Recruitment**: job openings with a printable **advert** (job, requirements, salary range, how to apply, closing date); applicants with CV, ID and certificates attached, moving **new → screening → interview → offer → hired** on a board; **SMS** interview invitations, offers and regrets; duplicate applications caught; **Hire** creates the employee in HR & Payroll with the agreed salary and copies their documents, and closes the job when all posts are filled. Shows where your hires come from.
- **Appraisals**: score every employee 1–5 on weighted points you choose (quality, attendance, customer service, teamwork…), with strengths, things to improve, goals and the employee's comment; previous scores alongside; printable form with signature lines; closing can **apply the agreed salary increase** from the next payroll. Overview per period of who still needs an appraisal.
- Setup-guide steps and help notes in English and Sesotho for all of it.

### Also in 1.15.0

**Farm** – for poultry (layers and broilers), wool and mohair, cattle, pigs, dairy and crop farms.

- **Herds, flocks and houses** with head count, what they are kept for and what they produce. Daily **production** (eggs, milk, wool, mohair) goes straight into stock at its cost price, with a 14-day production chart and lay rate per flock.
- **Tagged animals** (cattle, sheep, goats, pigs…): breed, sex, age, weight, herd, mother and offspring; **births** (twins and triplets) registered under the mother; animals **sold** (invoice to the buyer), **died** or **slaughtered**.
- **Farm diary**: feed, vaccinations, dosing, weighing, deaths, labour and contractors. Feed, vaccines, medicines, seed and fertiliser are taken **out of stock at cost**; a vaccination or dose with a *next due* date appears under **Health due** until it is done again.
- **Fields and crop seasons**: planting, fertiliser, spraying, ploughing and harvest per field; the harvest goes into stock; cost and yield per hectare.
- **Results** per herd / flock (inputs, produce, animals sold, births, deaths) and per crop season, plus a herd book per species.
- Import farm animals (stock register) and fields from Excel; new role **farmworker** (farm diary and clocking in); setup-guide steps and help notes in English and Sesotho.

### Also in 1.14.0

**Move in from another system – and instructions in Sesotho.**

- **Import data** (home screen tile, and an *⬆ Import* button on each module): bring in data from your old program or from Excel – **.xlsx or CSV**, using our template or the old system's own export as it is.
  - Columns are matched by name automatically (English, Sesotho and the names other programs use, e.g. "Item Code", "Qty On Hand", "Lebitso", "Mohala"); you can change any match. Title rows above the table are skipped.
  - Amounts like "M 1 250,00" or "1,250.00", and dates like 31/01/2026, 2026-01-31, 31 Jan 2026 or Excel dates are understood.
  - Every row is checked before anything is saved; rows with problems are shown with the reason. Rows already in the system are skipped, so importing the same file twice does not make duplicates.
  - Rows that could not be imported can be downloaded as an Excel file with the reason, fixed and imported again.
  - What can be imported: products with opening stock (incl. batch and expiry), stock on hand per branch, customers, suppliers, **what customers owe** and **what you owe suppliers** (unpaid invoices – ageing, statements and reminders are right from day one), **opening trial balance**, employees, patients, learners (classes made automatically), buildings & units, **tenants & leases** (rent is billed from the next rent date – old months are not billed again; deposits held are brought in), hire items, vehicles, rooms, machines, client sites and sales leads.
- **Help notes in Sesotho**: choose EN, ST or EN + ST at the top of the screen. All 645 yellow help notes and every setup-guide step are available in Sesotho; with EN + ST the Sesotho text shows under the English.
- New setup-guide step *Bring your data from the old system*.
- Fix: the reminders screen could show an error when you left it before it finished loading.

### Also in 1.13.0

**Patients & dispensing** – for clinics, surgeries, pharmacies, dentists, optometrists and vets.

- **Patient files**: file number (automatic or your existing paper number), age and sex, contacts and next of kin, **allergies** and chronic conditions shown in red on every screen, medical aid with membership number and main member, visit history, medicines given and what the patient owes.
- **Waiting queue**: *Patient arrives* finds the patient (or registers a new one on the spot), takes vital signs (temperature, blood pressure, pulse, SpO₂, weight, height – BMI worked out; impossible values refused) and gives a queue number. Practitioners call patients in.
- **Consultation**: complaint, history, examination, diagnosis with ICD-10 code, plan, sick-note days and follow-up date; previous visits beside it.
- **Prescribing and dispensing** with safety checks: medicines of a group the patient is allergic to (e.g. amoxicillin for a penicillin allergy, ibuprofen for an NSAID allergy) need the practitioner to confirm; medicines are given first-expiry-first-out and an **expired batch is refused**; not enough stock is caught before the bill.
- **Billing** to the patient or the **medical aid**, with a co-payment billed to the patient and taken off the medical aid's invoice; stock goes out and income is booked when billed.
- Printing: **medicine labels** (directions, patient, date, your warning), prescriptions and **medical certificates**.
- **Medical-aid claims** unpaid per medical aid with age; **dispensing register** per medicine; patients per practitioner; most common diagnoses.
- New role **clinician** (doctors, nurses, pharmacists); receptionists can register arrivals. Clinical notes are not visible to the accountant role.
- Setup guide steps and yellow help notes.

### Also in 1.12.0

**Equipment & party hire** – for tent, chair and décor hire, scaffolding, plant and tool hire, generators and sound.

- **Items for hire** with how many you own, price per day and cheaper week / month prices, deposit per item and replacement cost. Machines can also be serviced through Maintenance.
- **No over-booking**: a hire reserves its items for the dates; the system never promises more tents or chairs than you have in the yard (broken items and late returns are taken into account). *What is free* shows availability for any dates.
- **Hand-over with a deposit** (worked out from the items, or your own amount); the deposit is kept apart, not counted as income.
- **Returns** all at once or in parts, with damaged items (out of the pool until marked repaired) and lost items (charged at replacement cost). Hire is charged for the days actually out, always at the cheapest mix of day, week and month prices.
- **Settle**: one invoice with hire, damage, losses and delivery; the deposit is set off against it, the rest is paid or the left-over deposit refunded (or kept as credit). Cancellations can keep a fee.
- Printable **hire agreement** with your own terms and signature lines; late hires flagged; utilisation and income per item; hire invoices can get payment reminders.
- New business type *Equipment & party hire*; setup guide steps and yellow help notes.
- Fix: VAT on room bills and hire bills is worked out of the price incl. VAT, so totals never come out a cent off.

### Also in 1.11.0

**Payment reminders, lodges & guesthouses, and transport businesses.**

- **Payment reminders by SMS and email**: one list of everyone with overdue invoices – tenants, parents, contract clients or all customers – with how much, since when and when they were last reminded. Tick and send, or switch on **automatic reminders** a set number of days after the due date (e.g. 3, 14 and 30 days, never twice in two days). Messages are personalised (name, amount, flat or learner, your phone number), every reminder is logged and added to the customer's CRM history. Works with any SMS provider that has a web link (most Lesotho bulk-SMS companies); *Remind* buttons on leases and learners.
- **Rooms & bookings** (lodges, guesthouses, B&Bs): room types with rates, rooms with housekeeping status, a front-desk board (who is in, arriving, leaving), a 14-day booking calendar (click an empty night to book), walk-ins checked in straight away, deposits, extra charges to the room, restaurant and bar sales from the POS on the guest's bill, early check-out, no-shows, company accounts, printed guest bill, occupancy, average rate and RevPAR. New role **receptionist**.
- **Fleet & trips** (trucks, buses, taxis, couriers, car hire): vehicles with licence disc, insurance, fitness and permit expiry warnings; fuel with km per litre; trips charged per trip, km, ton, seat or day with tolls and allowances, leaving and returning with odometer readings, and one invoice for a customer's finished trips; daily takings for taxis and buses; repairs through Maintenance; income, costs, profit and cost per km per vehicle.
- Setup guide steps and yellow help notes for all the new screens.

### Also in 1.10.0

**For rent collectors, schools, security and cleaning companies.**

- **Property & rent**: buildings and units (flats, rooms, shops, offices), tenants and leases. Rent is invoiced by itself every month on the due day (a part first month is charged pro rata), with a yearly increase % applied on the anniversary. Deposits are kept as the tenant's money and settled at move-out (unpaid rent, damage, refund). Utility and late-fee charges, payments that clear the oldest rent first, rent roll (let / vacant / on notice), arrears by age, tenant statements. **Rent collectors**: put a building under its landlord with your commission % – rent collected is owed to the landlord, and *Pay landlord* books your commission and the payout with a printable landlord statement.
- **School fees**: classes (with the class learners move up to), learners with their paying parent / guardian, fee structure per grade (per term / month / year / once, optional fees like lunch and transport), billing runs that invoice every learner in one go with bursaries and sibling discounts, family payments to the oldest fees, fee statements, arrears per class, and end-of-year promotion and graduation.
- **Sites & shifts (security and cleaning)**: client sites with post orders and staff needed, rosters for day and night shifts (clashes skipped), a duty board showing who is on duty, late or absent, relief for absent staff, an electronic occurrence book, incident reports (printable, with police case number), cleaning inspections scored against each site's checklist, supplies issued to a site, invoicing per shift or per hour, and hours and profit per site.
- New business types *Security company* and *Cleaning company*; *Property & rent collection* replaces *Rental & property*. New role **supervisor** (sites, rosters, duty board).
- Fix: spare parts on machine repairs were booked to *Cash over/short* instead of *Repairs & maintenance* – existing entries are corrected automatically.

### Also in 1.9.0

**Win more business, invoice on time, keep the paperwork.**

- **Sales pipeline** (CRM → Pipeline): every enquiry, tender or big order as a card – New → Qualified → Proposal sent → Negotiation (stages can be renamed). Expected value, chance of winning, decision date, owner, source and next step (cards without a planned next step are flagged). *Make quotation* creates the customer and the quote; confirming the quote marks the lead **won**, a declined quote marks it **lost**. Open and weighted pipeline, win rate, why deals are lost and which sources bring business.
- **Contracts & repeat invoices**: rent, school fees, security, cleaning, support or licences invoiced every week / month / quarter / year (or every 2nd month…), from a start date to an optional end date. Invoices are made automatically every hour while the system runs – as drafts to check, or posted straight away – missed periods are caught up, month-ends are handled (31 Jan → 28 Feb). Monthly recurring income on the list.
- **Files on records**: attach signed delivery notes, proof of payment, quotes, photos, ID copies or contracts (up to 8 MB each) to customers, leads, quotations, invoices, purchase orders, projects, tickets and contracts. Files are kept in the database so they are included in backups.
- **⬇ Excel on every list and report**: one click saves the tables on the screen as an Excel file (one sheet per table, numbers as numbers, header row frozen).
- Setup guide steps and yellow help notes for the new screens.

### Also in 1.8.0

**Operations and service businesses.**

- **Machines & maintenance**: register ovens, mixers, generators, vehicles; anyone can report a breakdown (machine marked *down*, work orders on it ask before starting); technicians start and finish jobs with spare parts from stock (booked to Repairs & maintenance), labour, outside repairer and downtime; service intervals with *Plan due services*; repair cost and downtime per machine.
- **Requests for quotation (RFQ)**: ask several suppliers for prices on the same items (email or print), type in their prices and delivery times, see the cheapest per item, and make one draft purchase order per supplier in one click. *Materials to buy* in Manufacturing can start an RFQ.
- **Make to order**: a confirmed sales order makes work orders for products with a bill of materials – only what stock cannot cover, or the full quantity.
- **Projects**: customer, billing by the hour / fixed price / internal, budget hours, task board (to do → busy → to check → done), hours by person, invoicing of logged hours or a % of the contract, profit so far (invoiced − staff cost − expenses).
- **Timesheets**: everyone logs hours on their tasks; *My tasks & hours* screen; billable / non-billable; invoiced hours are locked.
- **Helpdesk & repairs**: tickets by phone, walk-in, WhatsApp or email with response deadlines per priority, replies and internal notes, repair job cards with item and serial number, parts and labour, printable job card, one-click invoice.
- Ticking a business type (in the setup guide or settings) now only ever **adds** modules – it no longer switches off modules you were already using, such as Branches & warehouses.
- New roles **technician** (helpdesk, repairs, maintenance) and **staff** (helpdesk, own tasks and hours).
- Setup guide steps and yellow help notes for all of these.

### Also in 1.7.1

- **Smoother updates:** the update now installs in the background without flashing command windows, and if the old copy of S-ERP does not close by itself within about 30 seconds it is ended automatically, so the update can no longer get stuck.

### Also in 1.7.0

**For every kind of business – not only shops.**

- **13 business types** at first setup and under Settings → **Business & modules**: retail, butchery, restaurant, bar, wholesale & distribution, manufacturing, services & projects, lodge / guest house, school, clinic / pharmacy, transport, rental & property, agriculture. Tick several (e.g. Lodge + Bar). Each type switches on the modules it needs; switch any module on or off – the home screen, menus and setup guide follow. Modules still being built are shown as *coming soon*.
- **Branches, warehouses and vans**: stock is now kept per location. Tills, purchase orders, invoices and users belong to a branch; stock counts are per branch; minimum levels and shelf/bin per branch; stock-by-location table with low-stock warnings.
- **Stock transfers** between locations through *In transit*: send, receive what actually arrived, shortages written off automatically, batches keep their number and expiry, printable transfer note.
- **Profit by branch** and a branch filter on the Profit & Loss report.
- **Manufacturing**: bills of materials with cost per unit and margin (materials + expected waste + labour + overhead), work orders (plan → start → finish), quality check, rejects written off, finished goods as batches with best-before dates and links to the materials' batches, printable job card, and a *materials to buy* list that turns into a purchase order.
- Setup guide steps for each new business type and module.

Also in this release (from the ERP tool list – phase 1):

New modules (from the ERP tool list – phase 1):

- **Quotations & sales orders** (Sales menu): quotation → customer accepts → sales order → invoice. Print/PDF or email the quotation, validity dates, customer reference, terms, win/loss figures.
- **Promotions & price rules**: % off, amount off, special prices, multi-buy ("3 for 2"), quantity breaks, happy hour (times and days), date ranges, and prices for customer groups via tags (e.g. *wholesale*). Applied automatically at the till and on quotations – cashiers don't need discount rights; the best deal wins.
- **Bank & M-Pesa reconciliation** (Accounting): import a bank or M-Pesa/EcoCash statement as CSV, automatic matching against sales and payments, book charges, deposits and customer payments straight from the statement, compare with the closing balance.
- **Expense claims & approvals**: staff claim money spent for the shop with a photo of the slip; a manager approves (never their own) and pays back. Purchase orders above a set limit wait for a manager. One **Approvals** inbox.
- **Attendance**: staff clock in/out with their PIN on the login screen or till; who is at work now, hours, overtime above 9 h/day or 45 h/week, and overtime added to payroll.
- Setup guide has new optional steps for these; yellow help notes on every new form.
