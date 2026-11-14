// Templates for policies (per department) and legal documents (Lesotho), with {{placeholders}} filled from S-ERP data.
// They are starting points written for Lesotho businesses; laws referred to were current when written (Labour Act, 2024;
// Companies Act, 2011; Data Protection Act (Act No. 5 of 2012); Public Procurement Act, 2023 and Regulations, 2025;
// Business Licensing and Registration Act, 2019; Income Tax Act, 1993; Value Added Tax Act, 2001; Workmen's Compensation
// Act, 1977). Every document should be reviewed by a Lesotho legal practitioner before it is signed or adopted.
const NOTE = '<p class="tpl-note"><i>Template – review with a Lesotho legal practitioner before use, and check that the laws referred to have not been amended.</i></p>';
const sec = (h, body) => `<h2>${h}</h2>${body}`;
const ul = items => `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
const ol = items => `<ol>${items.map(i => `<li>${i}</li>`).join('')}</ol>`;

/* ============================== policies ============================== */
function policy(title, purpose, scope, sections, law) {
  return `<h1>${title}</h1><p><b>{{company.name}}</b> · Policy owner: {{policy.owner}} · Approved by: {{policy.approver}} · Effective: {{policy.effective}} · Review: every {{policy.review_months}} months</p>
${sec('1. Purpose', `<p>${purpose}</p>`)}${sec('2. Scope', `<p>${scope}</p>`)}
${sections.map(([h, b], i) => sec(`${i + 3}. ${h}`, b)).join('')}
${sec(`${sections.length + 3}. Breaches`, '<p>A breach of this policy may lead to disciplinary action under the Disciplinary Code, and where the law is broken, to a report to the authorities.</p>')}
${law ? sec(`${sections.length + 4}. Related laws and documents`, ul(law)) : ''}
${sec(`${sections.length + (law ? 5 : 4)}. Review`, '<p>This policy is reviewed at least every {{policy.review_months}} months, or sooner when the law or the business changes. Changes are approved under the Delegation of Authority.</p>')}${NOTE}`;
}
const POLICIES = {
  governance: { name: 'Governance & ethics', items: {
    doa: { title: 'Delegation of Authority Policy', html: () => policy('Delegation of Authority Policy',
      'To set out who may approve which transactions and decisions, up to what amount, so that every commitment of {{company.name}} is authorised at the right level.',
      'All staff, managers, the Chief Executive and the Board, for every financial and non-financial decision listed below.',
      [['Principles', ul(['Authority is given to <b>positions</b> in the organogram, not to individuals. A person acting in a position has its authority for the period of acting.', 'Nobody approves their own request, expense, purchase or leave.', 'A higher position in the same reporting line may approve within its own limit. Requests waiting longer than the escalation period go to the next level.', 'Authority may not be split: one requirement may not be divided to stay under a limit.', 'Where a "concurrence" is required (for example Finance), it is obtained before the final approval.'])],
        ['Approval limits (from S-ERP)', '{{doa_table}}'], ['Decision rights', '{{decision_table}}'],
        ['Records', '<p>Every approval is recorded in S-ERP with the person, position, date and time. The Board approves changes to this policy.</p>']],
      ['Companies Act, 2011 (directors\' duties)', 'Public Procurement Act, 2023 and Public Procurement Regulations, 2025 (public bodies)', 'Procurement Policy; Financial Management Policy']) },
    conduct: { title: 'Code of Conduct and Ethics', html: () => policy('Code of Conduct and Ethics',
      'To set the standards of behaviour expected of everyone who works for {{company.name}}.', 'All employees, directors, contractors and temporary staff.',
      [['Our standards', ul(['Act honestly and with integrity; never use your position for personal gain.', 'Treat customers, colleagues and the public with respect; no discrimination or harassment.', 'Protect company property, money, information and personal data.', 'Obey the law and company policies; report anything that is not right.', 'Avoid conflicts of interest and declare them when they arise.'])],
        ['Use of company resources', '<p>Company vehicles, equipment, systems, phones and funds are for company business. Limited private use may be allowed by your manager in writing.</p>'],
        ['Confidentiality', '<p>Information about customers, staff, prices and plans is confidential during and after employment, except where the law requires disclosure.</p>'],
        ['Reporting concerns', '<p>Report breaches to your manager, Human Resources, Internal Audit or under the Whistleblowing Policy. No one will be victimised for reporting in good faith.</p>']],
      ['Labour Act, 2024', 'Prevention of Corruption and Economic Offences Act, 1999', 'Data Protection Act (Act No. 5 of 2012)']) },
    coi: { title: 'Conflict of Interest Policy', html: () => policy('Conflict of Interest Policy',
      'To make sure decisions are made in the interest of {{company.name}} and not influenced by personal interests.', 'Directors, managers, employees and evaluation committee members.',
      [['What is a conflict of interest', '<p>Any situation where your private interest – or that of a family member, close friend or business partner – could influence, or appear to influence, a decision you make or take part in.</p>'],
        ['Declaring', ul(['Declare interests in writing to your manager (directors: to the Board) when they arise, and every year.', 'Members of tender evaluation committees declare in S-ERP before seeing any bid; a declared conflict removes the person from scoring.', 'Do not take part in a decision where you have a conflict.'])],
        ['Register', '<p>Human Resources keeps a register of declared interests; Internal Audit reviews it every year and compares suppliers with staff details.</p>']],
      ['Companies Act, 2011', 'Public Procurement Act, 2023', 'Procurement Policy']) },
    whistle: { title: 'Whistleblowing Policy', html: () => policy('Whistleblowing Policy',
      'To give staff and others a safe way to report suspected fraud, corruption, theft, unsafe practices or other wrongdoing.', 'Employees, contractors, suppliers and the public.',
      [['How to report', ul(['To your manager, or if that is not appropriate, to the Chief Internal Auditor or the Chairperson of the Audit Committee.', 'Reports may be made anonymously. Give as much detail as you can (what, when, where, who).'])],
        ['Protection', '<p>{{company.name}} will not dismiss, discipline or disadvantage anyone who reports in good faith, even if the report is not confirmed. Victimising a whistleblower is a disciplinary offence.</p>'],
        ['Handling reports', ol(['Internal Audit records and assesses each report within 5 working days.', 'Investigations are independent and confidential.', 'Where a crime is suspected, the matter may be reported to the Police or the Directorate on Corruption and Economic Offences (DCEO).'])]],
      ['Prevention of Corruption and Economic Offences Act, 1999', 'Labour Act, 2024', 'Anti-Fraud and Corruption Policy']) },
    fraud: { title: 'Anti-Fraud and Corruption Policy', html: () => policy('Anti-Fraud and Corruption Policy',
      'To prevent, detect and respond to fraud, bribery and corruption. {{company.name}} has zero tolerance for fraud and corruption.', 'Everyone who works for or with {{company.name}}.',
      [['Prevention', ul(['Segregation of duties and the Delegation of Authority in S-ERP.', 'Bank reconciliations, control-account reconciliations and the sealed (tamper-evident) ledger.', 'Supplier vetting, declarations of interest and procurement rules.', 'Regular data analysis by Internal Audit (duplicate payments, staff-supplier matches, unusual journals).'])],
        ['Bribery', '<p>No one may offer, give, ask for or accept any payment, gift or favour to influence a business decision.</p>'],
        ['Response', '<p>Suspected fraud is reported to Internal Audit immediately, evidence is preserved, and the matter is investigated; losses are recovered and criminal matters reported.</p>']],
      ['Prevention of Corruption and Economic Offences Act, 1999', 'Money Laundering and Proceeds of Crime Act, 2008', 'Whistleblowing Policy']) },
    gifts: { title: 'Gifts and Hospitality Policy', html: () => policy('Gifts and Hospitality Policy',
      'To prevent gifts and hospitality from influencing, or appearing to influence, business decisions.', 'All staff and directors.',
      [['Rules', ul(['Do not accept gifts or hospitality from anyone bidding for work or in a procurement process.', 'Gifts above M {{gifts.limit}} in value must be declared to your manager and recorded in the gifts register.', 'Cash or cash-equivalents (vouchers, airtime) may never be accepted.'])]], null) },
    records: { title: 'Records Management and Retention Policy', html: () => policy('Records Management and Retention Policy',
      'To keep the records the law and the business need, for as long as needed, safely and retrievably.', 'All records, paper and electronic, including S-ERP data and attachments.',
      [['Retention', `<table><tr><th>Records</th><th>Keep for at least</th></tr><tr><td>Accounting records, invoices, ledgers</td><td>{{records.accounting_years}} years (check the Income Tax Act, 1993 and VAT Act, 2001)</td></tr><tr><td>Payroll and personnel files</td><td>{{records.hr_years}} years after the employee leaves</td></tr><tr><td>Contracts and legal documents</td><td>{{records.contract_years}} years after expiry</td></tr><tr><td>Procurement files</td><td>As required by the procurement law</td></tr></table>`],
        ['Security', '<p>Records are stored in S-ERP with access by role; daily backups are kept off-site; personal data is protected under the Data Protection Policy.</p>']],
      ['Companies Act, 2011', 'Income Tax Act, 1993', 'Value Added Tax Act, 2001', 'Data Protection Act (Act No. 5 of 2012)']) }
  } },
  finance: { name: 'Finance', items: {
    finmgmt: { title: 'Financial Management and Internal Control Policy', html: () => policy('Financial Management and Internal Control Policy',
      'To make sure the finances of {{company.name}} are properly controlled, recorded and reported.', 'All financial transactions and everyone who starts, approves, records or pays them.',
      [['Books of account', ul(['All transactions are recorded in S-ERP on the day they happen.', 'Manual journals need a reason and supporting documents; above M {{finance.approval_limit}} they are approved by a second person.', 'Control accounts are changed only by their own documents.', 'Posted entries are never changed or deleted – errors are reversed.'])],
        ['Month-end close', ol(['Bank and mobile-money accounts reconciled.', 'Depreciation, accruals and recurring journals posted.', 'VAT and PAYE returns prepared.', 'Trial balance reviewed; the period is locked.'])],
        ['Year-end', '<p>The financial statements are prepared under IFRS for SMEs (or full IFRS) and audited as required by the Companies Act, 2011.</p>']],
      ['Companies Act, 2011', 'Income Tax Act, 1993', 'Value Added Tax Act, 2001', 'Delegation of Authority Policy']) },
    cash: { title: 'Cash Handling and Banking Policy', html: () => policy('Cash Handling and Banking Policy',
      'To protect cash and make sure all money received is banked and recorded.', 'Tills, cashiers, supervisors and finance staff.',
      [['Tills', ul(['Every cashier works in their own till session; sessions are closed and counted daily.', 'Overs and shorts above M {{cash.variance}} are investigated by the supervisor.', 'Refunds and voids need a supervisor.'])],
        ['Banking', ul(['Cash is banked at least {{cash.banking_frequency}}; cash above M {{cash.safe_limit}} is not kept on the premises overnight.', 'Cash payments out above M {{finance.large_cash}} need written approval.'])],
        ['Bank accounts', '<p>Bank accounts are opened or closed only with Board approval; payments need two authorised signatories.</p>']],
      ['Money Laundering and Proceeds of Crime Act, 2008']) },
    expenses: { title: 'Expense Claims and Travel Policy', html: () => policy('Expense Claims and Travel Policy',
      'To repay staff fairly for business expenses and control travel costs.', 'All staff who spend money on company business.',
      [['Rules', ul(['Claims are made in S-ERP within 30 days with a receipt photo.', 'Claims are approved by your line manager within their limit (Delegation of Authority); you never approve your own claim.', 'Only business expenses are paid; alcohol and fines are not.'])],
        ['Travel', ul(['Use a pool vehicle where possible (Fleet → Ask for a vehicle).', 'Overnight travel needs prior approval; accommodation up to M {{travel.night_limit}} per night.'])]], null) },
    credit: { title: 'Credit Control and Debt Collection Policy', html: () => policy('Credit Control and Debt Collection Policy',
      'To give credit carefully and collect what customers owe on time.', 'All sales on account and customer billing.',
      [['Giving credit', ul(['New credit customers are approved by the Finance Manager with a credit limit.', 'Statements are sent monthly; reminders by SMS / WhatsApp / email from S-ERP.'])],
        ['Collection steps', ol(['Reminder when an account is overdue.', 'Second reminder after 14 days.', 'Letter of demand after 30 days (Legal → Letter of demand).', 'Suspension of credit / service and handover for collection after 60 days.'])],
        ['Write-offs', '<p>Bad debts are written off only with approval under the Delegation of Authority and after collection steps are exhausted.</p>']], null) },
    assets: { title: 'Fixed Assets Policy', html: () => policy('Fixed Assets Policy',
      'To safeguard, record and account for the property, plant and equipment of {{company.name}}.', 'All assets with a cost of M {{assets.threshold}} or more and a useful life of more than one year.',
      [['Recording', ul(['Every asset is in the S-ERP asset register with a tag (QR label), location and custodian.', 'Depreciation is straight line over the useful lives in the asset categories, run monthly.'])],
        ['Safeguarding', ul(['Assets are counted at least once a year.', 'Moves and hand-overs are recorded in S-ERP.', 'Disposals and write-offs are approved under the Delegation of Authority.'])]],
      ['IFRS for SMEs, section 17 / IAS 16']) },
    budget: { title: 'Budget Policy', html: () => policy('Budget Policy',
      'To plan and control income and spending.', 'All departments and cost centres.',
      [['Process', ol(['Departments prepare budgets by account, month and cost centre in S-ERP.', 'The Finance Manager consolidates; the Chief Executive concurs; the Board approves.', 'Budget against actual is reviewed monthly; variances above {{budget.variance_pct}}% are explained.'])]], null) }
  } },
  procurement: { name: 'Procurement', items: {
    procurement: { title: 'Procurement Policy', html: () => policy('Procurement Policy',
      'To buy goods, works and services fairly, competitively, transparently and at the best value.', 'All purchases by {{company.name}}.',
      [['Methods and thresholds', `<table><tr><th>Value</th><th>Method</th></tr><tr><td>Up to M {{procurement.rfq_max}}</td><td>Request for quotations from at least {{procurement.min_rfq}} suppliers</td></tr><tr><td>Above M {{procurement.rfq_max}}</td><td>Open tender (or restricted tender with at least {{procurement.min_restricted}} invited suppliers where justified)</td></tr><tr><td>Any value, exceptional cases</td><td>Waiver (direct procurement) – written justification approved under the Delegation of Authority; recorded in the waiver register</td></tr></table>`],
        ['Evaluation', ul(['Criteria and points are set before bids are invited and published to bidders.', 'Bids are sealed until the closing time and opened by at least {{procurement.min_opening}} committee members.', 'Committee members declare conflicts of interest before scoring.', 'Preference points support citizen-, women-, youth- and disability-owned businesses and SMMEs.'])],
        ['Award and challenges', '<p>Awards are approved by someone other than the evaluators; unsuccessful bidders are told the result and may challenge it during a standstill of {{procurement.standstill}} days.</p>'],
        ['Suppliers', '<p>Suppliers must hold a valid tax clearance and trader\'s licence; debarred suppliers may not take part.</p>']],
      ['Public Procurement Act, 2023 and Public Procurement Regulations, 2025 (public bodies)', 'Business Licensing and Registration Act, 2019', 'Conflict of Interest Policy']) }
  } },
  hr: { name: 'Human resources', items: {
    recruit: { title: 'Recruitment and Selection Policy', html: () => policy('Recruitment and Selection Policy',
      'To appoint the best person for each job through a fair process.', 'All appointments, permanent and fixed-term.',
      [['Process', ol(['An approved, budgeted vacancy in the organogram.', 'Advertising internally and / or externally.', 'Shortlisting and interviews by a panel; panel members declare conflicts of interest.', 'Reference and qualification checks.', 'Appointment approved under the Delegation of Authority; written contract signed before starting.'])],
        ['Fairness', '<p>No discrimination on grounds prohibited by the Labour Act, 2024 or the Constitution.</p>']], ['Labour Act, 2024']) },
    leave: { title: 'Leave Policy', html: () => policy('Leave Policy',
      'To set out the leave employees are entitled to and how it is applied for and approved.', 'All employees.',
      [['Types of leave', `<table><tr><th>Leave</th><th>Entitlement</th></tr><tr><td>Annual leave</td><td>{{leave.annual_days}} working days a year (not less than the Labour Act, 2024 minimum)</td></tr><tr><td>Sick leave</td><td>{{leave.sick_days}} days on full pay per cycle, with a medical certificate for absences of more than {{leave.sick_cert_days}} days (as provided by the Labour Act, 2024)</td></tr><tr><td>Maternity leave</td><td>14 weeks (7 before and 7 after the expected date of birth), under the Labour Act, 2024</td></tr><tr><td>Paternity leave</td><td>14 days</td></tr><tr><td>Adoption (bonding) leave</td><td>14 days</td></tr><tr><td>Bereavement leave</td><td>5 days</td></tr></table>`],
        ['Applying and approval', ul(['Leave is applied for in S-ERP in advance.', 'Your line manager approves within the days set in the Delegation of Authority; longer leave goes to the next level.', 'Leave balances are kept in S-ERP.'])]], ['Labour Act, 2024 (in force from 2 April 2024)']) },
    discipline: { title: 'Disciplinary Code and Procedure', html: () => policy('Disciplinary Code and Procedure',
      'To deal with misconduct fairly, consistently and lawfully.', 'All employees.',
      [['Principles', ul(['Discipline aims to correct behaviour; it is applied consistently.', 'No action without a fair hearing: the employee is told the allegations in writing, has time to prepare, may be represented by a co-worker or union representative, and may present evidence.', 'Dismissal only for a valid reason and after a fair procedure, as required by the Labour Act, 2024.'])],
        ['Sanctions', `<table><tr><th>Offence</th><th>First</th><th>Second</th><th>Third</th></tr><tr><td>Late coming, minor negligence</td><td>Verbal warning</td><td>Written warning</td><td>Final written warning</td></tr><tr><td>Absence without leave</td><td>Written warning</td><td>Final written warning</td><td>Dismissal</td></tr><tr><td>Insubordination, abuse</td><td>Final written warning</td><td>Dismissal</td><td></td></tr><tr><td>Theft, fraud, corruption, violence</td><td>Dismissal</td><td></td><td></td></tr></table>`],
        ['Appeals and disputes', '<p>The employee may appeal internally within {{discipline.appeal_days}} working days, and may refer a dispute to the Directorate of Dispute Prevention and Resolution (DDPR).</p>']], ['Labour Act, 2024']) },
    grievance: { title: 'Grievance Procedure', html: () => policy('Grievance Procedure',
      'To resolve employees\' complaints quickly and fairly.', 'All employees.',
      [['Steps', ol(['Raise the grievance with your supervisor (or the next level if it concerns the supervisor).', 'If not resolved within {{grievance.days}} working days, put it in writing to the head of department.', 'If still not resolved, the Chief Executive decides.', 'Unresolved disputes may be referred to the DDPR.'])]], ['Labour Act, 2024']) },
    harassment: { title: 'Sexual Harassment Policy', html: () => policy('Sexual Harassment Policy',
      'To keep the workplace free of sexual harassment.', 'Employees, contractors, customers and visitors in the workplace.',
      [['Policy', ul(['Sexual harassment – unwelcome conduct of a sexual nature – is not tolerated.', 'Complaints may be made to any manager or HR, in confidence, without fear of victimisation.', 'Complaints are investigated promptly; proven harassment is serious misconduct.'])]], ['Labour Act, 2024']) },
    overtime: { title: 'Remuneration, Hours and Overtime Policy', html: () => policy('Remuneration, Hours and Overtime Policy',
      'To pay employees correctly and on time, and manage working time.', 'All employees.',
      [['Pay', ul(['Salaries are paid by the {{pay.day}} of each month with a payslip showing all deductions.', 'Pay is not less than the applicable minimum wage.', 'Only lawful or agreed deductions are made.'])],
        ['Hours and overtime', ul(['Normal hours are {{hours.week}} per week within the limits of the Labour Act, 2024.', 'Overtime is worked only when approved in advance by the line manager and is paid at the rate the Act requires.'])]], ['Labour Act, 2024', 'Income Tax Act, 1993 (PAYE)']) }
  } },
  it: { name: 'Information technology', items: {
    acceptable: { title: 'Acceptable Use of IT Policy', html: () => policy('Acceptable Use of IT Policy',
      'To protect the systems and information of {{company.name}}.', 'All users of company computers, phones, networks, email and S-ERP.',
      [['Rules', ul(['Keep your password secret; never share logins. Lock your screen when away.', 'Use company systems for business; no illegal, offensive or pirated content.', 'Do not install software without IT approval; report lost devices immediately.', 'Company may monitor its systems within the law.'])]], ['Data Protection Act (Act No. 5 of 2012)']) },
    security: { title: 'Information Security and Access Control Policy', html: () => policy('Information Security and Access Control Policy',
      'To control who can see and change information, and protect it from loss.', 'All systems, especially S-ERP.',
      [['Access', ul(['Access is by role and approved by the head of department; leavers are removed on their last day.', 'Administrator rights are limited to as few people as possible.', 'User access is reviewed every 6 months.'])],
        ['Monitoring', ul(['S-ERP keeps an audit trail of every change and every login; failed logins are reviewed.', 'The ledger is sealed in a hash chain; Internal Audit verifies it.'])]], null) },
    privacy: { title: 'Data Protection and Privacy Policy', html: () => policy('Data Protection and Privacy Policy',
      'To process personal information of customers, staff and suppliers lawfully and protect it, as required by the Data Protection Act (Act No. 5 of 2012).', 'All personal information held by {{company.name}}.',
      [['Principles', ul(['Collect only what is needed for a stated purpose, and tell people why.', 'Keep it accurate, secure and no longer than needed.', 'Share it only as allowed by law or with consent.', 'People may ask to see and correct their information.'])],
        ['Breaches', '<p>A suspected data breach is reported immediately to the {{privacy.officer}}, who decides on notification of the people affected and of the authorities as the law requires.</p>']], ['Data Protection Act (Act No. 5 of 2012)']) },
    backup: { title: 'Backup and Business Continuity Policy', html: () => policy('Backup and Business Continuity Policy',
      'To be able to continue operating after a system failure, fire, theft or other disaster.', 'S-ERP and all business-critical systems.',
      [['Backups', ul(['S-ERP is backed up daily; one copy is kept off-site or in the cloud.', 'A restore is tested at least every {{backup.test_months}} months.'])],
        ['Continuity', '<p>Each department keeps a short plan for working without the system (manual receipts, offline tills) and recovering afterwards.</p>']], null) }
  } },
  operations: { name: 'Operations, health & safety', items: {
    ohs: { title: 'Occupational Health and Safety Policy', html: () => policy('Occupational Health and Safety Policy',
      'To provide a safe and healthy workplace and prevent injuries and illness.', 'All workplaces, staff, contractors and visitors.',
      [['Commitments', ul(['Identify hazards and control risks; provide protective equipment and training.', 'Report every accident, incident and near-miss; investigate and fix causes.', 'Stop work that is unsafe.', 'Insure employees against work injuries as the law requires.'])]],
      ['Labour Act, 2024 (occupational health and safety)', 'Workmen\'s Compensation Act, 1977']) },
    fleet: { title: 'Vehicle and Fleet Use Policy', html: () => policy('Vehicle and Fleet Use Policy',
      'To use company vehicles safely, legally and economically.', 'All drivers and users of company vehicles.',
      [['Rules', ul(['Only authorised drivers with a valid licence (and professional permit where needed) may drive.', 'Pool vehicles are booked and approved in S-ERP; the logbook (odometer out and in) is completed for every trip.', 'Traffic fines are the driver\'s responsibility unless the fine arose from a vehicle defect.', 'Accidents are reported within 24 hours and to the police where required.'])]], null) }
  } },
  customer: { name: 'Customer service', items: {
    complaints: { title: 'Customer Service and Complaints Policy', html: () => policy('Customer Service and Complaints Policy',
      'To serve customers well and resolve complaints fairly and quickly.', 'All customer-facing staff and channels.',
      [['Standards', ul(['Acknowledge complaints within {{service.ack_hours}} hours and resolve within {{service.resolve_days}} working days, or explain why not.', 'Record every complaint in S-ERP (Helpdesk) so trends are seen.', 'Escalate unresolved complaints to the department head.'])]], null) },
    disconnect: { title: 'Water Disconnection and Reconnection Policy', html: () => policy('Water Disconnection and Reconnection Policy',
      'To disconnect water fairly and only as a last resort, and reconnect promptly once the account is settled.', 'All postpaid water connections.',
      [['Before disconnection', ul(['The customer has been reminded at least twice and given a final notice of at least {{water.notice_days}} days.', 'Accounts owing less than M {{water.min_amount}} are not disconnected.', 'Disconnections are not done on Fridays, weekends, public holidays or where a vulnerable customer is identified, unless approved by the manager.'])],
        ['Reconnection', '<p>Service is reconnected within {{water.reconnect_hours}} hours after the arrears and reconnection fee are paid or an arrangement is agreed.</p>']],
      ['Water Act, 2008', 'Lesotho Electricity and Water Authority Act, 2002 and the LEWA customer service rules']) },
    billing: { title: 'Meter Reading and Billing Policy', html: () => policy('Meter Reading and Billing Policy',
      'To bill customers accurately for the water they use at the approved tariff.', 'All metered connections.',
      [['Rules', ul(['Meters are read monthly on a planned route; estimates are used only when the meter cannot be read and are corrected at the next actual reading.', 'Readings flagged as very high, zero or going backwards are checked before billing.', 'Tariffs in the system are the tariffs approved by the regulator.'])]], ['Lesotho Electricity and Water Authority Act, 2002']) }
  } }
};

/* ============================== legal documents ============================== */
const L = (h, body) => `<h1>${h}</h1>${body}${NOTE}`;
const parties = (a, b) => `<p><b>BETWEEN</b></p><p>${a}</p><p><b>AND</b></p><p>${b}</p>`;
const CO = '<b>{{company.name}}</b>, a {{company.entity}} registered in the Kingdom of Lesotho{{company.reg_no_clause}}, of {{company.address}} (hereinafter "the Company")';
const signatures = (a = '{{company.name}}', b = '{{other.name}}') => `<h2>Signatures</h2><table><tr><td style="width:50%">For and on behalf of ${a}<br><br>______________________<br>Name: {{signatory.name}}<br>Title: {{signatory.title}}<br>Date: ____________</td><td>${b}<br><br>______________________<br>Name:<br>Date: ____________</td></tr><tr><td>Witness: ______________________</td><td>Witness: ______________________</td></tr></table>`;
const general = `${sec('Dispute resolution', '<p>The parties will first try to settle any dispute by negotiation between senior representatives within 14 days. Failing that, either party may refer the dispute to arbitration in Maseru under the Arbitration Act, 1980, or to the courts of Lesotho.</p>')}
${sec('Governing law', '<p>This agreement is governed by the laws of the Kingdom of Lesotho.</p>')}
${sec('Whole agreement', '<p>This document is the whole agreement between the parties. A change is valid only if in writing and signed by both parties.</p>')}`;
const LEGAL = {
  employment: { name: 'Contract of employment', category: 'HR', source: 'employee', html: () => L('Contract of Employment', `${parties(CO, '<b>{{employee.name}}</b>, identity number {{employee.id_number}}, of {{employee.address}} (hereinafter "the Employee")')}
