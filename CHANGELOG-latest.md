## Maluti ERP 1.15.0

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
