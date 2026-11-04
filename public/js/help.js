// Explanation notes shown under every input on the setup and configuration screens.
// formHtml(fields, values, { ctx: 'company' }) looks up HELP[ctx][field.key]; a field's own `help` wins.
export const HELP = {
  db: {
    host: 'Where MySQL runs. "localhost" if MySQL is installed on this computer; otherwise the server\'s IP address, e.g. 192.168.1.10.',
    port: 'Normally 3306. Only change it if your MySQL was installed on another port.',
    user: 'A MySQL user that may create databases – usually "root" on a new installation.',
    password: 'The password set for that MySQL user when MySQL was installed.',
    database: 'Name of the database Maluti ERP will use. It is created automatically if it does not exist. Keep "maluti_erp" unless you run several companies.'
  },
  setup: {
    name: 'Your trading name exactly as it should appear on receipts, invoices and reports, e.g. "Ha Thetsane Butchery".',
    phone: 'Shop phone number printed on receipts and invoices so customers can reach you.',
    address: 'Physical address (street, town). Printed on invoices and purchase orders.',
    email: 'Business email shown on invoices. End-of-day reports are set up separately in Settings → Email.',
    tax_number: 'Your VAT number or TIN from Revenue Services Lesotho. Printed on tax invoices – leave blank if not registered.',
    currency_code: 'Three-letter currency code used in reports, e.g. LSL (Loti), ZAR (Rand).',
    currency_symbol: 'Symbol printed before amounts, e.g. M for Maloti or R for Rand.',
    vat_rate: 'Standard VAT rate in percent. Lesotho: 15. Enter 0 if you are not VAT-registered. You can add more rates later (Settings → Taxes).',
    receipt_footer: 'Short message printed at the bottom of every receipt, e.g. returns policy or "Thank you – come again!".',
    a_name: 'Name of the owner or manager who will administer the system. Shown on documents they create.',
    a_username: 'Login name for the administrator, e.g. "admin" or your first name. No spaces.',
    a_password: 'At least 6 characters. Keep it secret – the administrator can change prices, users and settings.',
    a_pin: 'Optional 4–6 digit code for quick login at the till. Cashiers get their own PINs under Settings → Users.',
    demo: 'Adds sample products, customers and suppliers so you can practise. Untick for a clean start with your own data.'
  },
  company: {
    name: 'Trading name printed on receipts, invoices and reports.',
    phone: 'Printed on receipts and invoices.',
    address: 'Street and town – printed on invoices and purchase orders.',
    email: 'Shown on invoices and used as the reply address for emailed documents.',
    tax_number: 'VAT number / TIN from Revenue Services Lesotho. Required on tax invoices if you are VAT-registered.',
    currency_code: 'Three-letter code, e.g. LSL or ZAR.',
    currency_symbol: 'Printed before amounts, e.g. M.',
    default_vat: 'VAT % suggested on new invoice and purchase lines. Products use the tax chosen on each product.',
    receipt_footer: 'Printed at the bottom of every receipt – returns policy, slogan or bank details.',
    show_logo_receipt: 'Print the uploaded logo at the top of receipts and Z-reports.',
    logo_bw: 'Recommended for thermal receipt printers – converts the logo to sharp black and white.',
    logo_width_mm: 'How wide the logo prints. 40 mm suits most 80 mm receipt printers; use 30 for 58 mm printers.'
  },
  pos: {
    print_kitchen_tickets: 'Restaurants and bars: when a waiter sends an order, a ticket prints for the kitchen or bar (by product category station).',
    require_pin_between_sales: 'Shared tills: after each sale the till locks and the next cashier enters their PIN, so every sale is linked to the right person.'
  },
  qr: {
    receipt_qr: 'Adds a QR code to receipts. Customers scan it to get a digital copy and can save it to Samsung or Google Wallet.',
    receipt_qr_text: 'Short instruction printed under the QR, e.g. "Scan for your digital receipt".',
    pay_qr: 'Prints the payment QR of each payment method (e.g. M-Pesa merchant QR) on bills and invoices so customers can pay by scanning.'
  },
  paymethod: {
    name: 'How the method appears on the till and in reports, e.g. "Cash", "Card", "M-Pesa", "EcoCash".',
    kind: 'Cash counts in the drawer; card / mobile money are reconciled with the bank or wallet statement; "account" puts the sale on the customer\'s account (credit).',
    account_code: 'Where the money is booked: Cash on hand, Card clearing (until the bank pays out), Mobile money wallet, Bank, or Accounts receivable for credit sales.',
    plugin_id: 'Optional: link a payment plugin (e.g. mobile money) so the till sends a payment request to the customer\'s phone.',
    qr_label: 'Caption printed with the pay-by-QR code, e.g. "Scan to pay with M-Pesa – till 123456".',
    sort_order: 'Order of the payment buttons on the till – lower numbers first.',
    requires_reference: 'Cashier must type the slip or transaction number (recommended for card and mobile money) – makes reconciliation easy.',
    active: 'Untick to hide this method on the till without deleting its history.'
  },
  tax: {
    name: 'Name shown on invoices and reports, e.g. "VAT 15%" or "Zero-rated".',
    rate: 'Percentage, e.g. 15 for standard VAT, 0 for zero-rated or exempt items.',
    price_includes_tax: 'Ticked (usual for shops): the shelf price already includes VAT. Unticked: VAT is added on top of the price.'
  },
  till: {
    name: 'Name of the till / computer, e.g. "Front counter" or "Bar 1". Each till has its own cashier sessions.',
    mode: 'Retail: scan and pay. Restaurant: tables, floors and kitchen tickets. Bar: open tabs. Butchery tills use Retail.',
    location_id: 'The branch this till is in. Sales here take stock from that branch and count towards its profit. Blank = the default location.'
  },
  floor: {
    name: 'An area of the restaurant, e.g. "Inside", "Patio", "VIP".',
    sort_order: 'Order of the floor tabs on the till.'
  },
  table: {
    name: 'Table label as staff know it, e.g. "T1" or "Window 3".',
    floor_id: 'The area this table is in.',
    seats: 'Number of seats – used for guest counts.'
  },
  category: {
    name: 'Product group shown as a button on the till, e.g. "Beef", "Pork", "Drinks".',
    station: 'Where orders for this category print in restaurant/bar mode: Kitchen, Bar, or None for retail items.',
    color: 'Colour of the category on the till so staff find items quickly.',
    sort_order: 'Order of the category buttons on the till.'
  },
  user: {
    location_id: 'Home branch of this person. Purchase orders and invoices they create are booked to this branch, and they receive transfers sent to it.',
    name: 'Staff member\'s full name – shown on receipts, sessions and reports.',
    username: 'Login name, no spaces, e.g. "thabo".',
    email: 'Optional – for sending them reports.',
    role: 'What they may do. admin: everything. manager: till incl. refunds & discounts, stock, buying, invoicing, books, reports, CRM, recon, HR – but not system settings. accountant: books, invoices, reports, recon, payroll (no till). cashier: till, airtime & electricity. waiter: take orders. bartender: tabs, airtime. kitchen: kitchen display only.',
    password: 'For logging in to the back office. At least 6 characters.',
    pin: '4–6 digits for fast login at the till. Every cashier needs a different PIN.',
    active: 'Untick when someone leaves – they can no longer log in, their history stays.'
  },
  email: {
    smtp_host: 'Your email provider\'s outgoing (SMTP) server, e.g. smtp.gmail.com, smtp.office365.com, mail.yourdomain.co.ls.',
    smtp_port: '587 for STARTTLS (most providers) or 465 for SSL. Ask your provider if unsure.',
    smtp_user: 'Usually the full email address you send from.',
    smtp_pass: 'The email password. For Gmail/Outlook with 2-step verification create an "app password" and paste it here.',
    smtp_secure: 'Tick only when the port is 465 (SSL). Leave unticked for 587.',
    from_address: 'Address the reports come from, e.g. "Ha Thetsane Butchery <reports@yourshop.co.ls>".',
    recipients: 'Who receives the end-of-day report – owner, manager, accountant. Separate addresses with commas.',
    eod_enabled: 'Sends sales, payments by method, cashier sessions, recon and waste for the day automatically.',
    eod_time: 'Time to send the daily report – after closing, e.g. 21:00.',
    attach_csv: 'Attach the day\'s sales as a CSV file for Excel.',
    send_on_session_close: 'Also email a report each time a cashier closes their session (shift).'
  },
  product: {
    name: 'Name on the till, receipts and labels. Keep it short and clear, e.g. "Rump steak", "Coke 330ml".',
    type: 'Stocked item: quantities are counted and costed. Made to order: meals, cocktails, tots/glasses poured from a bottle – not counted. Service: labour or fees.',
    category_id: 'The till button group it appears under. Manage categories with the Categories button.',
    price: 'Selling price including VAT (per kg for items sold by weight).',
    cost: 'Purchase cost per unit. For stocked items it updates automatically (moving average) when you receive stock.',
    tax_id: 'The VAT rate for this item. Basic foods may be zero-rated – check with your accountant.',
    uom: 'Unit of measure: Unit, kg, Bottle, Litre, Pack… Use "kg" for meat sold by weight.',
    sku: 'Your own short code for searching, e.g. "BF-RMP". Optional.',
    barcode: 'Manufacturer barcode (EAN) – scan it into this field. Leave blank for weighed meat; scale labels use the PLU.',
    reorder_level: 'When stock falls to this quantity it shows on the low-stock list and dashboard.',
    opening_qty: 'Quantity you already have on the shelf today. It is valued at the cost price above.',
    sold_by_weight: 'The till asks for the weight (or reads the scale) and charges price × kg.',
    plu: 'Scale item code (e.g. 1001). Must match the PLU programmed in your label scale so scanned labels find this product.',
    shelf_life_days: 'Days from packing/receiving to use-by date. Used for batch expiry dates and labels.',
    track_batches: 'Keep stock in batches with use-by dates; sales take the batch that expires first.',
    is_carcass: 'Tick for whole carcasses/primals you buy in. Each one received gets its own tag and is traced kg by kg until fully sold.',
    species: 'Animal the meat comes from – used for reports by animal. Cuts take it from the carcass automatically.',
    bottle_ml: 'Spirits & wine: contents of one bottle, e.g. 750 or 1000.',
    bottle_empty_g: 'Weight of an empty bottle with its pourer, in grams. Weigh one on the scale once.',
    bottle_full_g: 'Weight of a full, unopened bottle in grams (optional – makes ml-from-weight more accurate).',
    pour_from_id: 'For a tot or glass: the bottle it is poured from. Selling it takes its millilitres off that bottle\'s stock.',
    pour_ml: 'Size of this measure in ml: 25 single tot, 50 double, 175 or 250 wine glass.',
    pos_visible: 'Show this item as a button on the till. Untick for raw materials like carcasses, casings or spices.',
    active: 'Untick to retire a product without losing its history.'
  },
  partner: {
    name: 'Customer or supplier name as it should appear on invoices.',
    phone: 'Main contact number – also used for mobile money payments and SMS later.',
    email: 'Where invoices and statements are emailed.',
    contact_person: 'Person you deal with at this company.',
    birthday: 'Optional – shows in CRM birthday reminders.',
    tags: 'Labels to group contacts, e.g. vip, wholesale, restaurant.',
    address: 'Delivery / postal address printed on invoices and purchase orders.',
    tax_number: 'Their VAT / TIN number – required on tax invoices to VAT-registered customers.',
    credit_limit: 'Maximum they may owe you on account. 0 = no credit sales allowed.',
    is_customer: 'You sell to them.',
    is_supplier: 'You buy from them (abattoir, farmer, wholesaler…).',
    notes: 'Anything staff should know, e.g. delivery days or price agreements.'
  },
  butchery: {
    enabled: 'Turns on weighed items, scale labels, carcass breakdown & tracing, waste, batches and processing for the whole business.',
    scale_enabled: 'Tick on the till that has a scale connected by USB/RS-232 cable.',
    auto_read: 'Read the weight automatically when a weighed item is tapped, instead of pressing "Read scale".',
    baud_rate: 'Communication speed set in the scale\'s menu – usually 9600.',
    data_bits: 'As set in the scale – usually 8.',
    parity: 'As set in the scale – usually none.',
    stop_bits: 'As set in the scale – usually 1.',
    request_cmd: 'Command the scale needs before it sends a weight (see its manual, e.g. W or P). Leave blank if it sends weights continuously.',
    barcode_prefixes: 'First digits of barcodes printed by your label scale, usually 20–29. Barcodes starting with these are read as weighed labels.',
    barcode_value_type: 'Whether your scale puts the price or the weight into the barcode – check a printed label or the scale settings.',
    barcode_item_digits: 'How many digits of the barcode are the PLU (usually 5).',
    barcode_value_digits: 'How many digits hold the price in cents or weight in grams (usually 5). Prefix + PLU + value + 1 check digit must be 13.',
    label_barcode_prefix: 'Prefix used on labels printed from Maluti ERP (pre-pack labels) – one of the prefixes above.',
    expiry_warning_days: 'Warn on the dashboard this many days before a batch\'s use-by date.',
    label_width_mm: 'Width of your label stock in mm (e.g. 60).',
    label_height_mm: 'Height of your label stock in mm (e.g. 40).',
    waste_reasons: 'Reasons staff can pick when writing off stock, one per line, e.g. Trimming, Spoilage, Expired.'
  },
  hrm_tax: {
    name: 'Label for the tax year, e.g. "PAYE 2027/28".',
    effective_from: 'First day these rates apply (Lesotho tax years start 1 April). Earlier months keep the previous table.',
    band_monthly: 'Monthly income taxed at the lower rate (2026/27: M6,480).',
    credit_monthly: 'Monthly personal tax credit subtracted from the tax (2026/27: M1,020).',
    lower_rate: 'Rate on income up to the band – 20% in Lesotho.',
    upper_rate: 'Rate on income above the band – 30% in Lesotho.',
    source: 'Where the rates come from, e.g. "Budget speech Feb 2027 / RSL notice" – for your records.'
  },
  employee: {
    first_name: 'As on the ID document.', last_name: 'As on the ID document.',
    code: 'Payroll/staff number. Leave blank to number automatically.',
    job_title: 'e.g. Butcher, Cashier, Chef – printed on the payslip.',
    department_id: 'Group for payroll reports. Add departments in HR → Settings.',
    employment_type: 'Permanent, fixed-term contract, casual or intern – for records and reports.',
    hire_date: 'First working day – used for pro-rata pay in the first month and for leave.',
    status: 'Only active employees are included in payroll runs.',
    termination_date: 'Last working day – the final month is paid pro-rata.',
    basic_salary: 'Gross monthly basic salary before allowances and deductions.',
    id_number: 'National ID or passport number – required for PAYE returns.',
    tin: 'Employee\'s TIN from Revenue Services Lesotho – used on PAYE reports.',
    gender: 'Optional – for statutory statistics.',
    birth_date: 'Optional.',
    phone: 'For payslip notifications and emergencies.', email: 'Optional – payslips can be emailed.', address: 'Home address.',
    pay_method: 'How salary is paid – appears on the payroll payment list.',
    bank_name: 'e.g. Standard Lesotho Bank, FNB, Nedbank, Lesotho PostBank.',
    bank_account: 'Account number for salary transfers.',
    mobile_money_number: 'Number for salary paid by M-Pesa or EcoCash.',
    paye_applies: 'Untick only for people exempt from PAYE (e.g. some interns) – you remain responsible for compliance.',
    emergency_contact: 'Name and number of someone to call in an emergency.',
    user_id: 'The till login this employee uses. Links their clock-ins to payroll so overtime can be paid.',
    notes: 'Private HR notes.'
  },
  payitem: {
    kind: 'Allowance/earning adds to pay; deduction is subtracted (loans, union fees, pension).',
    name: 'Shows on the payslip, e.g. "Transport allowance", "Staff loan".',
    amount: 'Amount every month until you deactivate it.',
    taxable: 'Most allowances are taxable. Untick only for exempt items.',
    pre_tax: 'Approved pension or retirement-annuity contributions reduce taxable income before PAYE.',
    active: 'Untick to stop it from the next payroll run.'
  },
  leavetype: {
    name: 'e.g. Annual, Sick, Maternity, Family responsibility.',
    days_per_year: 'Days each employee gets per year. 0 = not tracked.',
    paid: 'Paid leave does not reduce salary; unpaid leave is deducted in payroll.'
  },
  quote: {
    partner_id: 'Who the quotation is for. Add new customers under Contacts first.',
    customer_ref: 'Their order or requisition number – printed on the order and invoice so they can match it.',
    order_date: 'Date of the quotation.',
    valid_until: 'Prices are guaranteed until this date. After it the quotation shows as expired.',
    delivery_date: 'When you will deliver or when the event is (weddings, funerals, functions).',
    notes: 'Short note printed on the document, e.g. "Delivery to Mafeteng included".',
    terms: 'Payment and delivery terms printed at the bottom, e.g. deposit, validity, delivery.'
  },
  rule: {
    name: 'What staff and customers see on the till slip, e.g. "Happy hour", "Meat Monday", "Wholesale price".',
    kind: '% off, an amount off each item, a special price (incl. VAT), or multi-buy such as "buy 3, 1 free".',
    value: '% off: the percentage. Amount off: maloti off each item. Special price: the new shelf price incl. VAT.',
    min_qty: 'Only applies when at least this many are bought (e.g. bulk price from 10). For multi-buy: how many make up the deal (3 in "3 for 2").',
    free_qty: 'Multi-buy only: how many of those are free (1 in "3 for 2").',
    applies_to: 'One product, a whole category (e.g. all Beers), or everything in the shop.',
    product_id: 'The product on promotion.', category_id: 'Every product in this category gets the deal.',
    customer_scope: 'Everyone, only customers with a tag (e.g. wholesale, staff, vip – set tags in Contacts), or one specific customer.',
    partner_tag: 'Customers with this tag in Contacts get the deal, e.g. wholesale.',
    partner_id: 'Only this customer gets the deal – choose the customer on the till.',
    time_from: 'Happy hour start. Leave both times empty for all day.', time_to: 'Happy hour end (can pass midnight, e.g. 22:00 → 02:00).',
    date_from: 'First day of the promotion (blank = from now).', date_to: 'Last day (blank = no end).',
    on_pos: 'Apply automatically at the till.', on_invoice: 'Apply automatically on quotations and orders.',
    active: 'Untick to pause the promotion without deleting it.'
  },
  statement: {
    account_code: 'Which account the statement is for: your bank account, the M-Pesa/EcoCash merchant wallet, card settlements, or the cash drawer.',
    name: 'A name to find it again, e.g. "SLB current – October 2026".',
    opening_balance: 'Balance at the start of the statement (optional – for checking).',
    closing_balance: 'Balance at the end of the statement. When everything is matched, the books should show the same.',
    partner_id: 'For customer payments and supplier payments: who paid or was paid.',
    description: 'What appears in the ledger for this entry.'
  },
  claim: {
    description: 'What was bought and why, e.g. "Taxi to bank with takings", "Cleaning materials".',
    amount: 'Total on the slip including VAT.',
    claim_date: 'Date printed on the slip.',
    account_code: 'Expense category for the books – fuel, transport, repairs, airtime, general.',
    tax_rate: '15 if the slip is a tax invoice showing VAT from a VAT-registered supplier; otherwise 0.',
    supplier: 'Where it was bought.',
    paid_by: 'Your own money: the shop pays you back after approval. Shop money: petty cash or the business card was used.',
    company_method_id: 'Which of the shop\'s money paid – cash drawer, bank card, M-Pesa…'
  },
  approvals: { po_limit: 'Staff can still create bigger orders, but a manager must approve them before goods are received. 0 switches this off.' },
  attendance: {
    user_id: 'The staff member whose shift this is.',
    check_in: 'Date and time the shift started.', check_out: 'Date and time it ended. Leave empty if they are still at work.',
    note: 'Why it was added or changed – kept for the record.',
    weekly_hours: 'Normal working hours per week before overtime. Lesotho Labour Code: 45.',
    daily_hours: 'Normal hours per day before overtime (9 for a 5-day week, 8 for a 6-day week).',
    overtime_rate: 'Overtime pay as a multiple of the normal hourly rate (Labour Code: at least 1.25).',
    max_shift_hours: 'If someone forgets to clock out, the shift is closed after this many hours and flagged for correction.'
  },
  department: { name: 'e.g. Butchery, Front shop, Kitchen, Admin.' },
  sms: {
    mode: '"Through my SMS provider" sends real SMS. "Test mode" writes messages to the log only – use it to try reminders without paying.',
    method: 'Your provider\'s instructions say whether to call the link (GET) or post data (POST).',
    url: 'Copy the address from your provider\'s API page and put {to} where the phone number goes, {message} where the text goes and {sender} for the sender name. Usually includes your username and API key.',
    body: 'Only for POST providers: the data to send, with the same {to} {message} {sender} placeholders. Starting with { sends it as JSON.',
    headers: 'Only if the provider asks for it, e.g. "Authorization: Bearer YOUR-KEY".',
    sender: 'Name shown instead of a number (max 11 letters) – most providers must approve it first.',
    success_text: 'A word the provider\'s answer contains when the SMS was accepted (e.g. OK or "status":"success"). Leave blank if unsure.',
    country_code: 'Added in front of 8-digit local numbers. 266 for Lesotho.'
  },
  remtpl: { sms: 'Short and polite. {details} adds the flat or the children\'s names.', email_subject: 'Subject line.', email_body: 'Longer text for email.' },
  remauto: { enabled: 'Tick to send reminders every day by themselves.', days: 'Days after the due date, separated by commas. A customer gets at most one reminder on each of these days.',
    channel: 'SMS reaches people fastest; email is free.', min_amount: 'Do not chase very small amounts.' },
  building: {
    name: 'e.g. "Mokhele Flats, Ha Thetsane" or "Kingsway Shopping Centre".', address: 'Physical address – printed on tenant statements.',
    owner_id: 'Choose the landlord when you collect rent on their behalf. Rent then belongs to them (minus your commission) instead of being your income. Add landlords under Contacts as suppliers.',
    commission_pct: 'Your management fee as a % of rent collected, e.g. 10.', notes: 'Caretaker, municipal account numbers, insurance…'
  },
  unit: {
    name: 'e.g. "Flat 3", "Room 12", "Shop 4".', kind: 'Homes are usually without VAT; shops and offices carry VAT if you are registered.', bedrooms: 'For flats and houses.', size_m2: 'Floor area – useful for shops and offices.',
    market_rent: 'Asking rent – suggested when you make a lease.', meter_no: 'Prepaid electricity or water meter number of the unit.', notes: 'Condition, furniture, parking bay…', active: 'Untick a unit that is demolished or not let any more.'
  },
  lease: {
    unit_id: 'The flat, room or shop being let.', tenant_id: 'The person or company who pays. Or type a new tenant below.',
    tenant_name: 'Full name as on their ID or company registration.', tenant_phone: 'For reminders and statements.',
    start_date: 'First day of the lease. If it is not the rent due day, the first part-month is invoiced pro rata.',
    end_date: 'Leave blank for month-to-month. Rent stops being invoiced after this date.',
    rent: 'Monthly rent excluding VAT.', tax_rate: '0 for residential rent. 15 for commercial units if you are VAT-registered.',
    due_day: 'Day of the month rent is due (1–28). The invoice is made on this day every month.',
    deposit: 'Deposit agreed in the lease (usually one month\'s rent). Record it as received on the lease once paid.',
    escalation_pct: 'Yearly rent increase, e.g. 10. Applied automatically on the anniversary.', next_escalation: 'Date of the next increase.', notes: 'Special conditions.'
  },
  leasepay: { amount: 'Amount received. It pays the oldest unpaid rent first; any extra stays as credit for next month.', method_id: 'How the money came in.', reference: 'Bank or M-Pesa transaction number – needed for bank recon.', date: 'Date the money was received.' },
  leasecharge: { description: 'e.g. "Water October 2026", "Late payment fee", "Replace lost key".', amount: 'Amount excl. VAT.', tax_rate: 'Usually 0 for recharged utilities.', pass_to_owner: 'Tick when this money belongs to the landlord (e.g. his municipal charges).' },
  deposit: { to_arrears: 'Part of the deposit used to pay rent the tenant still owes.', deductions: 'Repairs, cleaning or lost keys – becomes other income.', reason: 'Required when you deduct: what was damaged.', refund: 'Paid back to the tenant.', method_id: 'How the refund is paid.' },
  sclass: { name: 'e.g. "Grade 1A".', grade: 'Fees are set per grade, so Grade 1A and 1B share "Grade 1".', sort: 'Order in lists.', teacher: 'Class teacher.', capacity: 'Maximum learners.', next_class_id: 'Where learners go at year-end. Blank = they graduate.' },
  fee: { name: 'e.g. Tuition, Lunch, Transport, Aftercare, Exam fee, Registration.', grade: 'Blank = all grades.', amount: 'Amount per period.', period: 'Which billing runs include it: a term run takes all "per term" fees, a month run all "per month" fees.',
    optional: 'Only learners ticked for it pay (set on the learner).', sibling_discount: 'Untick for fees that are not discounted for brothers and sisters (e.g. transport).', active: 'Untick to stop charging it.' },
  schoolset: { sibling_discount_pct: 'Discount for the 2nd and later child of the same parent (eldest pays full).', post_invoices: 'Posted invoices count as owed at once. Untick to check drafts first.' },
  feerun: { label: 'A unique name – e.g. "Term 1 2027". The same name cannot be billed twice.', period: 'Which fees to bill.', invoice_date: 'Date on the invoices.', due_date: 'Date by which parents must pay – arrears ageing counts from here.' },
  learner: {
    first_name: 'As on the birth certificate.', last_name: 'Surname.', class_id: 'Current class.', admission_no: 'Leave blank to number automatically.', gender: 'For class lists.', birth_date: 'Siblings are ordered by age for the sibling discount (eldest pays full).',
    guardian_id: 'Parent who pays. Brothers and sisters share the same parent so they get one family account.', guardian_name: 'New parent\'s full name.', guardian_phone: 'Phone for fee reminders.',
    guardian2: 'Other parent or emergency contact with phone.', bursary_pct: 'Scholarship or staff-child discount on compulsory fees, e.g. 50.', enrolled_on: 'First day at the school.', medical: 'Allergies, chronic conditions, medication.', notes: 'Anything else.'
  },
  feepay: { amount: 'Amount paid. It clears the oldest fees first; extra is kept as credit.', method_id: 'How it was paid.', reference: 'Bank deposit or M-Pesa number.', date: 'Date paid.', family: 'Spread the payment over all this parent\'s children.' },
  site: {
    name: 'e.g. "LNDC Kingsway – main gate" or "Queen II Hospital – ward block".', partner_id: 'The client who pays.', kind: 'Security, cleaning, or both.',
    address: 'Where staff must report – include directions for relief staff.', contact_name: 'Client\'s person on site.', contact_phone: 'Their phone.',
    staff_day: 'Guards / cleaners needed by day.', staff_night: 'Needed at night.',
    billing: 'Contract: a fixed monthly amount (Contracts). Per shift / per hour: invoiced from the shifts actually worked.', rate: 'Price per shift or per hour excl. VAT.',
    contract_id: 'The contract that invoices this site – its income shows in site profit.', instructions: 'Post orders: keys, alarm codes procedure, patrol times, who may enter…',
    checklist: 'For cleaning (or guard post) inspections, one item per line: "Toilets cleaned", "Bins emptied"…', active: 'Untick when the contract ends.'
  },
  roster: { from: 'First day.', to: 'Last day (up to two months).', start_time: 'Shift start.', end_time: 'Shift end. A time earlier than the start means the shift ends the next morning (night shift).', role: 'Post on this site.' },
  absent: { reason: 'Sick, no-show, leave, AWOL…', replacement_id: 'Relief guard or cleaner sent instead – a shift is created for them.' },
  oblog: { kind: 'Patrol, visitor or vehicle in/out, handover between shifts, or any note.', employee_id: 'Who made the entry.', text: 'What was seen or done, e.g. "Patrol 02:00 – all doors locked".' },
  incident: { occurred_at: 'When it happened.', kind: 'Type of incident.', severity: 'High = injury, loss of property or police involved.', employee_id: 'Guard who reported it.', description: 'Facts: who, what, where, when.',
    action_taken: 'What the guard / supervisor did.', police_case: 'CR number from the police station.', client_informed: 'Tick once the client has been told.', status: 'Close when handled.' },
  inspection: { signed_by: 'Name of the client\'s person who checked with you.', notes: 'Anything to follow up.' },
  siteinv: { from: 'First day of the shifts to invoice.', to: 'Last day.' },
  lead: {
    title: 'What they want, e.g. "Uniforms for 120 learners" or "Monthly cleaning – LNDC offices".',
    partner_id: 'Pick the customer if they are already in Contacts. A new customer is made from the details below when you quote or win.',
    company: 'Company, school, church or government office.', contact_name: 'The person you deal with.', phone: 'Number to call or WhatsApp.', email: 'For sending the quotation.',
    source: 'How they found you – the pipeline shows which sources bring the most business.',
    stage_id: 'How far the deal is. Move the card on the pipeline board as it progresses.',
    expected_value: 'What the order will be worth if you win it (incl. VAT).',
    probability: 'Your own estimate. Leave blank to use the stage\'s chance.',
    expected_close: 'When the customer will decide.', owner_id: 'Salesperson responsible for following up.',
    priority: 'Hot leads are shown with three stars.', notes: 'Their needs, budget, decision-makers and competitors.'
  },
  activity: { type: 'Call, meeting, visit or to-do.', due_at: 'When it should happen – overdue steps show ⚠ on the pipeline.', subject: 'e.g. "Call about sizes", "Deliver samples".', body: 'Details or what was agreed.' },
  contract: {
    partner_id: 'Who pays.', name: 'e.g. "Security – Ha Abia clinic", "Rent – Shop 4", "Grade 3 school fees 2027".',
    period: 'How often an invoice is made.', every: '1 = every period. 2 with "Month" = every second month.',
    start_date: 'Date of the first invoice. Dates in the past are caught up when you activate the contract.',
    end_date: 'Last day of the contract. No invoices are made after it; blank = runs until you end it.',
    next_date: 'Date the next invoice will be made. Change it to skip or move a period.',
    due_days: 'Days the customer has to pay (sets the due date on each invoice).',
    auto_post: 'Ticked: invoices are posted at once (customer owes the money). Unticked: they wait as drafts for you to check and post.',
    project_id: 'Link the invoices to a project so they count in its profit.', notes: 'Anything about the agreement – escalation, notice period…'
  },
  equipment: {
    name: 'What staff call it, e.g. "Oven 2", "Spiral mixer", "Generator", "Toyota Quantum A 1234".',
    code: 'Your asset number or sticker on the machine.',
    category: 'Group, e.g. Bakery, Workshop, Vehicles, Power.',
    serial_no: 'From the rating plate – needed for warranty claims and spare parts.',
    location_id: 'Branch or site where the machine stands.',
    supplier_id: 'Who sold it or services it – shown when you need a repairer.',
    purchase_date: 'Date bought.', cost: 'What it cost – for insurance and the asset register.',
    warranty_until: 'Last day of the warranty. Check this before paying for a repair.',
    interval_days: 'Service every … days (e.g. 90). The next service date moves forward each time a job is finished. Blank = no planned servicing.',
    last_service: 'When it was last serviced.', next_service: 'When the next service is due. Filled from the interval when left blank.',
    status: 'Broken down = cannot be used; work orders on it ask before starting.', notes: 'Anything useful: oil type, filter numbers, technician\'s phone.'
  },
  mreq: {
    equipment_id: 'The machine with the problem.',
    priority: 'Urgent = production has stopped. High = still working but getting worse.',
    title: 'One line, e.g. "Belt slipping, mixer stops" or "Oven does not reach 200°C".',
    description: 'What happened, when, any noises or error codes.',
    machine_down: 'Tick when the machine must not be used. It shows as broken down until the job is finished.',
    kind: 'Repair = something broke. Planned service = routine servicing.',
    assigned_to: 'The technician who will do the work.', scheduled_date: 'When the work is planned.',
    resolution: 'What was done, e.g. "Replaced both V-belts and tensioned".',
    labour_cost: 'Technician\'s time in Maloti (for the machine\'s cost history).',
    external_cost: 'What an outside repairer charged (book their bill under Supplier bills).',
    downtime_hours: 'How many hours the machine could not be used. Blank = worked out from when it was reported.'
  },
  rfq: {
    deadline: 'Date by which suppliers should send their prices.',
    notes: 'Delivery address, payment terms, "prices must include delivery"…',
    lead_days: 'How many days after ordering the supplier will deliver – sets the expected date on the purchase order.'
  },
  project: {
    name: 'e.g. "Office network – Ha Abia clinic" or "Extension to Thabo\'s house".',
    code: 'Short reference used on timesheets and invoices. Made automatically when blank.',
    partner_id: 'The customer who pays. Leave blank for internal projects.',
    billing: 'By the hour: logged hours × rate are invoiced. Fixed price: you invoice progress amounts or % of the contract. Not billed: internal work (hours are still costed).',
    hourly_rate: 'Price per hour charged to the customer, excl. VAT.',
    budget_hours: 'Hours you expect it to take – the project warns when they are used up.',
    budget_amount: 'Contract value (fixed price) or spending budget.',
    manager_id: 'Can add tasks and change the project even without full project rights.',
    start_date: 'When work starts.', end_date: 'Deadline promised to the customer.', status: 'Finished and cancelled projects stop accepting hours from staff.',
    description: 'Scope of work – what is and is not included.'
  },
  task: {
    title: 'A piece of work someone can finish, e.g. "Run cables to 6 offices".',
    assigned_to: 'Who does it. It appears under their "My tasks & hours".', status: 'To do → Busy → To check → Done.',
    priority: 'Urgent and high tasks are listed first.', due_date: 'When it must be finished.',
    estimate_hours: 'Expected hours – compared with hours logged.', description: 'Details, materials, contact person on site.'
  },
  timesheet: {
    work_date: 'Day the work was done (not in the future).', hours: 'Hours worked, e.g. 1.5 for an hour and a half.',
    project_id: 'Project the time was for.', task_id: 'Task within the project (optional).',
    description: 'What was done – printed for the customer on hourly invoices.',
    billable: 'Untick for time the customer does not pay for (travel, re-work, warranty).'
  },
  projinv: {
    to: 'All billable hours up to this date that are not invoiced yet go on the invoice.',
    percent: 'Percentage of the contract value to invoice now, e.g. 30 for a deposit.',
    amount: 'Or type the amount excl. VAT instead of a percentage.', description: 'Text on the invoice line, e.g. "Progress payment 2: roof".'
  },
  ticket: {
    subject: 'Short description, e.g. "Laptop does not charge" or "Printer jams".',
    partner_id: 'Choose if the customer is in Contacts; otherwise fill in the name and phone – a contact is made when you invoice.',
    contact_name: 'Person to talk to.', phone: 'Number to call or WhatsApp when it is ready.', email: 'For replies by email.',
    kind: 'Repair = item booked in (job card). Problem / question / request = support without an item.',
    channel: 'How the customer contacted you.', priority: 'Sets the deadline to respond (see Helpdesk → Settings).',
    assigned_to: 'Technician responsible.', item: 'Make and model, e.g. "HP 250 G8 laptop, black".',
    serial_no: 'Serial number or phone IMEI (*#06#) – proves it is the same item when collected.',
    project_id: 'Link to a project or support contract so the time counts there.',
    description: 'The problem in the customer\'s own words, plus accessories left with the item.',
    callout: 'Fixed fee added to the invoice for coming out to the customer.'
  },
  hdsettings: {
    labour_rate: 'Charged per hour for repairs when the time is not on an hourly project.',
    sla_urgent: 'Hours within which an urgent ticket must get a first answer.', sla_high: 'Hours for high-priority tickets.',
    sla_normal: 'Hours for normal tickets (24 = next day).', sla_low: 'Hours for low-priority tickets.'
  },
  bom: {
    product_id: 'The finished product this recipe makes. It must be a stocked product so made goods are counted.',
    name: 'e.g. "Standard 50-loaf mix" or "Version 2". Keep the old one when a recipe changes – archive it instead of deleting.',
    output_qty: 'How much one batch makes, in the finished product\'s unit – e.g. 50 loaves, 1 000 bricks, 20 kg of sausage.',
    code: 'Your own reference, e.g. a drawing or recipe number.',
    labour_cost: 'Wages for one batch: people × hours × hourly rate. Moved from expenses into the stock value when the batch is finished.',
    overhead_cost: 'Electricity, gas, machine wear and packaging not listed as components – an estimate per batch.',
    minutes: 'How long one batch takes – used for planning.',
    shelf_life_days: 'Fills the best-before date of each batch automatically. Leave blank for goods that do not expire.',
    instructions: 'Method, mixing times, oven temperature, safety notes – printed on the job card.'
  },
  wo: {
    bom_id: 'The product and recipe to make. Component quantities are scaled to the quantity below.',
    qty: 'How much to make. Materials needed = recipe quantity × (this ÷ batch size) + expected waste.',
    planned_date: 'When production should happen – the open list is sorted by this date.',
    location_id: 'Where it is made: materials are taken from, and finished goods go into, this location.',
    notes: 'Customer order, special instructions…',
    equipment_id: 'Machine used. If it is broken down, starting the work order asks first.',
    qty_produced: 'Good units that can be sold. They go into stock now.',
    qty_rejected: 'Spoilt or failed units. Their share of the cost is written off as production rejects.',
    batch_no: 'Printed on labels for traceability. Leave blank to number it automatically.',
    expiry_date: 'Best-before date. Filled from the recipe\'s shelf life when left blank.',
    qc_status: 'Result of the quality check. "Failed" means nothing may be put into stock – record everything as rejected.',
    qc_notes: 'What was checked: weight, colour, strength, taste, measurements…',
    labour_cost: 'Actual wages for this run (planned amount filled in).',
    overhead_cost: 'Actual overhead for this run (planned amount filled in).'
  },
  location: {
    name: 'How staff know this place, e.g. "Maseru main shop", "TY branch", "Ha Hoohlo warehouse", "Van 1 (A 1234)".',
    code: 'Short code printed on transfers and reports, e.g. MSU, TY, WH1. Letters and numbers only; made from the name if left blank.',
    kind: 'Shop / branch = sells to customers. Warehouse = store room that supplies shops. Van = mobile stock for deliveries or route sales. Farm / site = a farm store or a building site that uses materials.',
    address: 'Physical address – printed on transfer notes so drivers know where to deliver.',
    phone: 'Phone number of the person in charge here.',
    sellable: 'Untick for store rooms that never sell directly; their stock is then not offered at tills.',
    is_default: 'Stock is booked here when no other place is chosen (opening stock, purchases without a branch, older tills). Exactly one location is the default.',
    active: 'Untick to close a location. Only possible once it has no stock left and no tills linked to it.'
  },
  transfer: {
    from_location_id: 'Where the goods leave from. The stock goes down here as soon as you click Send.',
    to_location_id: 'Where the goods are going. The stock only goes up here once the receiving branch clicks Receive.',
    notes: 'Driver, vehicle registration or reason – printed on the transfer note.',
    allow_negative: 'Send even if the system thinks there is not enough stock at the source (for example when stock was not counted in yet). The source goes negative until it is corrected.'
  },
  locstock: {
    min_qty: 'Re-order level for this branch: when stock here falls below it, it shows as "low" so a transfer or purchase can be made.',
    bin: 'Shelf, aisle or bin where it is kept at this location, e.g. "A3" – printed on transfer notes to speed up picking.'
  },
  roomtype: {
    name: 'Kind of room, e.g. "Standard double", "Family room", "Rondavel". Rooms of one type share a rate.',
    rate: 'Price per night including VAT. Change it here and new bookings use the new rate; existing bookings keep theirs.',
    capacity: 'How many people can sleep in this room type – shown when booking.',
    breakfast: 'Tick if breakfast is part of the rate (printed on the guest bill).',
    active: 'Untick to stop offering this room type without losing its history.'
  },
  room: {
    name: 'Room number or name as guests know it, e.g. "12" or "Maloti Suite".',
    room_type_id: 'Type and rate of this room.',
    floor: 'Floor, block or wing – helps housekeeping.',
    housekeeping: 'Clean = ready for the next guest. Rooms become "dirty" automatically at check-out. "Out of order" rooms cannot be booked.',
    notes: 'Anything the front desk should know, e.g. "no hot water on Monday".',
    active: 'Untick if the room is no longer let.'
  },
  booking: {
    check_in: 'Day the guest arrives.',
    check_out: 'Day the guest leaves – nights are counted up to, but not including, this day.',
    room_id: 'Only rooms free for all the nights are listed. Change the dates to see other rooms.',
    rate: 'Price per night incl. VAT – taken from the room type, but you can give a discount or a special rate here.',
    guest_id: 'Returning guest – choose them so the stay is added to their history. For a new guest leave this and type the name below.',
    guest_name: 'Full name of a new guest – a customer card is made automatically.',
    guest_phone: 'Mobile number – used for SMS confirmations and reminders.',
    adults: 'Number of adults staying.',
    children: 'Number of children staying.',
    source: 'How the booking came in – shows which channel brings the most guests.',
    company_id: 'If a company or government department pays for the stay, choose it: the bill is invoiced to them on account at check-out.',
    notes: 'Arrival time, special requests, car registration…',
    check_in_now: 'Walk-in guest who is already at the desk – the booking is checked in straight away.'
  },
  bookpay: {
    amount: 'Amount received now. A deposit is kept on the guest\'s account and taken off the bill at check-out.',
    method_id: 'How the money came in – it goes into that till, bank or M-Pesa account.',
    reference: 'M-Pesa / EcoCash code, EFT reference or receipt number.'
  },
  roomcharge: {
    description: 'What is being charged to the room: laundry, phone, minibar, extra bed, late check-out…',
    amount: 'Amount including VAT. Meals and drinks from the POS are charged to the room by choosing "Room / guest account" at the till instead.',
    date: 'Day of the charge – printed on the guest bill.'
  },
  patient: {
    first_name: 'As on the ID or health passport (bukana).',
    dob: 'Date of birth – the age is worked out and printed on prescriptions and labels. For a child, the dose often depends on it.',
    phone: 'Mobile number for follow-up and payment reminders.',
    id_number: 'National ID or passport – helps find the right file when names are the same.',
    allergies: 'Medicines or foods the patient reacts to, separated by commas, e.g. "Penicillin, sulpha". Medicines of that group are blocked when prescribing until a practitioner confirms. Type "None known" if asked and there are none.',
    chronic: 'Long-term conditions and medicines, e.g. "Hypertension – amlodipine 5 mg; HIV on ART". Shown on every visit.',
    medical_aid_id: 'Medical aid that pays for this patient. Add medical aids under Patients → Medical-aid claims.',
    medical_aid_no: 'Membership number exactly as on the card – the claim is rejected without it.',
    main_member: 'Name of the main member if the patient is a dependant (child or spouse).',
    blood_group: 'If known, e.g. O+.',
    next_of_kin: 'Person to contact in an emergency.',
    species: 'Vets: species, breed and the animal\'s name; the owner is the patient\'s contact.',
    file_no: 'Your existing paper file number, or leave blank for an automatic number (P00001…).',
    notes: 'Anything reception should know – not for clinical notes.'
  },
  arrival: {
    kind: 'Consultation with a doctor or nurse, a follow-up, a procedure (dressing, injection) or pharmacy only (buying medicine or collecting a repeat).',
    practitioner_id: 'Who the patient will see. Leave blank and the first practitioner to call them in takes them.',
    reason: 'Why the patient came, in their words, e.g. "cough for 2 weeks".',
    temp: 'Temperature in °C, e.g. 36.8. Above 37.5 is a fever.',
    bp_sys: 'Top number of the blood pressure, e.g. 120.',
    bp_dia: 'Bottom number, e.g. 80.',
    pulse: 'Heart beats per minute.',
    resp: 'Breaths per minute.',
    spo2: 'Oxygen saturation from the finger probe, %.',
    weight: 'Weight in kg – needed for children\'s doses.',
    height: 'Height in cm – BMI is worked out with the weight.',
    glucose: 'Finger-prick blood sugar in mmol/l.'
  },
  visit: {
    reason: 'Main complaint.',
    history: 'History of the complaint, other illnesses, medicines taken.',
    exam: 'What you found on examination.',
    diagnosis: 'Diagnosis or what was done – required to finish a consultation and printed on the medical-aid claim.',
    icd10: 'ICD-10 code, e.g. J06.9 (upper respiratory infection), I10 (hypertension). Most medical aids require it.',
    plan: 'Treatment plan, advice and tests ordered.',
    sick_note_days: 'Days off work or school – a medical certificate can then be printed.',
    follow_up: 'Date the patient should come back.'
  },
  visititem: {
    product_id: 'Choose from your products. Medicines are stock items (with batches and expiry); consultations and procedures are service products.',
    qty: 'How many units are handed over – tablets, capsules, bottles or tubes. Stock goes out when the visit is billed.',
    dosage: 'Directions printed on the label, in words the patient understands, e.g. "Take 2 tablets 3 times a day after meals".',
    duration: 'How long to take it, e.g. "5 days" or "until finished".',
    description: 'A service that is not in the list, e.g. "Wound dressing".',
    unit_price: 'Leave blank to use the price on the product.'
  },
  visitbill: {
    bill_to: 'The patient, or the medical aid on the patient\'s file. Medical-aid invoices appear under Medical-aid claims until paid.',
    copay: 'Part the patient pays themselves (levy, shortfall). It is billed to the patient and taken off the medical aid\'s invoice.',
    amount: 'What the patient pays now.',
    method_id: 'Cash, card, M-Pesa, EcoCash or bank.',
    reference: 'Mobile money or bank reference.',
    due_date: 'If the patient pays later – payment reminders use this date.'
  },
  medaid: {
    name: 'e.g. "LNIG Medical Aid", "Old Mutual", "Metropolitan", "Momentum".',
    phone: 'Claims department number.',
    email: 'Address claims and statements are sent to.'
  },
  clinicset: {
    practice_no: 'Practice number or pharmacy licence number – printed on prescriptions, certificates and claims.',
    practitioner_title: 'Printed under the signature, e.g. "Medical Practitioner" or "Registered Pharmacist".',
    label_note: 'Short warning on every medicine label, e.g. "Keep out of reach of children".'
  },
  hireitem: {
    name: 'What the customer hires, e.g. "Tent 10 × 20 m (stretch)", "Plastic chair white", "Scaffolding frame 2 m", "Concrete mixer 350 l".',
    code: 'Your own code or asset tag – handy on the hire agreement.',
    category: 'Group items for the lists and report, e.g. Tents, Chairs, Tables, Décor, Scaffolding, Plant.',
    qty_owned: 'How many you own. Bookings can never promise more than this (less any that are broken).',
    rate_day: 'Price per item per day including VAT. A hire from Friday to Monday is 3 days; same-day returns count as 1 day.',
    rate_week: 'Cheaper price for 7 days. The bill always uses the cheapest mix of day, week and month prices for the days out.',
    rate_month: 'Price for 30 days, for long hires like scaffolding on a building site.',
    deposit: 'Deposit per item. The deposit for an order is added up from its items (you can change it per order).',
    replacement_cost: 'What it costs you to replace one. Lost items are charged at this price.',
    qty_out_of_service: 'Damaged items waiting for repair – they cannot be booked until you mark them fixed.',
    track_maintenance: 'For machines (mixers, generators, compactors): also register it in Maintenance so services and breakdowns are tracked.',
    service_days: 'Service interval in days for the machine.',
    active: 'Untick when you no longer hire it out.'
  },
  hireorder: {
    start_date: 'Day the items leave (collected or delivered). If they leave on another day, the hand-over date is used for the bill.',
    end_date: 'Day the items should be back. Items stay booked until they are really back, even if late.',
    partner_id: 'Returning customer – choose them so the hire is on their account and history.',
    customer_name: 'Name of a new customer – a customer card is made automatically.',
    customer_phone: 'Mobile number – used for reminders and when items are late.',
    id_number: 'ID or passport number of the person who signs – printed on the hire agreement.',
    delivery_address: 'Where to deliver and set up; leave blank if the customer collects.',
    delivery_fee: 'Transport and set-up charged on the bill (incl. VAT).',
    deposit_required: 'Leave blank to use the deposit of the items, or type another amount (e.g. less for a regular customer).',
    notes: 'Set-up time, contact on site, colours, special requests.'
  },
  hirepay: {
    date: 'Day the items left your yard.',
    deposit: 'Deposit taken now. It is kept apart (not income) and set off against the bill when the items are back.',
    amount: 'Money received now.',
    method_id: 'How the money came in – cash, card, M-Pesa, EcoCash or bank.',
    reference: 'M-Pesa / EcoCash code, EFT reference or receipt number.',
    no_deposit_ok: 'Only for customers you trust – the system normally refuses to hand over without the full deposit.',
    refund_method_id: 'How the rest of the deposit is paid back.',
    keep_credit: 'The rest stays as credit on the customer\'s account for the next hire.',
    due_date: 'If the customer pays later, the invoice is due on this date (payment reminders use it).'
  },
  farmgroup: {
    name: 'e.g. "Layers house 1", "Broilers batch 12", "Merino flock", "Angora goats", "Dairy cows", "Sows".',
    kind: 'Livestock (cattle, sheep, goats, pigs), poultry, or other (bees, fish, rabbits).',
    species: 'Animal kind – used in reports and to suggest it for tagged animals.',
    purpose: 'What you keep them for – eggs, broilers, milk, beef, wool, mohair, breeding.',
    head_count: 'For flocks you do not tag one by one (chickens, a sheep flock): how many there are. Deaths recorded on the flock take it down. With tagged animals the count comes from them.',
    started_on: 'Date the flock was placed or the herd started – helps work out age (e.g. weeks in lay).',
    produce_id: 'The stock product daily production goes into, e.g. "Eggs – tray 30", "Milk (litre)", "Wool (kg)". Make it under Products first.',
    place: 'House, camp, kraal or cattle post.',
    notes: 'Supplier of the chicks / animals, vaccination programme…',
    active: 'Untick when the flock is sold out or the herd closed.'
  },
  animal: {
    tag: 'Ear tag, brand or tattoo number – must be unique. Use the government livestock ID where there is one.',
    name: 'Optional name, e.g. for a bull or dairy cow.', species: 'cattle, sheep, goat, pig…', breed: 'e.g. Merino, Dorper, Angora, Boer goat, Nguni, Bonsmara, Jersey.',
    sex: 'Female or male – only females can be given births.', birth_date: 'Exact or estimated birth date – age shows in the lists.',
    group_id: 'The herd or flock it runs with.', acquired: 'Born on the farm or bought in.', cost: 'Price paid when bought – part of the animal\'s cost.',
    weight: 'Last known weight. Weighings recorded later update it.', notes: 'Markings, temperament, health history.'
  },
  field: { name: 'e.g. "Lower field by the river", "Masimo a Ha Ramabanta".', size_ha: 'Size in hectares (1 ha = 100 m × 100 m).', place: 'Village or area.', irrigated: 'Tick if it can be watered.', notes: 'Soil type, last limed, rotation.', active: 'Untick a field no longer used.' },
  season: {
    field_id: 'The field it is planted in.', crop: 'e.g. maize, sorghum, wheat, beans, peas, potatoes, cabbage.', variety: 'Seed variety or supplier.',
    area_ha: 'Hectares planted (blank = the whole field).', planted_on: 'Date sown or planted.', expected_harvest: 'When you expect to harvest.',
    produce_id: 'Stock product the harvest goes into, e.g. "Maize 50 kg bag". Make it under Products first.', status: 'Planned, growing, harvested or failed (hail, drought…).', notes: 'Spacing, rainfall, problems.'
  },
  farmlog: {
    kind: 'Production = eggs collected, milk, wool or mohair shorn. Feed / vaccinate / treat / plant / fertilise / spray take the product out of stock. Harvest puts the crop into stock.',
    date: 'Day it was done – not in the future.', group_id: 'Herd or flock it was for.', animal_id: 'Or a single tagged animal.', season_id: 'Or the crop season.',
    product_id: 'What was used (feed, vaccine, dip, seed, fertiliser) or produced. Inputs come out of stock at cost – buy them through Purchasing.',
    qty: 'Amount used, in the product\'s unit (bags, doses, litres). For deaths in a flock: how many died.',
    produced_qty: 'How much was collected or harvested (trays, litres, kg, bags) – it goes into stock.',
    weight: 'Weight in kg.', cost: 'Wages, contractor (ploughing, shearing) or other cost paid outside stock.',
    next_due: 'When the next dose or vaccination is due – it then shows under Health due.', final: 'Tick on the last harvest so the season is closed.', note: 'Anything worth remembering.'
  },
  farmexit: { kind: 'Sold (an invoice is made to the buyer), died, or slaughtered.', date: 'Date.', partner_id: 'Buyer – add new buyers under Contacts.', amount: 'Selling price.', weight: 'Weight at sale or slaughter.', note: 'Cause of death, where it was sold…' },
  vehicle: {
    reg_no: 'Registration number exactly as on the licence disc, e.g. "A 123 BCD".',
    name: 'Optional nickname drivers use, e.g. "Blue Quantum".',
    kind: 'Type of vehicle – taxis and buses usually record daily takings, trucks and bakkies trips.',
    seats: 'Passenger seats – for buses and taxis charged per seat.',
    capacity_tons: 'How much it can carry – for trucks charged per ton.',
    odometer: 'Current kilometre reading. It goes up with every fuel fill, trip and takings entry and can never go back.',
    driver_id: 'Driver who normally drives it – filled in automatically on fuel, trips and takings. Drivers are added in HR as employees.',
    licence_expiry: 'Date the licence disc expires – shown in red on the Fleet screen 30 days before.',
    insurance_expiry: 'Date the insurance must be renewed.',
    fitness_expiry: 'Certificate of fitness (roadworthy) for public transport and trucks.',
    permit_expiry: 'Operating permit / route permit for taxis, buses and cross-border trucks.',
    service_days: 'Service interval in days – the vehicle is also a machine in Maintenance, which reminds you when a service is due.',
    status: 'In repair and on-trip vehicles cannot be sent on a new trip.',
    active: 'Untick when the vehicle is sold or written off.'
  },
  fuel: {
    litres: 'Litres put in, from the fuel slip.',
    amount: 'Rand/Maloti paid, from the slip. Booked as a fuel expense.',
    odometer: 'Kilometre reading at the pump – needed to work out km per litre.',
    full_tank: 'Tick when filled to full. km per litre is worked out between two full tanks, so keep it ticked unless it was only topped up.',
    station: 'Filling station, e.g. "Engen Maseru Mall".',
    method_id: 'How it was paid now (cash, fuel card on the bank, M-Pesa).',
    supplier_id: 'If the station gives you credit, choose it here instead – it is added to what you owe them and paid with the supplier bill.'
  },
  trip: {
    vehicle_id: 'Vehicle doing the trip – it must be available when it leaves.',
    driver_id: 'Leave blank to use the vehicle\'s usual driver.',
    from_place: 'Loading point or departure town.',
    to_place: 'Destination, e.g. "Johannesburg City Deep".',
    partner_id: 'Customer who pays for the trip. Finished trips of one customer can be put on one invoice together.',
    load_desc: 'What is carried, e.g. "30 bags cement" or "school trip 45 learners".',
    charge_by: 'How the customer pays: a fixed price per trip, per km driven, per ton, per seat or per day of hire.',
    qty: 'Number of units charged (tons, seats, days). For per-km trips the km driven are filled in when the vehicle returns.',
    rate: 'Price per unit excluding VAT – VAT is added on the invoice.',
    costs: 'Tolls, border fees, permits and driver allowances paid for this trip – shows the real profit per trip.',
    return_date: 'Day it is expected or came back.'
  },
  takings: {
    amount: 'Cash or M-Pesa the driver handed in for the day. Booked as transport income.',
    driver_id: 'Driver who worked the vehicle that day – one entry per vehicle, driver and day.',
    method_id: 'Where the money went – cash box, bank or mobile money.',
    trips: 'Number of loads or trips done – shows takings per trip over time.',
    odometer: 'Kilometre reading at the end of the day (optional).',
    notes: 'Anything short, e.g. "short M50 – breakdown at Mafeteng".'
  },
};

