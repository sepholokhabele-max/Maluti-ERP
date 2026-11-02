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
    mode: 'Retail: scan and pay. Restaurant: tables, floors and kitchen tickets. Bar: open tabs. Butchery tills use Retail.'
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
  department: { name: 'e.g. Butchery, Front shop, Kitchen, Admin.' }
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