${sec('1. Appointment', '<p>The Company employs the Employee as <b>{{employee.job_title}}</b> in the {{employee.department}} department, reporting to the {{employee.reports_to}}, on a {{employee.employment_type}} basis starting on <b>{{employee.start_date}}</b>{{employee.end_clause}}.</p>')}
${sec('2. Probation', '<p>The first {{probation.months}} months are a probationary period during which performance and suitability are assessed, within the limits allowed by the Labour Act, 2024.</p>')}
${sec('3. Remuneration', '<p>The Company pays a basic salary of <b>M {{employee.salary}}</b> per month, by the {{pay.day}} day of each month, less PAYE and other lawful or agreed deductions, with a payslip.</p>')}
${sec('4. Hours of work', '<p>Normal hours are {{hours.week}} hours a week, {{hours.days}}. Overtime is worked only when authorised and is paid as the Labour Act, 2024 requires.</p>')}
${sec('5. Leave', `<p>The Employee is entitled to leave under the Labour Act, 2024 and the Company Leave Policy, including annual leave of {{leave.annual_days}} working days a year, sick leave, maternity leave of 14 weeks, paternity leave of 14 days and bereavement leave of 5 days.</p>`)}
${sec('6. Duties and conduct', '<p>The Employee will perform the duties in the job description, follow lawful instructions and Company policies (including the Code of Conduct), and keep Company information confidential during and after employment.</p>')}
${sec('7. Termination', '<p>Either party may end this contract by giving written notice of {{notice.period}}, or as otherwise provided by the Labour Act, 2024. The Company may dismiss for a valid reason after a fair procedure under the Disciplinary Code. Terminal benefits are paid as the Act requires.</p>')}
${sec('8. Disputes', '<p>Disputes are dealt with under the Grievance Procedure and may be referred to the Directorate of Dispute Prevention and Resolution (DDPR).</p>')}
${sec('9. Governing law', '<p>This contract is governed by the laws of Lesotho, in particular the Labour Act, 2024.</p>')}${signatures('the Company', 'the Employee: {{employee.name}}')}`) },
  nda: { name: 'Non-disclosure agreement', category: 'Commercial', source: 'partner', html: () => L('Mutual Non-Disclosure Agreement', `${parties(CO, '<b>{{partner.name}}</b>{{partner.reg_no_clause}}, of {{partner.address}} ("the Other Party")')}
