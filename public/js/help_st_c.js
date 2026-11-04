// Sesotho help notes (part 3)
export const C = {
  feepay: { amount: 'Chelete e lefiloeng. E lefa litefiso tsa khale pele; e setseng e bolokoa e le credit.', method_id: 'Kamoo e lefiloeng kateng.', reference: 'Nomoro ea depositi ea banka kapa ea M-Pesa.', date: 'Letsatsi la tefo.', family: 'Arola tefo ho bana bohle ba motsoali enoa.' },
  site: {
    name: 'mohl. "LNDC Kingsway – heke e kholo" kapa "Sepetlele sa Queen II – ward block".', partner_id: 'Moreki ea lefang.', kind: 'Tšireletso, ho hloekisa, kapa ka bobeli.',
    address: 'Moo basebetsi ba tlamehang ho tlaleha teng – kenyelletsa litaelo tsa tsela bakeng sa ba nkang sebaka.', contact_name: 'Motho oa moreki sebakeng.', contact_phone: 'Mohala oa hae.',
    staff_day: 'Balebeli / bahloekisi ba hlokahalang motšehare.', staff_night: 'Ba hlokahalang bosiu.',
    billing: 'Contract: chelete e tsitsitseng ea khoeli (Contracts). Ka shift / ka hora: e bilioa ho latela li-shift tse sebelitsoeng.', rate: 'Theko ka shift kapa ka hora ntle le VAT.',
    contract_id: 'Konteraka e bilisang sebaka sena – chelete ea eona e hlaha phaellong ea sebaka.', instructions: 'Litaelo tsa sebaka: linotlolo, mokhoa oa likhoutu tsa alamo, linako tsa ho potoloha, ke mang ea ka kenang…',
    checklist: 'Bakeng sa tlhahlobo ea ho hloekisa (kapa ea sebaka sa molebeli), ntho e le ’ngoe moleng ka mong: "Matloana a hloekisitsoe", "Meqomo e tšolotsoe"…', active: 'E tlose ha konteraka e fela.'
  },
  roster: { from: 'Letsatsi la pele.', to: 'Letsatsi la ho qetela (ho fihlela likhoeli tse peli).', start_time: 'Qalo ea shift.', end_time: 'Qetello ea shift. Nako e pele ho qalo e bolela hore shift e fela hoseng ho latelang (shift ea bosiu).', role: 'Sebaka sa mosebetsi setšeng sena.' },
  absent: { reason: 'Ho kula, ha a tla, phomolo, AWOL…', replacement_id: 'Molebeli kapa mohloekisi ea romeloang sebakeng sa hae – ho etsoa shift bakeng sa hae.' },
  oblog: { kind: 'Ho potoloha, moeti kapa koloi e kenang/e tsoang, ho fetisetsana shift, kapa tlhaloso efe kapa efe.', employee_id: 'Ea ngotseng.', text: 'Se bonoeng kapa se entsoeng, mohl. "Ho potoloha 02:00 – mamati ohle a notletsoe".' },
  incident: { occurred_at: 'Ha ho etsahala.', kind: 'Mofuta oa ketsahalo.', severity: 'E phahameng = ho lemala, tahlehelo ea thepa kapa mapolesa a amehile.', employee_id: 'Molebeli ea e tlalehileng.', description: 'Lintlha: mang, eng, kae, neng.',
    action_taken: 'Seo molebeli / mookameli a se entseng.', police_case: 'Nomoro ea CR e tsoang seteisheneng sa mapolesa.', client_informed: 'Tšoaea ha moreki a se a bolelletsoe.', status: 'Koala ha e se e rarollotsoe.' },
  inspection: { signed_by: 'Lebitso la motho oa moreki ea hlahlobileng le uena.', notes: 'Eng kapa eng e lokelang ho lateloa.' },
  siteinv: { from: 'Letsatsi la pele la li-shift tse bilioang.', to: 'Letsatsi la ho qetela.' },
  lead: {
    title: 'Seo ba se batlang, mohl. "Junifomo bakeng sa baithuti ba 120" kapa "Ho hloekisa khoeli le khoeli – liofisi tsa LNDC".',
    partner_id: 'Khetha moreki haeba a se a le teng ho Contacts. Moreki e mocha o etsoa ka lintlha tse ka tlase ha u etsa quotation kapa u hlola.',
    company: 'Khamphani, sekolo, kereke kapa ofisi ea mmuso.', contact_name: 'Motho eo u sebetsanang le eena.', phone: 'Nomoro ea ho letsetsa kapa ea WhatsApp.', email: 'Bakeng sa ho romela quotation.',
    source: 'Kamoo ba u fumaneng kateng – pipeline e bontša hore na ke mehloli efe e tlisang khoebo e ngata.',
    stage_id: 'Tumellano e fihlile kae. Tsamaisa karete ho pipeline ha e ntse e tsoela pele.',
    expected_value: 'Boleng ba order haeba u e hlola (ho kenyeletsa VAT).',
    probability: 'Khakanyo ea hau. E tlohele e se na letho ho sebelisa monyetla oa mohato.',
    expected_close: 'Ha moreki a tla etsa qeto.', owner_id: 'Morekisi ea ikarabellang ho latela.',
    priority: 'Li-lead tse chesang li bontšoa ka linaleli tse tharo.', notes: 'Litlhoko tsa bona, tekanyetso, ba etsang liqeto le bahlolisani.'
  },
  activity: { type: 'Mohala, kopano, ketelo kapa mosebetsi oa ho etsa.', due_at: 'Ha e lokela ho etsahala – mehato e fetileng nako e bontšoa ka ⚠ ho pipeline.', subject: 'mohl. "Letsetsa ka boholo", "Isa mehlala".', body: 'Lintlha kapa se lumellanoeng.' },
  contract: {
    partner_id: 'Ea lefang.', name: 'mohl. "Tšireletso – kliniki ea Ha Abia", "Rente – Lebenkele 4", "Litefiso tsa sekolo Grade 3 2027".',
    period: 'Hore na invoice e etsoa hangata hakae.', every: '1 = nako e ’ngoe le e ’ngoe. 2 le "Khoeli" = khoeli e ’ngoe le e ’ngoe ea bobeli.',
    start_date: 'Letsatsi la invoice ea pele. Matsatsi a fetileng a etsoa ha u bulela konteraka.',
    end_date: 'Letsatsi la ho qetela la konteraka. Ha ho li-invoice tse etsoang ka mor\'a lona; ha ho letho = e tsoela pele ho fihlela u e fedisa.',
    next_date: 'Letsatsi leo invoice e latelang e tla etsoa ka lona. Le fetole ho tlola kapa ho tsamaisa nako.',
    due_days: 'Matsatsi ao moreki a nang le ona ho lefa (a beha letsatsi la ho lefa invoice e ’ngoe le e ’ngoe).',
    auto_post: 'E tšoailoe: li-invoice li posted hang-hang (moreki o kolota chelete). E sa tšoauoa: li emela e le li-draft hore u li hlahlobe ’me u li post.',
    project_id: 'Hokahanya li-invoice le projeke hore li baloe phaellong ea eona.', notes: 'Eng kapa eng ka tumellano – keketseho, nako ea tsebiso…'
  },
  equipment: {
    name: 'Seo basebetsi ba se bitsang sona, mohl. "Ontong 2", "Spiral mixer", "Jenereitara", "Toyota Quantum A 1234".',
    code: 'Nomoro ea hau ea thepa kapa sticker mochining.',
    category: 'Sehlopha, mohl. Bakery, Workshop, Likoloi, Motlakase.',
    serial_no: 'E tsoang poleiting ea mochine – e hlokahala bakeng sa warranty le likarolo tsa ho nkela sebaka.',
    location_id: 'Lekala kapa sebaka moo mochine o leng teng.',
    supplier_id: 'Ea o rekisitseng kapa ea o hlokomelang – o hlaha ha u hloka molokisi.',
    purchase_date: 'Letsatsi la ho reka.', cost: 'O jele bokae – bakeng sa inshorense le rejistara ea thepa.',
    warranty_until: 'Letsatsi la ho qetela la warranty. Hlahloba sena pele u lefa tokiso.',
    interval_days: 'Hlokomela ka mor\'a matsatsi a … (mohl. 90). Letsatsi la tlhokomelo e latelang le tsoela pele nako le nako ha mosebetsi o phethiloe. Ha ho letho = ha ho tlhokomelo e reriloeng.',
    last_service: 'Ha o qetela ho hlokomeloa.', next_service: 'Ha tlhokomelo e latelang e lokela ho etsoa. E tlatsoa ho tsoa ho nako ha e se na letho.',
    status: 'O senyehile = o ke ke oa sebelisoa; li-work order ho oona li botsa pele li qala.', notes: 'Eng kapa eng e thusang: mofuta oa oli, linomoro tsa filtara, mohala oa setsebi.'
  },
  mreq: {
    equipment_id: 'Mochine o nang le bothata.',
    priority: 'Urgent = tlhahiso e emile. High = o ntse o sebetsa empa o ntse o mpefala.',
    title: 'Mola o le mong, mohl. "Lebanta le thella, mixer ea ema" kapa "Ontong ha e fihle ho 200°C".',
    description: 'Ho etsahetse eng, neng, melumo efe kapa efe kapa likhoutu tsa phoso.',
    machine_down: 'Tšoaea ha mochine o sa lokela ho sebelisoa. O bontšoa o senyehile ho fihlela mosebetsi o phethiloe.',
    kind: 'Tokiso = ho na le se robehileng. Tlhokomelo e reriloeng = tlhokomelo e tloaelehileng.',
    assigned_to: 'Setsebi se tla etsa mosebetsi.', scheduled_date: 'Ha mosebetsi o reriloe.',
    resolution: 'Ho entsoe eng, mohl. "Ho kentsoe mabanta a macha a mabeli ’me a tiisitsoe".',
    labour_cost: 'Nako ea setsebi ka Maloti (bakeng sa nalane ea litšenyehelo tsa mochine).',
    external_cost: 'Seo molokisi oa kantle a se lefisitseng (ngola bili ea hae ho Supplier bills).',
    downtime_hours: 'Ke lihora tse kae mochine o sa sebelisoeng. Ha ho letho = li baloa ho tloha ha o tlalehiloe.'
  },
  rfq: {
    deadline: 'Letsatsi leo barekisi ba lokelang ho romela litheko tsa bona ka lona.',
    notes: 'Aterese ea ho isa thepa, maemo a tefo, "litheko li tlameha ho kenyeletsa ho isa thepa"…',
    lead_days: 'Ke matsatsi a makae ka mor\'a ho odara morekisi a tla isa thepa – a beha letsatsi le lebelletsoeng ho order ea thekiso.'
  },
  project: {
    name: 'mohl. "Network ea ofisi – kliniki ea Ha Abia" kapa "Keketso ea ntlo ea Thabo".',
    code: 'Reference e khutšoanyane e sebelisoang ho li-timesheet le li-invoice. E iketsetsa ha e se na letho.',
    partner_id: 'Moreki ea lefang. E tlohele e se na letho bakeng sa liprojeke tsa ka hare.',
    billing: 'Ka hora: lihora tse ngotsoeng × sekhahla lia bilioa. Theko e tsitsitseng: u bilisa chelete ea tsoelo-pele kapa % ea konteraka. Ha e bilioe: mosebetsi oa ka hare (lihora li ntse li baloa litšenyehelo).',
    hourly_rate: 'Theko ka hora e lefisoang moreki, ntle le VAT.',
    budget_hours: 'Lihora tseo u lebeletseng hore e li nke – projeke e lemosa ha li fela.',
    budget_amount: 'Boleng ba konteraka (theko e tsitsitseng) kapa tekanyetso ea tšebeliso.',
    manager_id: 'A ka eketsa mesebetsi le ho fetola projeke le ha a se na litokelo tse felletseng tsa projeke.',
    start_date: 'Ha mosebetsi o qala.', end_date: 'Nako ea ho qeta e tšepisitsoeng moreki.', status: 'Liprojeke tse felileng le tse hlakotsoeng ha li sa amohela lihora ho basebetsi.',
    description: 'Boholo ba mosebetsi – se kenyelelitsoeng le se sa kenyelletsoang.'
  },
  task: {
    title: 'Karolo ea mosebetsi eo motho a ka e qetang, mohl. "Kenya likhoele ho liofisi tse 6".',
    assigned_to: 'Ea e etsang. E hlaha tlas\'a "My tasks & hours" ea hae.', status: 'Ho etsoa → E ntse e etsoa → Ho hlahlojoa → E felile.',
    priority: 'Mesebetsi e potlakileng le e phahameng e thathamisoa pele.', due_date: 'Ha e tlameha ho phethoa.',
    estimate_hours: 'Lihora tse lebelletsoeng – li bapisoa le lihora tse ngotsoeng.', description: 'Lintlha, lisebelisoa, motho oa ho buisana le eena sebakeng.'
  },
  timesheet: {
    work_date: 'Letsatsi leo mosebetsi o entsoeng ka lona (eseng nakong e tlang).', hours: 'Lihora tse sebelitsoeng, mohl. 1.5 bakeng sa hora le halofo.',
    project_id: 'Projeke eo nako e neng e le ea eona.', task_id: 'Mosebetsi ka har\'a projeke (ha ho hlokahale).',
    description: 'Ho entsoe eng – e hatiselitsoe moreki ho li-invoice tsa hora.',
    billable: 'E tlose bakeng sa nako eo moreki a sa e lefelleng (leeto, ho etsa hape, warranty).'
  },
  projinv: {
    to: 'Lihora tsohle tse lefisoang ho fihlela letsatsi lena tse so kang li bilioa li kena ho invoice.',
    percent: 'Liperesente tsa boleng ba konteraka tse bilioang hona joale, mohl. 30 bakeng sa depositi.',
    amount: 'Kapa ngola chelete ntle le VAT sebakeng sa liperesente.', description: 'Mongolo moleng oa invoice, mohl. "Tefo ea tsoelo-pele 2: marulelo".'
  },
  ticket: {
    subject: 'Tlhaloso e khutšoanyane, mohl. "Laptop ha e chaje" kapa "Printara e khomarela".',
    partner_id: 'Khetha haeba moreki a le teng ho Contacts; ho seng joalo tlatsa lebitso le mohala – ho etsoa contact ha u bilisa.',
    contact_name: 'Motho oa ho buisana le eena.', phone: 'Nomoro ea ho letsetsa kapa ea WhatsApp ha e se e loketse.', email: 'Bakeng sa likarabo ka email.',
    kind: 'Tokiso = thepa e tlisitsoeng (job card). Bothata / potso / kopo = thuso ntle le thepa.',
    channel: 'Kamoo moreki a ikopantseng le uena kateng.', priority: 'E beha nako ea ho araba (bona Helpdesk → Settings).',
    assigned_to: 'Setsebi se ikarabellang.', item: 'Moetsi le mohlala, mohl. "Laptop ea HP 250 G8, e ntšo".',
    serial_no: 'Nomoro ea serial kapa IMEI ea mohala (*#06#) – e paka hore ke thepa e tšoanang ha e nkuoa.',
    project_id: 'Hokahanya le projeke kapa konteraka ea thuso hore nako e baloe moo.',
    description: 'Bothata ka mantsoe a moreki, hammoho le lisebelisoa tse siiloeng le thepa.',
    callout: 'Tefiso e tsitsitseng e eketsoang ho invoice bakeng sa ho ea ho moreki.'
  },
  hdsettings: {
    labour_rate: 'E lefisoa ka hora bakeng sa litokiso ha nako e se ho projeke ea hora.',
    sla_urgent: 'Lihora tseo ticket e potlakileng e tlamehang ho fumana karabo ea pele ka hare ho tsona.', sla_high: 'Lihora bakeng sa li-ticket tsa bohlokoa bo phahameng.',
    sla_normal: 'Lihora bakeng sa li-ticket tse tloaelehileng (24 = letsatsi le latelang).', sla_low: 'Lihora bakeng sa li-ticket tsa bohlokoa bo tlase.'
  },
  bom: {
    product_id: 'Sehlahisoa se felileng seo recipe ena e se etsang. E tlameha ho ba sehlahisoa sa setoko hore thepa e entsoeng e baloe.',
    name: 'mohl. "Motsoako o tloaelehileng oa mahobe a 50" kapa "Version 2". Boloka ea khale ha recipe e fetoha – e boloke sebakeng sa ho e hlakola.',
    output_qty: 'Batch e le ’ngoe e etsa bokae, ka yuniti ea sehlahisoa se felileng – mohl. mahobe a 50, litene tse 1 000, kg tse 20 tsa boroso.',
    code: 'Reference ea hau, mohl. nomoro ea setšoantšo kapa ea recipe.',
    labour_cost: 'Meputso ea batch e le ’ngoe: batho × lihora × sekhahla sa hora. E fetisetsoa ho tsoa litšenyehelong ho ea boleng ba setoko ha batch e phethiloe.',
    overhead_cost: 'Motlakase, khase, ho tsofala ha mechini le liphuthelo tse sa thathamisoang e le likarolo – khakanyo ka batch.',
    minutes: 'Batch e le ’ngoe e nka nako e kae – e sebelisoa bakeng sa moralo.',
    shelf_life_days: 'E tlatsa letsatsi la best-before la batch e ’ngoe le e ’ngoe ka bo eona. E tlohele e se na letho bakeng sa thepa e sa feleng.',
    instructions: 'Mokhoa, linako tsa ho kopanya, mocheso oa ontong, lintlha tsa polokeho – li hatisoa ho job card.'
  },
  wo: {
    bom_id: 'Sehlahisoa le recipe e lokelang ho etsoa. Palo ea likarolo e lekanyetsoa ho latela palo e ka tlase.',
    qty: 'Ho etsoe bokae. Lisebelisoa tse hlokahalang = palo ea recipe × (sena ÷ boholo ba batch) + litšila tse lebelletsoeng.',
    planned_date: 'Ha tlhahiso e lokela ho etsahala – lethathamo le bulehileng le hlophisoa ka letsatsi lena.',
    location_id: 'Moo e etsoang teng: lisebelisoa li nkuoa, ’me thepa e felileng e kena, sebakeng sena.',
    notes: 'Order ea moreki, litaelo tse khethehileng…',
    equipment_id: 'Mochine o sebelisoang. Haeba o senyehile, ho qala work order ho botsa pele.',
    qty_produced: 'Liyuniti tse ntle tse ka rekisoang. Li kena setokong hona joale.',
    qty_rejected: 'Liyuniti tse senyehileng kapa tse hlolehileng. Karolo ea tsona ea litšenyehelo e ngoloa e le tahlehelo ea tlhahiso.',
    batch_no: 'E hatisoa ho li-label bakeng sa ho sala morao. E tlohele e se na letho hore e fuoe nomoro ka bo eona.',
    expiry_date: 'Letsatsi la best-before. Le tlatsoa ho tsoa nakong ea recipe ha le se na letho.',
    qc_status: 'Sephetho sa tlhahlobo ea boleng. "Failed" e bolela hore ha ho letho le ka kenngoang setokong – ngola tsohle e le tse hanngoeng.',
    qc_notes: 'Ho hlahlobiloe eng: boima, mmala, matla, tatso, litekanyo…',
    labour_cost: 'Meputso ea nnete ea run ena (chelete e reriloeng e tlatsitsoe).',
    overhead_cost: 'Litšenyehelo tse ling tsa nnete tsa run ena (chelete e reriloeng e tlatsitsoe).'
  },
  location: {
    name: 'Kamoo basebetsi ba tsebang sebaka sena, mohl. "Lebenkele le leholo Maseru", "Lekala la TY", "Polokelo ea Ha Hoohlo", "Van 1 (A 1234)".',
    code: 'Khoutu e khutšoanyane e hatisoang ho li-transfer le litlalehong, mohl. MSU, TY, WH1. Litlhaku le linomoro feela; e etsoa ho tsoa lebitsong ha e se na letho.',
    kind: 'Lebenkele / lekala = le rekisetsa bareki. Polokelo = kamore ea polokelo e fang mabenkele. Van = setoko se tsamaeang bakeng sa ho isa thepa kapa ho rekisa tseleng. Polasi / sebaka = lebenkele la polasi kapa sebaka sa kaho se sebelisang lisebelisoa.',
    address: 'Aterese ea sebaka – e hatisoa ho li-transfer note hore bakhanni ba tsebe moo ba isang thepa teng.',
    phone: 'Nomoro ea mohala ea motho ea ikarabellang mona.',
    sellable: 'E tlose bakeng sa likamore tsa polokelo tse sa rekiseng ka kotloloho; setoko sa tsona ha se fuoe li-till.',
    is_default: 'Setoko se ngoloa mona ha ho sa khethoa sebaka se seng (setoko sa ho qala, thekiso ntle le lekala, li-till tsa khale). Ho na le sebaka se le seng feela sa kamehla.',
    active: 'E tlose ho koala sebaka. Ho khonahala feela ha se se na setoko se setseng ’me ho se li-till tse hokahantsoeng le sona.'
  },
  transfer: {
    from_location_id: 'Moo thepa e tlohang teng. Setoko se theoha mona hang ha u tobetsa Send.',
    to_location_id: 'Moo thepa e eang teng. Setoko se nyoloha mona feela ha lekala le amohelang le tobetsa Receive.',
    notes: 'Mokhanni, ngoliso ea koloi kapa lebaka – e hatisoa ho transfer note.',
    allow_negative: 'Romela le ha sistimi e nahana hore ha ho na setoko se lekaneng mohloling (mohlala ha setoko se so baloe). Mohloli o ea tlase ho zero ho fihlela ho lokisoa.'
  },
  locstock: {
    min_qty: 'Boemo ba ho odara hape bakeng sa lekala lena: ha setoko mona se theohela ka tlase ho bona, se bontšoa se "tlase" hore ho etsoe transfer kapa thekiso.',
    bin: 'Shelefo, mokoloko kapa bin moo e bolokoang teng sebakeng sena, mohl. "A3" – e hatisoa ho li-transfer note ho potlakisa ho nka thepa.'
  },
  roomtype: {
    name: 'Mofuta oa kamore, mohl. "Double e tloaelehileng", "Kamore ea lelapa", "Rondavel". Likamore tsa mofuta o le mong li arolelana theko.',
    rate: 'Theko ka bosiu ho kenyeletsa VAT. E fetole mona ’me li-booking tse ncha li sebelisa theko e ncha; tse seng li le teng li boloka ea tsona.',
    capacity: 'Ke batho ba bakae ba ka robalang mofuteng ona oa kamore – ho bontšoa ha ho bukoa.',
    breakfast: 'Tšoaea haeba lijo tsa hoseng li le karolo ea theko (ho hatisoa bilong ea moeti).',
    active: 'E tlose ho emisa ho fana ka mofuta ona oa kamore ntle le ho lahleheloa ke nalane ea oona.'
  }
};