// Plugin settings – keyed by config key (shared by the plugins that use the same key)
export const PLUGIN_HELP = {
  base_url: 'API address from your provider (e.g. My Wallet), e.g. https://api.provider.co.ls/v1.',
  auth_type: 'How the provider checks who you are – see their API documentation (API key header, bearer token or username/password).',
  api_key: 'The secret key the provider issued to your business. Keep it private.',
  api_key_header: 'Name of the HTTP header that carries the key, e.g. X-API-Key.',
  username: 'API username from the provider (only for username/password authentication).',
  password: 'API password from the provider.',
  merchant_id: 'Your merchant / agent number with the provider.',
  commission_pct: 'Commission you earn on each sale, in percent – used to book your income.',
  services_json: 'List of services (airtime, electricity, data…) and their provider codes, as JSON. Your provider\'s documentation lists the codes.',
  purchase_method: 'HTTP method for a purchase – usually POST.',
  purchase_path: 'Path appended to the API address for a purchase, e.g. /purchase.',
  purchase_body: 'Request body template for a purchase; {service}, {account}, {amount} and {reference} are filled in.',
  lookup_path: 'Path to check a meter/phone number before selling (optional).',
  lookup_body: 'Request body for the lookup.',
  lookup_name_field: 'Field in the reply that holds the customer name to show the cashier.',
  status_path: 'Path to check a pending transaction.',
  balance_path: 'Path that returns your float/wallet balance.',
  balance_field: 'Field in the reply that holds the balance.',
  success_field: 'Field in the reply that says whether the purchase worked, e.g. status.',
  success_values: 'Values of that field meaning success, comma separated, e.g. SUCCESS,00.',
  pending_values: 'Values meaning "still processing", e.g. PENDING.',
  ref_field: 'Field with the provider\'s transaction reference – printed on the receipt.',
  token_field: 'Field with the electricity token – printed big on the receipt.',
  message_field: 'Field with a message to show the cashier.',
  commission_field: 'Field with the commission the provider paid (optional).',
  timeout_ms: 'How long to wait for the provider, in milliseconds (30000 = 30 seconds).',
  latency_ms: 'Sandbox only: simulated delay in milliseconds.',
  approve_after_ms: 'Sandbox only: how long before the simulated customer approves the payment.',
  issuer_id: 'Your Issuer ID from the Google Pay & Wallet Console.',
  service_account_email: 'Email of the Google Cloud service account allowed to create passes.',
  private_key: 'The service account\'s private key (from its JSON key file). Keep it secret.',
  class_suffix: 'Name of the pass class you created in the Wallet Console.',
  logo_url: 'Public https link to your logo for the wallet pass.',
  background_color: 'Pass colour, e.g. #3f3d9e.',
  button_label: 'Text on the "Add to wallet" button on the digital receipt page.',
  card_id: 'Card ID from the Samsung Wallet Partner Portal.',
  certificate_id: 'Certificate ID from the Samsung Wallet Partner Portal.',
  link_template: 'Samsung "Add to Wallet" link format – leave the default unless Samsung tells you otherwise.'
};