${sec('1. Purpose', '<p>The parties will share confidential information to consider and carry out {{purpose}} ("the Purpose").</p>')}
${sec('2. Confidential information', '<p>All business, financial, technical, customer and personal information disclosed by one party to the other, in any form, except information that is public (not through a breach), already lawfully known, or independently developed.</p>')}
${sec('3. Obligations', ul(['Use confidential information only for the Purpose.', 'Disclose it only to staff and advisers who need it and are bound by confidentiality.', 'Protect it at least as carefully as own confidential information; handle personal information as the Data Protection Act requires.', 'Return or destroy it on request.']))}
${sec('4. Term', '<p>These obligations last for {{nda.years}} years from signature.</p>')}${general}${signatures()}`) },
  supply: { name: 'Supply of goods agreement', category: 'Commercial', source: 'partner', html: () => L('Supply of Goods Agreement', `${parties(CO, '<b>{{partner.name}}</b>{{partner.reg_no_clause}}, of {{partner.address}} ("the Supplier")')}
${sec('1. Goods', '<p>The Supplier will supply the goods described in Schedule 1{{tender.clause}} at the prices stated, for a total contract value of up to <b>M {{contract.value}}</b> (VAT inclusive where applicable).</p>')}
${sec('2. Orders and delivery', '<p>Goods are delivered against the Company\'s purchase orders to {{delivery.place}} within {{delivery.days}} days of each order. Risk passes on delivery; ownership on payment.</p>')}
${sec('3. Quality and warranty', '<p>Goods must be new, fit for purpose, match the specification and be guaranteed for {{warranty.months}} months. Defective goods are replaced at the Supplier\'s cost.</p>')}
${sec('4. Price and payment', '<p>Prices are fixed for the term unless agreed in writing. The Company pays valid tax invoices within {{payment.days}} days of delivery and acceptance. The Supplier keeps a valid tax clearance certificate.</p>')}
${sec('5. Term and termination', '<p>This agreement runs from {{contract.start}} to {{contract.end}}. Either party may terminate for a material breach not remedied within 14 days of written notice.</p>')}
${sec('6. Ethics', '<p>No party will offer or accept any bribe or improper benefit (Prevention of Corruption and Economic Offences Act, 1999).</p>')}${general}${signatures()}<h2>Schedule 1 – Goods and prices</h2>{{schedule}}`) },
  service: { name: 'Service agreement (with service levels)', category: 'Commercial', source: 'partner', html: () => L('Service Agreement', `${parties(CO, '<b>{{partner.name}}</b>{{partner.reg_no_clause}}, of {{partner.address}} ("the Service Provider")')}
