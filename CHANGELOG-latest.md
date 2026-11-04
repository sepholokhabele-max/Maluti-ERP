## Maluti ERP 1.8.0

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
