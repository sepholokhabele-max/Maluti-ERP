// Sesotho help notes (part 2)
export const B = {
  butchery: {
    label_barcode_prefix: 'Prefix e sebelisoang ho li-label tse hatisoang ke S-ERP (li-label tsa thepa e phuthetsoeng) – e ’ngoe ea li-prefix tse kaholimo.',
    expiry_warning_days: 'Lemosa ho dashboard matsatsi a makae pele ho letsatsi la ho fela la batch.',
    label_width_mm: 'Bophara ba li-label tsa hau ka mm (mohl. 60).',
    label_height_mm: 'Bolelele ba li-label tsa hau ka mm (mohl. 40).',
    waste_reasons: 'Mabaka ao basebetsi ba ka a khethang ha ba ngola setoko se lahliloeng, le le leng moleng ka mong, mohl. Ho poma, Ho bola, Ho feta nako.'
  },
  hrm_tax: {
    name: 'Lebitso la selemo sa lekhetho, mohl. "PAYE 2027/28".',
    effective_from: 'Letsatsi la pele leo likhahla tsena li sebetsang ka lona (selemo sa lekhetho Lesotho se qala ka la 1 Mmesa). Likhoeli tse fetileng li boloka tafole ea pele.',
    band_monthly: 'Moputso oa khoeli o lefisoang lekhetho ka sekhahla se tlase (2026/27: M6,480).',
    credit_monthly: 'Tax credit ea khoeli e ntšoang lekhethong (2026/27: M1,020).',
    lower_rate: 'Sekhahla moputsong ho fihlela moeling – 20% Lesotho.',
    upper_rate: 'Sekhahla moputsong o fetang moeli – 30% Lesotho.',
    source: 'Moo likhahla li tsoang teng, mohl. "Puo ea tekanyetso Hlakola 2027 / tsebiso ea RSL" – bakeng sa lirekoto tsa hau.'
  },
  employee: {
    first_name: 'Joalo ka ha ho le ID.', last_name: 'Joalo ka ha ho le ID.',
    code: 'Nomoro ea mosebetsi/payroll. E tlohele e se na letho hore e fuoe nomoro ka bo eona.',
    job_title: 'mohl. Ralinama, Cashier, Moapehi – e hatisoa ho payslip.',
    department_id: 'Sehlopha bakeng sa litlaleho tsa payroll. Eketsa mafapha ho HR → Settings.',
    employment_type: 'Ea ka ho sa feleng, konteraka ea nako e itseng, ea nakoana kapa moithuti – bakeng sa lirekoto le litlaleho.',
    hire_date: 'Letsatsi la pele la mosebetsi – le sebelisoa bakeng sa moputso o arotsoeng khoeling ea pele le bakeng sa phomolo.',
    status: 'Ke basebetsi ba sebetsang feela ba kenyelletsoang ho payroll.',
    termination_date: 'Letsatsi la ho qetela la mosebetsi – khoeli ea ho qetela e lefuoa ka karolo.',
    basic_salary: 'Moputso oa motheo oa khoeli pele ho li-allowance le lintho tse ntšoang.',
    id_number: 'Nomoro ea ID ea naha kapa ea phasepoto – e hlokahala bakeng sa litlaleho tsa PAYE.',
    tin: 'TIN ea mosebetsi e tsoang ho Revenue Services Lesotho – e sebelisoa litlalehong tsa PAYE.',
    gender: 'Ha ho hlokahale – bakeng sa lipalo-palo tsa molao.',
    birth_date: 'Ha ho hlokahale.',
    phone: 'Bakeng sa litsebiso tsa payslip le maemo a tšohanyetso.', email: 'Ha ho hlokahale – li-payslip li ka romeloa ka email.', address: 'Aterese ea lapeng.',
    pay_method: 'Kamoo moputso o lefuoang kateng – o hlaha lethathamong la litefo tsa payroll.',
    bank_name: 'mohl. Standard Lesotho Bank, FNB, Nedbank, Lesotho PostBank.',
    bank_account: 'Nomoro ea akhaonte bakeng sa ho fetisetsa moputso.',
    mobile_money_number: 'Nomoro bakeng sa moputso o lefuoang ka M-Pesa kapa EcoCash.',
    paye_applies: 'E tlose feela bakeng sa batho ba lokolotsoeng PAYE (mohl. baithuti ba bang) – u ntse u ikarabella hore molao o lateloe.',
    emergency_contact: 'Lebitso le nomoro ea motho ea ka letsetsoang tšohanyetsong.',
    user_id: 'Ho kena ha till hoo mosebetsi enoa a ho sebelisang. E hokahanya ho kena ha hae mosebetsing le payroll hore overtime e lefuoe.',
    notes: 'Lintlha tsa lekunutu tsa HR.'
  },
  payitem: {
    kind: 'Allowance/moputso o eketsa tefo; deduction e ntšoa (likalimo, litefiso tsa mokhatlo, penshene).',
    name: 'E hlaha ho payslip, mohl. "Allowance ea lipalangoang", "Kalimo ea mosebetsi".',
    amount: 'Chelete khoeli le khoeli ho fihlela u e emisa.',
    taxable: 'Li-allowance tse ngata li lefisoa lekhetho. E tlose feela bakeng sa tse lokolotsoeng.',
    pre_tax: 'Menehelo ea penshene e amohetsoeng e fokotsa moputso o lefisoang lekhetho pele ho PAYE.',
    active: 'E tlose ho e emisa ho tloha ho payroll e latelang.'
  },
  leavetype: {
    name: 'mohl. Phomolo ea selemo, Ea ho kula, Ea botsoali, Boikarabello ba lelapa.',
    days_per_year: 'Matsatsi ao mosebetsi e mong le e mong a a fumanang ka selemo. 0 = ha a baloe.',
    paid: 'Phomolo e lefuoang ha e fokotse moputso; e sa lefuoeng e ntšoa ho payroll.'
  },
  quote: {
    partner_id: 'Quotation ke ea mang. Eketsa bareki ba bacha ho Contacts pele.',
    customer_ref: 'Nomoro ea bona ea order kapa ea kopo – e hatisoa ho order le invoice hore ba e bapise.',
    order_date: 'Letsatsi la quotation.',
    valid_until: 'Litheko li tiisitsoe ho fihlela letsatsi lena. Ka mor\'a moo quotation e bontšoa e felile.',
    delivery_date: 'Ha u tla isa thepa kapa ha mokete o le teng (manyalo, mapato, mekete).',
    notes: 'Tlhaloso e khutšoanyane e hatisoang tokomaneng, mohl. "Ho isa Mafeteng ho kenyelelitsoe".',
    terms: 'Maemo a tefo le a ho isa thepa a hatisoang tlase, mohl. depositi, nako e sebetsang, ho isa thepa.'
  },
  rule: {
    name: 'Seo basebetsi le bareki ba se bonang ho slip ea till, mohl. "Happy hour", "Mantaha oa nama", "Theko ea wholesale".',
    kind: '% e theotsoeng, chelete e theotsoeng sehlahisoeng ka seng, theko e khethehileng (ho kenyeletsa VAT), kapa multi-buy joaloka "reka 3, 1 ke mahala".',
    value: '% e theotsoeng: liperesente. Chelete e theotsoeng: maloti a theotsoeng sehlahisoeng ka seng. Theko e khethehileng: theko e ncha ea shelefong ho kenyeletsa VAT.',
    min_qty: 'E sebetsa feela ha ho rekoa bonyane palo ena (mohl. theko ea bongata ho tloha ho 10). Bakeng sa multi-buy: ke tse kae tse etsang tumellano (3 ho "3 ka 2").',
    free_qty: 'Multi-buy feela: ke tse kae ho tsona tse leng mahala (1 ho "3 ka 2").',
    applies_to: 'Sehlahisoa se le seng, sehlopha sohle (mohl. Libiri tsohle), kapa ntho e ’ngoe le e ’ngoe lebenkeleng.',
    product_id: 'Sehlahisoa se theotsoeng.', category_id: 'Sehlahisoa se seng le se seng sehlopheng sena se fumana tumellano.',
    customer_scope: 'Bohle, bareki ba nang le tag feela (mohl. wholesale, basebetsi, vip – beha li-tag ho Contacts), kapa moreki a le mong.',
    partner_tag: 'Bareki ba nang le tag ena ho Contacts ba fumana tumellano, mohl. wholesale.',
    partner_id: 'Ke moreki enoa feela ea fumanang tumellano – khetha moreki till.',
    time_from: 'Qalo ea happy hour. Tlohela linako ka bobeli li se na letho bakeng sa letsatsi lohle.', time_to: 'Qetello ea happy hour (e ka feta har\'a bosiu, mohl. 22:00 → 02:00).',
    date_from: 'Letsatsi la pele la theolelo (le se na letho = ho tloha hona joale).', date_to: 'Letsatsi la ho qetela (le se na letho = ha e fele).',
    on_pos: 'Sebelisa ka bo eona till.', on_invoice: 'Sebelisa ka bo eona ho li-quotation le li-order.',
    active: 'E tlose ho emisa theolelo ntle le ho e hlakola.'
  },
  statement: {
    account_code: 'Setatemente ke sa akhaonte efe: akhaonte ea banka, wallet ea M-Pesa/EcoCash ea mohoebi, litefo tsa card, kapa drawer ea chelete.',
    name: 'Lebitso la ho e fumana hape, mohl. "SLB current – Mphalane 2026".',
    opening_balance: 'Balance qalong ea setatemente (ha ho hlokahale – bakeng sa ho hlahloba).',
    closing_balance: 'Balance qetellong ea setatemente. Ha tsohle li bapisitsoe, libuka li lokela ho bontša se tšoanang.',
    partner_id: 'Bakeng sa litefo tsa bareki le tsa barekisi: ke mang ea lefileng kapa ea lefiloeng.',
    description: 'Se hlahang bukeng bakeng sa ntho ena.'
  },
  claim: {
    description: 'Ho rekiloe eng le hobaneng, mohl. "Tekesi ho ea bankeng ka chelete", "Lisebelisoa tsa ho hloekisa".',
    amount: 'Kakaretso ea slip ho kenyeletsa VAT.',
    claim_date: 'Letsatsi le hatisitsoeng ho slip.',
    account_code: 'Sehlopha sa litšenyehelo bakeng sa libuka – mafura, lipalangoang, tokiso, airtime, tse akaretsang.',
    tax_rate: '15 haeba slip e le tax invoice e bontšang VAT e tsoang ho morekisi ea ngolisitsoeng bakeng sa VAT; ho seng joalo 0.',
    supplier: 'Moo ho rekiloeng teng.',
    paid_by: 'Chelete ea hau: lebenkele le u khutlisetsa ka mor\'a tumello. Chelete ea lebenkele: petty cash kapa karete ea khoebo e sebelisitsoe.',
    company_method_id: 'Ke chelete efe ea lebenkele e lefileng – drawer ea chelete, karete ea banka, M-Pesa…'
  },
  approvals: { po_limit: 'Basebetsi ba ntse ba ka etsa li-order tse kholoanyane, empa mookameli o tlameha ho li amohela pele thepa e amoheloa. 0 e tima sena.' },
  attendance: {
    user_id: 'Mosebetsi eo shift ena e leng ea hae.',
    check_in: 'Letsatsi le nako eo shift e qalileng ka eona.', check_out: 'Letsatsi le nako eo e felileng ka eona. E tlohele e se na letho haeba a ntse a le mosebetsing.',
    note: 'Hobaneng e ekelitsoe kapa e fetotsoe – e bolokeloa rekoto.',
    weekly_hours: 'Lihora tse tloaelehileng tsa mosebetsi ka beke pele ho overtime. Labour Code ea Lesotho: 45.',
    daily_hours: 'Lihora tse tloaelehileng ka letsatsi pele ho overtime (9 bakeng sa beke ea matsatsi a 5, 8 bakeng sa beke ea matsatsi a 6).',
    overtime_rate: 'Tefo ea overtime e le makhetlo a sekhahla sa hora se tloaelehileng (Labour Code: bonyane 1.25).',
    max_shift_hours: 'Haeba motho a lebala ho tsoa (clock out), shift e koaloa ka mor\'a lihora tsena ’me e tšoauoa hore e lokisoe.'
  },
  department: { name: 'mohl. Butchery, Lebenkele, Kichine, Tsamaiso.' },
  sms: {
    mode: '"Ka mofani oa ka oa SMS" e romela li-SMS tsa nnete. "Test mode" e ngola melaetsa ho log feela – e sebelise ho leka likhopotso ntle le ho lefa.',
    method: 'Litaelo tsa mofani oa hau li bolela hore na u bitse link (GET) kapa u romele data (POST).',
    url: 'Kopitsa aterese leqepheng la API la mofani oa hau ’me u behe {to} moo nomoro ea mohala e eang teng, {message} moo mongolo o eang teng le {sender} bakeng sa lebitso la moromelli. Hangata e kenyeletsa username le API key ea hau.',
    body: 'Bakeng sa bafani ba POST feela: data e romeloang, e nang le {to} {message} {sender} tse tšoanang. Ha e qala ka { e romeloa e le JSON.',
    headers: 'Feela haeba mofani a e kopa, mohl. "Authorization: Bearer YOUR-KEY".',
    sender: 'Lebitso le hlahang sebakeng sa nomoro (litlhaku tse 11 ho isa holimo) – bafani ba bangata ba tlameha ho le amohela pele.',
    success_text: 'Lentsoe le leng karabong ea mofani ha SMS e amohetsoe (mohl. OK kapa "status":"success"). E tlohele e se na letho haeba u sa tsebe.',
    country_code: 'E eketsoa pele ho linomoro tsa lehae tsa linomoro tse 8. 266 bakeng sa Lesotho.'
  },
  remtpl: { sms: 'E khutšoanyane ’me e na le tlhompho. {details} e eketsa folete kapa mabitso a bana.', email_subject: 'Sehlooho sa email.', email_body: 'Mongolo o molelele bakeng sa email.' },
  remauto: { enabled: 'Tšoaea ho romela likhopotso letsatsi le letsatsi ka bo tsona.', days: 'Matsatsi ka mor\'a letsatsi la ho lefa, a arotsoe ka likoma. Moreki o fumana khopotso e le ’ngoe feela ho le leng le le leng la matsatsi ana.',
    channel: 'SMS e fihla ho batho kapele; email ke mahala.', min_amount: 'U se ke ua lelekisa chelete e nyane haholo.' },
  building: {
    name: 'mohl. "Mokhele Flats, Ha Thetsane" kapa "Kingsway Shopping Centre".', address: 'Aterese ea sebaka – e hatisoa ho li-statement tsa bahiri.',
    owner_id: 'Khetha mong\'a ntlo ha u bokella rente lebitsong la hae. Rente e ba ea hae (ho ntšoa komishene ea hau) sebakeng sa ho ba chelete ea hau. Eketsa beng ba matlo ho Contacts e le barekisi.',
    commission_pct: 'Tefiso ea hau ea tsamaiso e le % ea rente e bokelletsoeng, mohl. 10.', notes: 'Mohlokomeli, linomoro tsa akhaonte ea masepala, inshorense…'
  },
  unit: {
    name: 'mohl. "Folete 3", "Kamore 12", "Lebenkele 4".', kind: 'Matlo a bolulo hangata ha a na VAT; mabenkele le liofisi li na le VAT haeba u ngolisitsoe.', bedrooms: 'Bakeng sa lifolete le matlo.', size_m2: 'Boholo ba fatše – bo thusa bakeng sa mabenkele le liofisi.',
    market_rent: 'Rente e kopuoang – e sisinngoa ha u etsa konteraka.', meter_no: 'Nomoro ea mitara ea motlakase oa prepaid kapa ea metsi ea yuniti.', notes: 'Boemo, thepa ea ntlo, sebaka sa ho paka…', active: 'E tlose bakeng sa yuniti e heletsoeng kapa e sa hirisoeng hape.'
  },
  lease: {
    unit_id: 'Folete, kamore kapa lebenkele le hirisoang.', tenant_id: 'Motho kapa khamphani e lefang. Kapa ngola mohiri e mocha ka tlase.',
    tenant_name: 'Lebitso le feletseng joalo ka ha ho le ID kapa ngoliso ea khamphani.', tenant_phone: 'Bakeng sa likhopotso le li-statement.',
    start_date: 'Letsatsi la pele la konteraka. Haeba e se letsatsi la ho lefa rente, karolo ea khoeli ea pele e bilioa ka karolo.',
    end_date: 'E tlohele e se na letho bakeng sa khoeli ka khoeli. Rente e emisa ho bilioa ka mor\'a letsatsi lena.',
    rent: 'Rente ea khoeli ntle le VAT.', tax_rate: '0 bakeng sa rente ea bolulo. 15 bakeng sa liyuniti tsa khoebo haeba u ngolisitsoe bakeng sa VAT.',
    due_day: 'Letsatsi la khoeli leo rente e lefuoang ka lona (1–28). Invoice e etsoa ka letsatsi lena khoeli le khoeli.',
    deposit: 'Depositi e lumellanoeng kontrakeng (hangata ke rente ea khoeli e le ’ngoe). E ngole e amohetsoe kontrakeng ha e se e lefiloe.',
    escalation_pct: 'Keketseho ea rente ea selemo, mohl. 10. E sebelisoa ka bo eona ka letsatsi la sehopotso.', next_escalation: 'Letsatsi la keketseho e latelang.', notes: 'Maemo a khethehileng.'
  },
  leasepay: { amount: 'Chelete e amohetsoeng. E lefa rente ea khale e sa lefuoang pele; e setseng e sala e le credit bakeng sa khoeli e tlang.', method_id: 'Kamoo chelete e fihlileng kateng.', reference: 'Nomoro ea transaction ea banka kapa M-Pesa – e hlokahala bakeng sa recon ea banka.', date: 'Letsatsi leo chelete e amohetsoeng ka lona.' },
  leasecharge: { description: 'mohl. "Metsi Mphalane 2026", "Tefiso ea ho lefa morao", "Ho nkela senotlolo se lahlehileng sebaka".', amount: 'Chelete ntle le VAT.', tax_rate: 'Hangata 0 bakeng sa lits\'ebeletso tse lefisoang hape.', pass_to_owner: 'Tšoaea ha chelete ena e le ea mong\'a ntlo (mohl. litefiso tsa hae tsa masepala).' },
  deposit: { to_arrears: 'Karolo ea depositi e sebelisetsoang ho lefa rente eo mohiri a ntseng a e kolota.', deductions: 'Tokiso, ho hloekisa kapa linotlolo tse lahlehileng – e fetoha chelete e ’ngoe e kenang.', reason: 'E hlokahala ha u ntša: ho sentsoe eng.', refund: 'E khutlisetsoa mohiri.', method_id: 'Kamoo chelete e khutlisoang kateng.' },
  sclass: { name: 'mohl. "Grade 1A".', grade: 'Litefiso li behoa ka grade, kahoo Grade 1A le 1B li arolelana "Grade 1".', sort: 'Tatelano manethathamong.', teacher: 'Tichere ea sehlopha.', capacity: 'Palo e kholo ea baithuti.', next_class_id: 'Moo baithuti ba eang teng qetellong ea selemo. Ha ho letho = ba qeta sekolo.' },
  fee: { name: 'mohl. Thuto, Lijo tsa motšehare, Lipalangoang, Tlhokomelo ka mor\'a sekolo, Tefiso ea tlhahlobo, Ngoliso.', grade: 'Ha ho letho = li-grade tsohle.', amount: 'Chelete ka nako e ’ngoe le e ’ngoe.', period: 'Ke li-billing run life tse e kenyeletsang: run ea kotara e nka litefiso tsohle tsa "ka kotara", run ea khoeli tsohle tsa "ka khoeli".',
    optional: 'Ke baithuti ba e tšoailoeng feela ba lefang (e behoa ho moithuti).', sibling_discount: 'E tlose bakeng sa litefiso tse sa theoleloeng bana ba motho a le mong (mohl. lipalangoang).', active: 'E tlose ho emisa ho e lefisa.' },
  schoolset: { sibling_discount_pct: 'Theolelo bakeng sa ngoana oa bobeli le ba latelang ba motsoali a le mong (e moholo o lefa ka botlalo).', post_invoices: 'Li-invoice tse posted li baloa li kolotoa hang-hang. E tlose ho hlahloba li-draft pele.' },
  feerun: { label: 'Lebitso le ikhethang – mohl. "Kotara 1 2027". Lebitso le le leng le ke ke la bilioa habeli.', period: 'Ke litefiso life tse bilioang.', invoice_date: 'Letsatsi le ho li-invoice.', due_date: 'Letsatsi leo batsoali ba tlamehang ho lefa ka lona – lilemo tsa mokoloto li baloa ho tloha mona.' },
  learner: {
    first_name: 'Joalo ka ha ho le setifikeiti sa tsoalo.', last_name: 'Fane.', class_id: 'Sehlopha sa hona joale.', admission_no: 'E tlohele e se na letho hore e fuoe nomoro ka bo eona.', gender: 'Bakeng sa manane a lihlopha.', birth_date: 'Bana ba motho a le mong ba hlophisoa ka lilemo bakeng sa theolelo (e moholo o lefa ka botlalo).',
    guardian_id: 'Motsoali ea lefang. Bana ba motsoali a le mong ba arolelana motsoali eo kahoo ba fumana akhaonte e le ’ngoe ea lelapa.', guardian_name: 'Lebitso le feletseng la motsoali e mocha.', guardian_phone: 'Mohala bakeng sa likhopotso tsa litefiso.',
    guardian2: 'Motsoali e mong kapa motho oa tšohanyetso le mohala.', bursary_pct: 'Bursary kapa theolelo ea ngoana oa mosebetsi litefisong tse tlamang, mohl. 50.', enrolled_on: 'Letsatsi la pele sekolong.', medical: 'Li-allergy, maloetse a sa foleng, meriana.', notes: 'Eng kapa eng e ’ngoe.'
  }
};