${sec('1. Services', '<p>The Service Provider will provide {{services.description}} ("the Services") from {{contract.start}} to {{contract.end}}.</p>')}
${sec('2. Service levels', `<table><tr><th>Measure</th><th>Target</th></tr><tr><td>Response time</td><td>{{sla.response}}</td></tr><tr><td>Resolution time</td><td>{{sla.resolution}}</td></tr><tr><td>Availability</td><td>{{sla.availability}}</td></tr></table><p>If targets are missed in a month, the fee for that month is reduced by {{sla.credit_pct}}%.</p>`)}
${sec('3. Fees', '<p>The Company pays M {{contract.value}} {{fee.basis}}, against valid tax invoices, within {{payment.days}} days.</p>')}
${sec('4. Staff and safety', '<p>The Service Provider\'s staff follow the Company\'s health and safety rules and site instructions; the Service Provider is the employer of its staff and responsible for their wages, tax and workmen\'s compensation.</p>')}
${sec('5. Data protection', '<p>Where the Services involve personal information, the Service Provider processes it only on the Company\'s instructions and keeps it secure.</p>')}
${sec('6. Termination', '<p>Either party may terminate on {{notice.days}} days\' written notice, or immediately for a material breach not remedied within 14 days.</p>')}${general}${signatures()}`) },
  consultancy: { name: 'Consultancy agreement', category: 'Commercial', source: 'partner', html: () => L('Consultancy Agreement', `${parties(CO, '<b>{{partner.name}}</b>, of {{partner.address}} ("the Consultant")')}
