## Maluti ERP 1.21.1

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
- **Web version**: run Maluti ERP on a server or in the cloud with Docker (app + MySQL, optional automatic HTTPS). A set-up key protects the first start, and the database cannot be changed from the browser.
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

- **Settings → Smartel connection**: pos-api and syncd addresses, one Smartel terminal ID and certificate per till, test button, connection state, and a plain explanation of what goes where. Maluti only talks to the Smartel adapters; the old direct "My Wallet" VAS set-up is switched off while the connection is on.
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

- **Smoother updates:** the update now installs in the background without flashing command windows, and if the old copy of Maluti ERP does not close by itself within about 30 seconds it is ended automatically, so the update can no longer get stuck.

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
