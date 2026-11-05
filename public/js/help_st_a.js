// Sesotho help notes (part 1). Business words people use in English every day (VAT, invoice, PIN, email, till…) are kept.
export const A = {
  db: {
    host: 'Moo MySQL e sebetsang teng. "localhost" haeba MySQL e kentsoe k\'homphieutheng ena; ho seng joalo aterese ea IP ea seva, mohl. 192.168.1.10.',
    port: 'Hangata ke 3306. E fetole feela haeba MySQL ea hau e kentsoe port e ’ngoe.',
    user: 'Mosebelisi oa MySQL ea lumelletsoang ho etsa li-database – hangata ke "root" ha e sa tsoa kenngoa.',
    password: 'Phasewete e behiloeng bakeng sa mosebelisi eo ha MySQL e ne e kenngoa.',
    database: 'Lebitso la database eo S-ERP e tla e sebelisa. E iketsetsa haeba e le sieo. Boloka "maluti_erp" ntle le haeba u tsamaisa likhamphani tse ngata.'
  },
  setup: {
    name: 'Lebitso la khoebo ea hau joalo ka ha le lokela ho hlaha ho li-receipt, li-invoice le litlaleho, mohl. "Ha Thetsane Butchery".',
    phone: 'Nomoro ea mohala oa lebenkele e hatisoang ho li-receipt le li-invoice hore bareki ba u fumane.',
    address: 'Aterese ea sebaka (seterata, toropo). E hatisoa ho li-invoice le li-order tsa thekiso.',
    email: 'Email ea khoebo e hlahang ho li-invoice. Litlaleho tsa qetello ea letsatsi li behoa ka thoko ho Settings → Email.',
    tax_number: 'Nomoro ea hau ea VAT kapa TIN e tsoang ho Revenue Services Lesotho. E hatisoa ho li-invoice tsa lekhetho – e tlohele e se na letho haeba u sa ngolisoa.',
    currency_code: 'Khoutu ea chelete ea litlhaku tse tharo e sebelisoang litlalehong, mohl. LSL (Loti), ZAR (Rand).',
    currency_symbol: 'Letšoao le hatisoang pele ho chelete, mohl. M bakeng sa Maloti kapa R bakeng sa Rand.',
    vat_rate: 'Sekhahla sa VAT ka liperesente. Lesotho: 15. Kenya 0 haeba u sa ngolisoa bakeng sa VAT. U ka eketsa likhahla tse ling hamorao (Settings → Taxes).',
    receipt_footer: 'Molaetsa o mokhutšoanyane o hatisoang tlase ho receipt e ’ngoe le e ’ngoe, mohl. melao ea ho khutlisa thepa kapa "Re a leboha – khutla hape!".',
    a_name: 'Lebitso la mong\'a khoebo kapa mookameli ea tla laola sistimi. Le hlaha litokomaneng tseo a li etsang.',
    a_username: 'Lebitso la ho kena la motsamaisi, mohl. "admin" kapa lebitso la hau la pele. Ntle le libaka.',
    a_password: 'Bonyane litlhaku tse 6. E boloke e le lekunutu – motsamaisi a ka fetola litheko, basebelisi le litlhophiso.',
    a_pin: 'Khoutu ea linomoro tse 4–6 ea ho kena kapele till. Ba-cashier ba fumana li-PIN tsa bona ho Settings → Users.',
    demo: 'E eketsa lihlahisoa, bareki le barekisi ba mohlala hore u ithute. E tlose bakeng sa ho qala ka lintlha tsa hau feela.'
  },
  company: {
    name: 'Lebitso la khoebo le hatisoang ho li-receipt, li-invoice le litlaleho.',
    phone: 'E hatisoa ho li-receipt le li-invoice.',
    address: 'Seterata le toropo – e hatisoa ho li-invoice le li-order tsa thekiso.',
    email: 'E hlaha ho li-invoice ebile ke aterese eo likarabo li eang ho eona ha litokomane li romeloa ka email.',
    tax_number: 'Nomoro ea VAT / TIN e tsoang ho Revenue Services Lesotho. E hlokahala ho li-invoice tsa lekhetho haeba u ngolisitsoe bakeng sa VAT.',
    currency_code: 'Khoutu ea litlhaku tse tharo, mohl. LSL kapa ZAR.',
    currency_symbol: 'E hatisoa pele ho chelete, mohl. M.',
    default_vat: 'VAT % e sisinngoang meleng e mecha ea li-invoice le ea thekiso. Lihlahisoa li sebelisa lekhetho le khethiloeng sehlahisoeng ka seng.',
    receipt_footer: 'E hatisoa tlase ho receipt e ’ngoe le e ’ngoe – melao ea ho khutlisa, trademark kapa lintlha tsa banka.',
    show_logo_receipt: 'Hatisa logo e kentsoeng holimo ho li-receipt le li-Z-report.',
    logo_bw: 'E khothalletsoa bakeng sa liprintara tsa receipt tsa mocheso – e fetola logo hore e be ntšo le tšoeu e hlakileng.',
    logo_width_mm: 'Bophara ba logo ha e hatisoa. 40 mm e loketse liprintara tse ngata tsa 80 mm; sebelisa 30 bakeng sa tsa 58 mm.'
  },
  pos: {
    print_kitchen_tickets: 'Lireschorente le libara: ha weitara a romela order, tekete e hatisoa kichineng kapa bareng (ho ea ka sehlopha sa sehlahisoa).',
    require_pin_between_sales: 'Li-till tse arolelanoang: ka mor\'a thekiso e ’ngoe le e ’ngoe till ea notleloa ’me cashier e latelang e kenya PIN ea hae, kahoo thekiso e ’ngoe le e ’ngoe e hokahana le motho ea nepahetseng.'
  },
  qr: {
    receipt_qr: 'E eketsa QR code ho li-receipt. Bareki ba e skena ho fumana kopi ea dijithale ’me ba ka e boloka ho Samsung kapa Google Wallet.',
    receipt_qr_text: 'Taelo e khutšoanyane e hatisoang tlas\'a QR, mohl. "Skena bakeng sa receipt ea hau ea dijithale".',
    pay_qr: 'E hatisa QR ea tefo ea mokhoa o mong le o mong oa tefo (mohl. QR ea M-Pesa ea mohoebi) ho li-bili le li-invoice hore bareki ba lefe ka ho skena.'
  },
  paymethod: {
    name: 'Kamoo mokhoa o hlahang kateng till le litlalehong, mohl. "Cash", "Card", "M-Pesa", "EcoCash".',
    kind: 'Chelete ea pampiri e baloa ka har\'a drawer; card / mobile money li bapisoa le setatemente sa banka kapa sa wallet; "account" e beha thekiso akhaonteng ea moreki (mokitlane).',
    account_code: 'Moo chelete e ngoloang teng: Chelete e letsohong, Card clearing (ho fihlela banka e lefa), Wallet ea mobile money, Banka, kapa Accounts receivable bakeng sa thekiso ka mokitlane.',
    plugin_id: 'Ha ho hlokahale: hokahanya plugin ea tefo (mohl. mobile money) hore till e romele kopo ea tefo mohaleng oa moreki.',
    qr_label: 'Mongolo o hatisoang le QR ea ho lefa, mohl. "Skena ho lefa ka M-Pesa – till 123456".',
    sort_order: 'Tatelano ea likonopo tsa tefo till – linomoro tse nyane pele.',
    requires_reference: 'Cashier o tlameha ho ngola nomoro ea slip kapa ea transaction (e khothalletsoa bakeng sa card le mobile money) – e nolofatsa ho bapisa.',
    active: 'E tlose ho pata mokhoa ona till ntle le ho hlakola nalane ea oona.'
  },
  tax: {
    name: 'Lebitso le hlahang ho li-invoice le litlalehong, mohl. "VAT 15%" kapa "Zero-rated".',
    rate: 'Liperesente, mohl. 15 bakeng sa VAT e tloaelehileng, 0 bakeng sa lintho tse zero-rated kapa tse lokolotsoeng.',
    price_includes_tax: 'E tšoailoe (ho tloaelehile mabenkeleng): theko ea shelefong e se e kenyelletsa VAT. E sa tšoauoa: VAT e eketsoa holim\'a theko.'
  },
  till: {
    name: 'Lebitso la till / k\'homphieutha, mohl. "Front counter" kapa "Bar 1". Till e ’ngoe le e ’ngoe e na le li-session tsa eona tsa cashier.',
    mode: 'Retail: skena ’me u lefe. Restaurant: litafole, mekato le litekete tsa kichine. Bar: li-tab tse bulehileng. Li-till tsa butchery li sebelisa Retail.',
    location_id: 'Lekala leo till ena e leng ho lona. Thekiso mona e nka setoko lekaleng leo ’me e baloa phaellong ea lona. E se na letho = sebaka sa kamehla.'
  },
  floor: {
    name: 'Karolo ea reschorente, mohl. "Ka hare", "Patio", "VIP".',
    sort_order: 'Tatelano ea li-tab tsa mekato till.'
  },
  table: {
    name: 'Lebitso la tafole joalo ka ha basebetsi ba e tseba, mohl. "T1" kapa "Fensetere 3".',
    floor_id: 'Karolo eo tafole ena e leng ho eona.',
    seats: 'Palo ea litulo – e sebelisoa ho bala baeti.'
  },
  category: {
    name: 'Sehlopha sa lihlahisoa se hlahang e le konopo till, mohl. "Nama ea khomo", "Nama ea kolobe", "Lino".',
    station: 'Moo li-order tsa sehlopha sena li hatisoang teng ho reschorente/bara: Kichine, Bara, kapa Ha ho bakeng sa lintho tsa lebenkele.',
    color: 'Mmala oa sehlopha till hore basebetsi ba fumane lintho kapele.',
    sort_order: 'Tatelano ea likonopo tsa lihlopha till.'
  },
  user: {
    location_id: 'Lekala la lapeng la motho enoa. Li-order tsa thekiso le li-invoice tseo a li etsang li ngoloa lekaleng lena, ’me o amohela li-transfer tse romeloang ho lona.',
    name: 'Lebitso le feletseng la mosebetsi – le hlaha ho li-receipt, li-session le litlalehong.',
    username: 'Lebitso la ho kena, ntle le libaka, mohl. "thabo".',
    email: 'Ha ho hlokahale – bakeng sa ho mo romela litlaleho.',
    role: 'Seo a lumelletsoang ho se etsa. admin: tsohle. manager: till ho kenyeletsa ho khutlisa chelete le theolelo, setoko, thekiso, li-invoice, libuka, litlaleho, CRM, recon, HR – empa eseng litlhophiso tsa sistimi. accountant: libuka, li-invoice, litlaleho, recon, payroll (ha a sebetse till). cashier: till, airtime le motlakase. waiter: ho nka li-order. bartender: li-tab, airtime. kitchen: skrine ea kichine feela.',
    password: 'Bakeng sa ho kena back office. Bonyane litlhaku tse 6.',
    pin: 'Linomoro tse 4–6 tsa ho kena kapele till. Cashier e ’ngoe le e ’ngoe e hloka PIN e fapaneng.',
    active: 'E tlose ha motho a tsamaea – ha a sa khona ho kena, nalane ea hae ea sala.'
  },
  email: {
    smtp_host: 'Seva e romelang (SMTP) ea mofani oa email ea hau, mohl. smtp.gmail.com, smtp.office365.com, mail.yourdomain.co.ls.',
    smtp_port: '587 bakeng sa STARTTLS (bafani ba bangata) kapa 465 bakeng sa SSL. Botsa mofani oa hau haeba u sa tsebe.',
    smtp_user: 'Hangata ke aterese e feletseng ea email eo u romelang ka eona.',
    smtp_pass: 'Phasewete ea email. Bakeng sa Gmail/Outlook e nang le 2-step verification etsa "app password" ’me u e kenye mona.',
    smtp_secure: 'E tšoaee feela ha port e le 465 (SSL). E tlohele e sa tšoauoa bakeng sa 587.',
    from_address: 'Aterese eo litlaleho li tsoang ho eona, mohl. "Ha Thetsane Butchery <reports@yourshop.co.ls>".',
    recipients: 'Ba amohelang tlaleho ea qetello ea letsatsi – mong\'a khoebo, mookameli, akhaontente. Arola liaterese ka likoma.',
    eod_enabled: 'E romela thekiso, litefo ka mokhoa, li-session tsa ba-cashier, recon le litšila tsa letsatsi ka bo eona.',
    eod_time: 'Nako ea ho romela tlaleho ea letsatsi – ka mor\'a ho koala, mohl. 21:00.',
    attach_csv: 'Hokela thekiso ea letsatsi e le faele ea CSV bakeng sa Excel.',
    send_on_session_close: 'Hape romela tlaleho ka email nako le nako ha cashier a koala session (shift) ea hae.'
  },
  product: {
    name: 'Lebitso till, ho li-receipt le ho li-label. Le khutšoanyane ’me le hlakile, mohl. "Rump steak", "Coke 330ml".',
    type: 'Sehlahisoa sa setoko: palo e baloa ’me theko ea sona e tsebahala. E etsoang ha e odaroa: lijo, li-cocktail, li-tot/likhalase tse tšeloang botlolong – ha li baloe. Tšebeletso: mosebetsi kapa litefiso.',
    category_id: 'Sehlopha sa likonopo till seo se hlahang ho sona. Laola lihlopha ka konopo ea Categories.',
    price: 'Theko ea ho rekisa ho kenyeletsa VAT (ka kg bakeng sa lintho tse rekisoang ka boima).',
    cost: 'Theko eo u e rekang ka eona ka yuniti. Bakeng sa lintho tsa setoko e iphetola (moving average) ha u amohela setoko.',
    tax_id: 'Sekhahla sa VAT sa sehlahisoa sena. Lijo tsa motheo li ka ba zero-rated – botsa akhaontente ea hau.',
    uom: 'Yuniti ea tekanyo: Unit, kg, Botlolo, Litara, Pakete… Sebelisa "kg" bakeng sa nama e rekisoang ka boima.',
    sku: 'Khoutu ea hau e khutšoanyane ea ho batla, mohl. "BF-RMP". Ha ho hlokahale.',
    barcode: 'Barcode ea moetsi (EAN) – e skene ka har\'a sebaka sena. E tlohele e se na letho bakeng sa nama e lekantsoeng; li-label tsa sekala li sebelisa PLU.',
    reorder_level: 'Ha setoko se theohela palong ena se hlaha lethathamong la setoko se tlase le ho dashboard.',
    opening_qty: 'Palo eo u seng u e-na le eona shelefong kajeno. E baloa ka theko ea ho reka e kaholimo.',
    sold_by_weight: 'Till e botsa boima (kapa e bala sekala) ’me e lefisa theko × kg.',
    plu: 'Khoutu ea sehlahisoa sekaleng (mohl. 1001). E tlameha ho tšoana le PLU e kentsoeng sekaleng sa li-label hore li-label tse skenngoang li fumane sehlahisoa sena.',
    shelf_life_days: 'Matsatsi ho tloha ha se phuthoa/amoheloa ho fihlela letsatsi la ho sebelisoa. E sebelisoa bakeng sa letsatsi la ho fela ha li-batch le li-label.',
    track_batches: 'Boloka setoko ka li-batch tse nang le matsatsi a ho fela; thekiso e nka batch e felang pele.',
    is_carcass: 'Tšoaea bakeng sa litopo tse feletseng/li-primal tseo u li rekang. E ’ngoe le e ’ngoe e amoheloang e fumana tag ea eona ’me e salloa morao kg ka kg ho fihlela e rekisoa kaofela.',
    species: 'Phoofolo eo nama e tsoang ho eona – e sebelisoa litlalehong ka phoofolo. Likarolo li e nka setopong ka bo tsona.',
    bottle_ml: 'Joala bo matla le veine: se ka har\'a botlolo e le ’ngoe, mohl. 750 kapa 1000.',
    bottle_empty_g: 'Boima ba botlolo e se nang letho le pourer ea eona, ka ligrama. E lekanye sekaleng hang feela.',
    bottle_full_g: 'Boima ba botlolo e tletseng e sa buloang ka ligrama (ha ho hlokahale – e etsa hore ml ho tsoa ho boima e nepahale haholoanyane).',
    pour_from_id: 'Bakeng sa tot kapa khalase: botlolo eo e tšeloang ho eona. Ho e rekisa ho ntša li-ml tsa eona setokong sa botlolo eo.',
    pour_ml: 'Boholo ba tekanyo ena ka ml: 25 tot e le ’ngoe, 50 habeli, 175 kapa 250 khalase ea veine.',
    pos_visible: 'Bontša sehlahisoa sena e le konopo till. E tlose bakeng sa lisebelisoa tse tala joaloka litopo, mala kapa linoko.',
    active: 'E tlose ho emisa sehlahisoa ntle le ho lahleheloa ke nalane ea sona.'
  },
  partner: {
    name: 'Lebitso la moreki kapa morekisi joalo ka ha le lokela ho hlaha ho li-invoice.',
    phone: 'Nomoro e kholo ea mohala – e boetse e sebelisoa bakeng sa litefo tsa mobile money le SMS.',
    email: 'Moo li-invoice le li-statement li romeloang teng ka email.',
    contact_person: 'Motho eo u sebetsanang le eena khamphaning ena.',
    birthday: 'Ha ho hlokahale – e hlaha likhopotsong tsa matsatsi a tsoalo ho CRM.',
    tags: 'Mangolo a ho arola bareki ka lihlopha, mohl. vip, wholesale, reschorente.',
    address: 'Aterese ea ho isa thepa / ea poso e hatisoang ho li-invoice le li-order tsa thekiso.',
    tax_number: 'Nomoro ea bona ea VAT / TIN – e hlokahala ho li-invoice tsa lekhetho ho bareki ba ngolisitsoeng bakeng sa VAT.',
    credit_limit: 'Chelete e kholo ka ho fetisisa eo ba ka u kolotang eona ka mokitlane. 0 = ha ho thekiso ka mokitlane.',
    is_customer: 'U ba rekisetsa.',
    is_supplier: 'U reka ho bona (setopo, sehoai, wholesaler…).',
    notes: 'Eng kapa eng eo basebetsi ba lokelang ho e tseba, mohl. matsatsi a ho isa thepa kapa litumellano tsa theko.',
    marketing_opt_out: 'Tšoaea ha motho a kopile hore a se ke a fumana litheolelo le litaba. Ha a kenyelletsoe molaetseng ofe kapa ofe oa SMS kapa email (li-invoice le likhopotso li ntse li ea).'
  },
  butchery: {
    enabled: 'E bulela lintho tse lekanyetsoang ka boima, li-label tsa sekala, ho arola litopo le ho li sala morao, litšila, li-batch le ho sebetsa nama bakeng sa khoebo eohle.',
    scale_enabled: 'Tšoaea till e nang le sekala se hokahantsoeng ka thapo ea USB/RS-232.',
    auto_read: 'Bala boima ka bo eona ha sehlahisoa se lekantsoeng se tobetsoa, sebakeng sa ho tobetsa "Read scale".',
    baud_rate: 'Lebelo la puisano le behiloeng ho menu ea sekala – hangata 9600.',
    data_bits: 'Joalo ka ha ho behiloe sekaleng – hangata 8.',
    parity: 'Joalo ka ha ho behiloe sekaleng – hangata none.',
    stop_bits: 'Joalo ka ha ho behiloe sekaleng – hangata 1.',
    request_cmd: 'Taelo eo sekala se e hlokang pele se romela boima (bona buka ea sona, mohl. W kapa P). E tlohele e se na letho haeba se romela boima khafetsa.',
    barcode_prefixes: 'Linomoro tsa pele tsa li-barcode tse hatisoang ke sekala sa hau sa li-label, hangata 20–29. Li-barcode tse qalang ka tsona li baloa e le li-label tse lekantsoeng.',
    barcode_value_type: 'Hore na sekala sa hau se kenya theko kapa boima ka har\'a barcode – sheba label e hatisitsoeng kapa litlhophiso tsa sekala.',
    barcode_item_digits: 'Ke linomoro tse kae tsa barcode e leng PLU (hangata 5).',
    barcode_value_digits: 'Ke linomoro tse kae tse tšoereng theko ka lisente kapa boima ka ligrama (hangata 5). Prefix + PLU + boleng + nomoro e le ’ngoe ea tlhahlobo li tlameha ho ba 13.'
  }
};