${sec('1. Assignment', '<p>The Consultant will carry out the assignment in the terms of reference (Schedule 1), delivering {{deliverables}} by {{contract.end}}.</p>')}
${sec('2. Fees', '<p>A fee of M {{contract.value}} payable on acceptance of deliverables as set out in Schedule 1; withholding tax is deducted where the Income Tax Act, 1993 requires.</p>')}
${sec('3. Independent contractor', '<p>The Consultant is an independent contractor and not an employee.</p>')}
${sec('4. Intellectual property and confidentiality', '<p>Reports and other work products belong to the Company on payment. The Consultant keeps all Company information confidential.</p>')}${general}${signatures()}`) },
  lease: { name: 'Commercial lease agreement', category: 'Property', source: 'partner', html: () => L('Lease Agreement', `${parties(`${CO} ("the Landlord")`.replace(' (hereinafter "the Company")', ''), '<b>{{partner.name}}</b>, of {{partner.address}} ("the Tenant")')}
${sec('1. Premises', '<p>The Landlord lets to the Tenant {{lease.premises}} ("the Premises") for use as {{lease.use}}.</p>')}
${sec('2. Period', '<p>From {{contract.start}} to {{contract.end}}, renewable by agreement; the Tenant gives {{lease.renewal_notice}} days\' notice of wishing to renew.</p>')}
${sec('3. Rent and deposit', '<p>Monthly rent of <b>M {{lease.rent}}</b> payable in advance by the {{lease.due_day}} of each month, increasing by {{lease.escalation}}% each year. A deposit of M {{lease.deposit}} is held and refunded after the lease ends, less amounts owing and repair costs.</p>')}
${sec('4. Use, maintenance and alterations', '<p>The Tenant keeps the Premises clean and in good order, pays for utilities used, and makes no alterations without written consent. The Landlord maintains the structure and roof.</p>')}
${sec('5. Breach', '<p>If rent is not paid within 7 days of the due date, or another breach is not remedied within 14 days of written notice, the Landlord may cancel the lease and recover arrears.</p>')}
${sec('6. Land law', '<p>Where the lease is of land or a registrable lease, it is subject to the Land Act, 2010.</p>')}${general}${signatures('the Landlord', 'the Tenant: {{partner.name}}')}`) },
  loan: { name: 'Loan agreement', category: 'Finance', source: 'partner', html: () => L('Loan Agreement', `${parties('<b>{{partner.name}}</b>, of {{partner.address}} ("the Lender")', CO.replace('hereinafter "the Company"', 'hereinafter "the Borrower"'))}
${sec('1. Loan', '<p>The Lender lends the Borrower M {{contract.value}}, paid into the Borrower\'s bank account on {{contract.start}}.</p>')}
${sec('2. Interest and repayment', '<p>Interest at {{loan.rate}}% a year, calculated monthly on the balance. Repayment in {{loan.instalments}} monthly instalments starting {{loan.first_due}}. Early repayment is allowed without penalty.</p>')}
${sec('3. Default', '<p>If an instalment is more than 30 days late, the whole balance may become due after written notice.</p>')}
${sec('4. Approval', '<p>The Borrower confirms this loan is approved under its Delegation of Authority (board resolution where required).</p>')}${general}${signatures('the Lender', 'the Borrower')}`) },
  demand: { name: 'Letter of demand (debt)', category: 'Finance', source: 'partner', html: () => L('Letter of Demand', `<p>{{date}}</p><p><b>{{partner.name}}</b><br>{{partner.address}}</p><p>Dear Sir / Madam</p>
<p><b>LETTER OF DEMAND – AMOUNT OWING: M {{partner.balance}}</b></p>
<p>Our records show that you owe {{company.name}} <b>M {{partner.balance}}</b> on the following overdue invoices:</p>{{partner.overdue_table}}
<p>Despite our reminders this amount remains unpaid. We demand payment of the full amount within <b>{{demand.days}} days</b> of the date of this letter, to the account below, quoting your name as reference.</p>
<p>{{company.bank_details}}</p>
<p>If payment is not received or an acceptable arrangement made within this time, we will without further notice take legal action to recover the amount, interest and legal costs, and may suspend supply or service.</p>
<p>Yours faithfully</p><p>______________________<br>{{signatory.name}}<br>{{signatory.title}}, for {{company.name}}</p>`) },
  warning: { name: 'Written warning', category: 'HR', source: 'employee', html: () => L('Written Warning', `<p>{{date}}</p><p>To: <b>{{employee.name}}</b>, {{employee.job_title}}</p><p><b>{{warning.level}} WARNING</b></p>
<p>Following the disciplinary process on {{hearing.date}}, you are given a {{warning.level}} warning for: <b>{{offence}}</b>.</p>
<p>Facts: {{facts}}</p>
<p>This warning stays valid for {{warning.months}} months. A repeat of the same or similar misconduct during this time may lead to more serious action, which may include dismissal under the Disciplinary Code and the Labour Act, 2024.</p>
<p>You may appeal within {{discipline.appeal_days}} working days. Please sign to confirm you received this warning (signing does not mean you agree).</p>
<p>______________________ Manager &nbsp;&nbsp;&nbsp; ______________________ Employee &nbsp;&nbsp;&nbsp; Date: ________</p>`) },
  hearing: { name: 'Notice of disciplinary hearing', category: 'HR', source: 'employee', html: () => L('Notice of Disciplinary Hearing', `<p>{{date}}</p><p>To: <b>{{employee.name}}</b>, {{employee.job_title}}</p>
<p>You are required to attend a disciplinary hearing on <b>{{hearing.date}}</b> at {{hearing.time}} at {{hearing.place}}.</p>
<p><b>Allegation(s):</b> {{allegations}}</p><p>At the hearing you may: answer the allegations; call witnesses and present documents; be represented by a co-worker or trade union representative; and use an interpreter if needed.</p>
<p>If you do not attend without a good reason, the hearing may continue in your absence. The possible outcome may include a warning or dismissal under the Disciplinary Code and the Labour Act, 2024.</p>
<p>______________________<br>{{signatory.name}}, {{signatory.title}}</p><p>Received: ______________________ Date: ________</p>`) },
  termination: { name: 'Letter of termination', category: 'HR', source: 'employee', html: () => L('Termination of Employment', `<p>{{date}}</p><p>To: <b>{{employee.name}}</b>, {{employee.job_title}}</p>
<p>Following {{termination.reason_process}}, your employment with {{company.name}} ends on <b>{{termination.date}}</b>, for the following reason: {{termination.reason}}.</p>
<p>You will be paid: salary up to the last working day, leave due, notice pay where applicable, and any severance or terminal benefits due under the Labour Act, 2024, less lawful deductions. A certificate of service will be given.</p>
<p>Please return all Company property by {{termination.date}}. You may refer a dispute to the DDPR within the time the law allows.</p><p>______________________<br>{{signatory.name}}, {{signatory.title}}</p>`) },
  resolution: { name: 'Board resolution', category: 'Corporate', source: null, html: () => L('Resolution of the Board of Directors', `<p><b>{{company.name}}</b>{{company.reg_no_clause}}</p><p>Resolution passed at a meeting of the Board held on {{meeting.date}} at {{meeting.place}} / by written resolution signed by all directors, as allowed by the Company\'s constitution and the Companies Act, 2011.</p>
<p><b>RESOLVED THAT</b> {{resolution.text}}</p><p><b>FURTHER RESOLVED THAT</b> {{signatory.name}}, {{signatory.title}}, is authorised to sign all documents and do everything needed to give effect to this resolution.</p>
<p>Certified a true copy.</p><p>______________________ Chairperson &nbsp;&nbsp;&nbsp; ______________________ Company Secretary</p>`) },
  poa: { name: 'Power of attorney (special)', category: 'Corporate', source: null, html: () => L('Special Power of Attorney', `<p>{{company.name}}{{company.reg_no_clause}}, acting by {{signatory.name}}, {{signatory.title}}, duly authorised by board resolution dated {{meeting.date}}, appoints <b>{{attorney.name}}</b>, identity number {{attorney.id_number}}, to act for it in the following matter only: {{poa.matter}}.</p>
<p>This power of attorney is valid until {{contract.end}} unless revoked earlier in writing.</p><p>Signed at Maseru on {{date}}.</p><p>______________________ For {{company.name}} &nbsp;&nbsp;&nbsp; Witnesses: 1. __________ 2. __________</p>`) },
  mou: { name: 'Memorandum of understanding', category: 'Commercial', source: 'partner', html: () => L('Memorandum of Understanding', `${parties(CO, '<b>{{partner.name}}</b>, of {{partner.address}}')}
${sec('1. Purpose', '<p>To set out how the parties will cooperate on {{purpose}}.</p>')}${sec('2. Roles', '<p>{{mou.roles}}</p>')}
${sec('3. Status', '<p>This memorandum records the parties\' intentions; it does not create binding obligations except for confidentiality and this clause, until the parties sign a full agreement.</p>')}${signatures()}`) },
  tender_contract: { name: 'Contract from a tender award', category: 'Procurement', source: 'tender', html: () => L('Contract for {{tender.title}}', `${parties(CO, '<b>{{partner.name}}</b>{{partner.reg_no_clause}}, of {{partner.address}} ("the Contractor")')}
${sec('1. Award', '<p>Following procurement {{tender.number}} ({{tender.method}}), the Company awarded the contract for <b>{{tender.title}}</b> to the Contractor for <b>M {{contract.value}}</b> (VAT inclusive), on the Contractor\'s bid, which forms part of this contract together with the procurement documents and any addenda.</p>')}
${sec('2. Scope and price', '{{schedule}}')}
${sec('3. Period', '<p>From {{contract.start}} to {{contract.end}}; delivery / completion within {{delivery.days}} days.</p>')}
${sec('4. Payment', '<p>Against valid tax invoices and acceptance, within {{payment.days}} days; the Contractor keeps a valid tax clearance.</p>')}
${sec('5. Performance', '<p>Performance is reviewed and rated on completion; poor performance may affect future awards. Penalties for late completion: {{penalty.text}}.</p>')}
${sec('6. Integrity', '<p>The Contractor confirms its bid declaration (no collusion, no conflict of interest) remains true. Corrupt practice entitles the Company to terminate.</p>')}
${sec('7. Procurement law', '<p>Where the Company is a public body, this contract is subject to the Public Procurement Act, 2023 and its Regulations.</p>')}${general}${signatures()}`) },
  water_connection: { name: 'Water service connection agreement', category: 'Customer', source: 'water_account', html: () => L('Water Service Connection Agreement', `${parties(CO, '<b>{{partner.name}}</b>, of {{account.address}} ("the Customer")')}
${sec('1. Connection', '<p>The Company supplies water to {{account.address}}{{account.plot_clause}} through meter {{account.meter}}, account number <b>{{account.number}}</b>, on {{account.billing}} terms, at tariff "{{account.tariff}}" as approved by the regulator from time to time.</p>')}
${sec('2. Charges', '<p>The Customer pays the connection fee, a deposit of M {{account.deposit}} (postpaid), monthly bills within {{water.due_days}} days, or buys prepaid tokens. Arrears may be recovered from prepaid purchases.</p>')}
${sec('3. Meter and pipes', '<p>The meter and pipes up to the meter belong to the Company; the Customer protects the meter, gives access for reading and maintenance, and does not tamper with it or make illegal connections.</p>')}
${sec('4. Disconnection', '<p>Supply may be disconnected for non-payment after notice, for tampering, or for safety, under the Company\'s Disconnection and Reconnection Policy and the regulator\'s rules; reconnection fees apply.</p>')}
${sec('5. Personal information', '<p>The Company uses the Customer\'s information for billing and service, as described in its privacy notice.</p>')}${signatures('the Company', 'the Customer')}`) },
  privacy_notice: { name: 'Privacy notice (customers)', category: 'Customer', source: null, html: () => L('Privacy Notice', `<p>{{company.name}} respects your privacy and processes your personal information under the Data Protection Act (Act No. 5 of 2012).</p>
${sec('What we collect', ul(['Name, contact details, ID or registration number', 'Account, billing, payment and usage information', 'Communications with you']))}
${sec('Why', ul(['To provide our products and services and bill for them', 'To send statements, reminders and service messages', 'To meet legal obligations (tax, accounting, regulators)']))}
${sec('Sharing', '<p>Only with service providers who help us (e.g. payment partners, SMS providers) under confidentiality, with authorities when the law requires, or with your consent.</p>')}
${sec('Your rights', '<p>You may ask to see and correct your information, and object to marketing, by contacting {{privacy.officer}} at {{company.email}} / {{company.phone}}.</p>')}`) }
};

/* ============================== compliance obligations (starting list) ============================== */
const OBLIGATIONS = [
  ['File the company annual return', 'Companies Act, 2011', 'Registrar of Companies (OBFC)', 'yearly'],
  ['Renew the trader\'s / business licence', 'Business Licensing and Registration Act, 2019', 'Ministry of Trade / local authority', 'yearly'],
  ['Audit of the annual financial statements', 'Companies Act, 2011', 'External auditors', 'yearly'],
  ['Annual general meeting', 'Companies Act, 2011', 'Shareholders', 'yearly'],
  ['VAT return and payment (see Tax centre)', 'Value Added Tax Act, 2001', 'Revenue Services Lesotho', 'monthly'],
  ['PAYE return and payment (see Tax centre)', 'Income Tax Act, 1993', 'Revenue Services Lesotho', 'monthly'],
  ['Annual income tax return (see Tax centre)', 'Income Tax Act, 1993', 'Revenue Services Lesotho', 'yearly'],
  ['Renew the tax clearance certificate', 'Income Tax Act, 1993', 'Revenue Services Lesotho', 'yearly'],
  ['Workmen\'s compensation insurance in force', 'Workmen\'s Compensation Act, 1977', 'Insurer / Labour Commissioner', 'yearly'],
  ['Review employment contracts and policies against the Labour Act, 2024', 'Labour Act, 2024', 'Internal – HR', 'yearly'],
  ['Review privacy notices and personal-data processing', 'Data Protection Act (Act No. 5 of 2012)', 'Internal – IT / legal', 'yearly']
];
const WATER_OBLIGATIONS = [['Comply with licence conditions and report to the regulator', 'Lesotho Electricity and Water Authority Act, 2002', 'LEWA', 'quarterly'], ['Annual tariff review submission', 'Lesotho Electricity and Water Authority Act, 2002', 'LEWA', 'yearly']];

module.exports = { POLICIES, LEGAL, OBLIGATIONS, WATER_OBLIGATIONS, NOTE };
