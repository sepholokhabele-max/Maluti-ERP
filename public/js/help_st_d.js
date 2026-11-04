// Sesotho help notes (part 4)
export const D = {
  room: {
    name: 'Nomoro kapa lebitso la kamore joalo ka ha baeti ba e tseba, mohl. "12" kapa "Maloti Suite".',
    room_type_id: 'Mofuta le theko ea kamore ena.',
    floor: 'Mokato, block kapa lepheo – ho thusa ba hloekisang.',
    housekeeping: 'E hloekile = e loketse moeti ea latelang. Likamore li fetoha "tse litšila" ka bo tsona ha moeti a tsamaea. Likamore tse "senyehileng" li ke ke tsa bukoa.',
    notes: 'Eng kapa eng eo ba kamoreng ea kamohelo ba lokelang ho e tseba, mohl. "ha ho metsi a chesang ka Mantaha".',
    active: 'E tlose haeba kamore e sa hirisoe hape.'
  },
  booking: {
    check_in: 'Letsatsi leo moeti a fihlang ka lona.',
    check_out: 'Letsatsi leo moeti a tsamaeang ka lona – masiu a baloa ho fihlela, empa ho sa kenyeletsoe, letsatsi lena.',
    room_id: 'Ke likamore tse lokolohileng masiu ohle feela tse thathamisitsoeng. Fetola matsatsi ho bona likamore tse ling.',
    rate: 'Theko ka bosiu ho kenyeletsa VAT – e nkuoa mofuteng oa kamore, empa u ka fana ka theolelo kapa theko e khethehileng mona.',
    guest_id: 'Moeti ea khutlang – mo khethe hore ho lula hona ho eketsoe nalaneng ea hae. Bakeng sa moeti e mocha tlohela sena ’me u ngole lebitso ka tlase.',
    guest_name: 'Lebitso le feletseng la moeti e mocha – karete ea moreki e etsoa ka bo eona.',
    guest_phone: 'Nomoro ea mohala – e sebelisoa bakeng sa netefatso ka SMS le likhopotso.',
    adults: 'Palo ea batho ba baholo ba lulang.',
    children: 'Palo ea bana ba lulang.',
    source: 'Kamoo booking e fihlileng kateng – e bontša hore na ke tsela efe e tlisang baeti ba bangata.',
    company_id: 'Haeba khamphani kapa lefapha la mmuso le lefa ho lula, le khethe: bili e ngoloa akhaonteng ea bona ha moeti a tsamaea.',
    notes: 'Nako ea ho fihla, likopo tse khethehileng, ngoliso ea koloi…',
    check_in_now: 'Moeti ea fihlang ka tšohanyetso ea seng a le teng – booking e kenngoa hang-hang.'
  },
  bookpay: {
    amount: 'Chelete e amohetsoeng hona joale. Depositi e bolokoa akhaonteng ea moeti ’me e ntšoa bilong ha a tsamaea.',
    method_id: 'Kamoo chelete e fihlileng kateng – e kena till eo, bankeng kapa akhaonteng ea M-Pesa.',
    reference: 'Khoutu ea M-Pesa / EcoCash, reference ea EFT kapa nomoro ea receipt.'
  },
  roomcharge: {
    description: 'Se lefisoang kamoreng: ho hlatsoa liaparo, mohala, minibar, bethe e eketsehileng, ho tsamaea morao…',
    amount: 'Chelete ho kenyeletsa VAT. Lijo le lino tse tsoang ho POS li lefisoa kamoreng ka ho khetha "Room / guest account" till.',
    date: 'Letsatsi la tefiso – le hatisoa bilong ea moeti.'
  },
  patient: {
    first_name: 'Joalo ka ha ho le ID kapa bukana ea bophelo.',
    dob: 'Letsatsi la tsoalo – lilemo li baloa ’me li hatisoa ho lingoloa tsa meriana le ho li-label. Bakeng sa ngoana, tekanyo ea moriana hangata e itšetlehile ka tsona.',
    phone: 'Nomoro ea mohala bakeng sa ho latela le likhopotso tsa tefo.',
    id_number: 'ID ea naha kapa phasepoto – e thusa ho fumana faele e nepahetseng ha mabitso a tšoana.',
    allergies: 'Meriana kapa lijo tseo mokuli a li hanang, li arotsoe ka likoma, mohl. "Penicillin, sulpha". Meriana ea sehlopha seo e thibeloa ha e ngoloa ho fihlela ngaka kapa mooki a netefatsa. Ngola "None known" haeba u botsitse ’me ho se letho.',
    chronic: 'Maloetse a nako e telele le meriana, mohl. "Khatello e phahameng – amlodipine 5 mg; HIV ho ART". E bontšoa ketelong e ’ngoe le e ’ngoe.',
    medical_aid_id: 'Medical aid e lefang mokuli enoa. Eketsa li-medical aid tlas\'a Patients → Medical-aid claims.',
    medical_aid_no: 'Nomoro ea setho hantle joalo ka ha e le karete – claim e hanoa ntle le eona.',
    main_member: 'Lebitso la setho se seholo haeba mokuli e le motho ea itšetlehileng (ngoana kapa molekane).',
    blood_group: 'Haeba e tsebahala, mohl. O+.',
    next_of_kin: 'Motho oa ho ikopanya le eena tšohanyetsong.',
    species: 'Lingaka tsa liphoofolo: mofuta, morabe le lebitso la phoofolo; mong\'a eona ke motho oa ho ikopanya le eena.',
    file_no: 'Nomoro ea faele ea hau ea pampiri e seng e le teng, kapa e tlohele e se na letho bakeng sa nomoro e iketsetsang (P00001…).',
    notes: 'Eng kapa eng eo kamohelo e lokelang ho e tseba – eseng lintlha tsa bongaka.'
  },
  arrival: {
    kind: 'Ho bona ngaka kapa mooki, ho latela, mosebetsi (ho tlama leqeba, ente) kapa khemisi feela (ho reka moriana kapa ho nka o pheta-phetoang).',
    practitioner_id: 'Mokuli o tla bona mang. E tlohele e se na letho ’me ngaka ea pele e mo bitsang e ea mo nka.',
    reason: 'Hobaneng mokuli a tlile, ka mantsoe a hae, mohl. "khohlela libeke tse 2".',
    temp: 'Mocheso ka °C, mohl. 36.8. Ho feta 37.5 ke feberu.',
    bp_sys: 'Nomoro e kaholimo ea khatello ea mali, mohl. 120.',
    bp_dia: 'Nomoro e ka tlase, mohl. 80.',
    pulse: 'Ho otla ha pelo ka motsotso.',
    resp: 'Ho hema ka motsotso.',
    spo2: 'Oksijene maling ho tsoa ho sesebelisoa sa monoana, %.',
    weight: 'Boima ka kg – bo hlokahala bakeng sa tekanyo ea meriana ea bana.',
    height: 'Bolelele ka cm – BMI e baloa hammoho le boima.',
    glucose: 'Tsoekere maling ka ho hlaba monoana ka mmol/l.'
  },
  visit: {
    reason: 'Tletlebo e kholo.',
    history: 'Nalane ea tletlebo, maloetse a mang, meriana e nkuoeng.',
    exam: 'Seo u se fumaneng tlhahlobong.',
    diagnosis: 'Lefu le fumanoeng kapa se entsoeng – le hlokahala ho qeta ketelo ’me le hatisoa ho claim ea medical aid.',
    icd10: 'Khoutu ea ICD-10, mohl. J06.9 (tšoaetso ea tsela ea moea e kaholimo), I10 (khatello e phahameng). Li-medical aid tse ngata lia e hloka.',
    plan: 'Moralo oa phekolo, likeletso le liteko tse kopiloeng.',
    sick_note_days: 'Matsatsi a phomolo mosebetsing kapa sekolong – setifikeiti sa bongaka se ka hatisoa.',
    follow_up: 'Letsatsi leo mokuli a lokelang ho khutla ka lona.'
  },
  visititem: {
    product_id: 'Khetha lihlahisoeng tsa hau. Meriana ke lintho tsa setoko (tse nang le li-batch le letsatsi la ho fela); ho bona ngaka le mesebetsi ke lihlahisoa tsa tšebeletso.',
    qty: 'Ke liyuniti tse kae tse fanoang – lipilisi, li-capsule, libotlolo kapa li-tube. Setoko se tsoa ha ketelo e bilioa.',
    dosage: 'Litaelo tse hatisoang ho label, ka mantsoe ao mokuli a a utloisisang, mohl. "Noa lipilisi tse 2 ka makhetlo a 3 ka letsatsi ka mor\'a lijo".',
    duration: 'E nkuoe nako e kae, mohl. "matsatsi a 5" kapa "ho fihlela o fela".',
    description: 'Tšebeletso e seng lethathamong, mohl. "Ho tlama leqeba".',
    unit_price: 'E tlohele e se na letho ho sebelisa theko ea sehlahisoa.'
  },
  visitbill: {
    bill_to: 'Mokuli, kapa medical aid e faeleng ea mokuli. Li-invoice tsa medical aid li hlaha tlas\'a Medical-aid claims ho fihlela li lefuoa.',
    copay: 'Karolo eo mokuli a e lefang ka boeena (levy, khaello). E bilioa mokuli ’me e ntšoa invoice ea medical aid.',
    amount: 'Seo mokuli a se lefang hona joale.',
    method_id: 'Chelete, karete, M-Pesa, EcoCash kapa banka.',
    reference: 'Reference ea mobile money kapa ea banka.',
    due_date: 'Haeba mokuli a lefa hamorao – likhopotso tsa tefo li sebelisa letsatsi lena.'
  },
  medaid: {
    name: 'mohl. "LNIG Medical Aid", "Old Mutual", "Metropolitan", "Momentum".',
    phone: 'Nomoro ea lefapha la li-claim.',
    email: 'Aterese eo li-claim le li-statement li romeloang ho eona.'
  },
  clinicset: {
    practice_no: 'Nomoro ea practice kapa ea laesense ea khemisi – e hatisoa ho lingoloa tsa meriana, litifikeiti le li-claim.',
    practitioner_title: 'E hatisoa tlas\'a tekeno, mohl. "Ngaka" kapa "Rakhemisi ea ngolisitsoeng".',
    label_note: 'Temoso e khutšoanyane ho label e ’ngoe le e ’ngoe ea moriana, mohl. "Boloka hole le bana".'
  },
  hireitem: {
    name: 'Seo moreki a se hirang, mohl. "Tente 10 × 20 m (stretch)", "Setulo sa polasetiki se sesoeu", "Foreime ea scaffolding 2 m", "Mixer ea konkreite 350 l".',
    code: 'Khoutu ea hau kapa tag ea thepa – e thusa tumellanong ea hire.',
    category: 'Arola lintho ka lihlopha bakeng sa manane le tlaleho, mohl. Litente, Litulo, Litafole, Mekhabiso, Scaffolding, Mechini.',
    qty_owned: 'U na le tse kae. Li-booking li ke ke tsa tšepisa ho feta mona (ho ntšoa tse senyehileng).',
    rate_day: 'Theko ka ntho ka letsatsi ho kenyeletsa VAT. Hire ho tloha Labohlano ho isa Mantaha ke matsatsi a 3; ho khutlisa ka letsatsi le le leng ho baloa e le letsatsi le le leng.',
    rate_week: 'Theko e tlase bakeng sa matsatsi a 7. Bili kamehla e sebelisa motsoako o theko e tlase ka ho fetisisa oa litheko tsa letsatsi, beke le khoeli.',
    rate_month: 'Theko bakeng sa matsatsi a 30, bakeng sa li-hire tse telele joaloka scaffolding sebakeng sa kaho.',
    deposit: 'Depositi ka ntho. Depositi ea order e kopanngoa ho tsoa linthong tsa eona (u ka e fetola ka order).',
    replacement_cost: 'Ho u jella bokae ho nkela e le ’ngoe sebaka. Lintho tse lahlehileng li lefisoa ka theko ena.',
    qty_out_of_service: 'Lintho tse senyehileng tse emetseng tokiso – li ke ke tsa bukoa ho fihlela u li tšoaea li lokisitsoe.',
    track_maintenance: 'Bakeng sa mechini (li-mixer, lijenereitara, li-compactor): e ngolise hape ho Maintenance hore tlhokomelo le ho senyeha ho lateloe.',
    service_days: 'Nako ea tlhokomelo ka matsatsi bakeng sa mochine.',
    active: 'E tlose ha u sa e hirise hape.'
  },
  hireorder: {
    start_date: 'Letsatsi leo lintho li tlohang ka lona (li nkuoa kapa li isoa). Haeba li tloha ka letsatsi le leng, letsatsi la ho fetisetsa le sebelisoa bakeng sa bili.',
    end_date: 'Letsatsi leo lintho li lokelang ho khutla ka lona. Lintho li lula li bukiloe ho fihlela li hlile li khutlile, le ha li liehile.',
    partner_id: 'Moreki ea khutlang – mo khethe hore hire e be akhaonteng le nalaneng ea hae.',
    customer_name: 'Lebitso la moreki e mocha – karete ea moreki e etsoa ka bo eona.',
    customer_phone: 'Nomoro ea mohala – e sebelisoa bakeng sa likhopotso le ha lintho li liehile.',
    id_number: 'Nomoro ea ID kapa phasepoto ea motho ea saenang – e hatisoa tumellanong ea hire.',
    delivery_address: 'Moo ho isoang le ho hahuoa teng; e tlohele e se na letho haeba moreki a nka.',
    delivery_fee: 'Lipalangoang le ho haha ho lefisoang bilong (ho kenyeletsa VAT).',
    deposit_required: 'E tlohele e se na letho ho sebelisa depositi ea lintho, kapa ngola chelete e ’ngoe (mohl. e nyane bakeng sa moreki oa kamehla).',
    notes: 'Nako ea ho haha, motho sebakeng, mebala, likopo tse khethehileng.'
  },
  hirepay: {
    date: 'Letsatsi leo lintho li tlohileng jareteng ea hau.',
    deposit: 'Depositi e nkuoang hona joale. E bolokoa ka thoko (hase chelete e kenang) ’me e ntšoa bilong ha lintho li khutla.',
    amount: 'Chelete e amohetsoeng hona joale.',
    method_id: 'Kamoo chelete e fihlileng kateng – chelete, karete, M-Pesa, EcoCash kapa banka.',
    reference: 'Khoutu ea M-Pesa / EcoCash, reference ea EFT kapa nomoro ea receipt.',
    no_deposit_ok: 'Bakeng sa bareki bao u ba tšepang feela – ka tloaelo sistimi e hana ho fetisetsa ntle le depositi e feletseng.',
    refund_method_id: 'Kamoo depositi e setseng e khutlisoang kateng.',
    keep_credit: 'E setseng e lula e le credit akhaonteng ea moreki bakeng sa hire e latelang.',
    due_date: 'Haeba moreki a lefa hamorao, invoice e lokela ho lefuoa ka letsatsi lena (likhopotso tsa tefo li le sebelisa).'
  },
  farmgroup: {
    name: 'mohl. "Ntlo ea likhoho tse beelang 1", "Li-broiler sehlopha 12", "Mohlape oa Merino", "Lipoli tsa Angora", "Likhomo tsa lebese", "Likolobe tse tšehali".',
    kind: 'Liphoofolo (likhomo, linku, lipoli, likolobe), likhoho, kapa tse ling (linotši, litlhapi, mebutla).',
    species: 'Mofuta oa phoofolo – o sebelisoa litlalehong le ho sisinngoa bakeng sa liphoofolo tse nang le li-tag.',
    purpose: 'U li ruetse eng – mahe, li-broiler, lebese, nama, boea, mohair, ho tsoalisa.',
    head_count: 'Bakeng sa mehlape eo u sa e tšoaeeng ka bonngoe (likhoho, mohlape oa linku): li kae. Lefu le ngotsoeng mohlapeng le fokotsa palo. Ka liphoofolo tse nang le li-tag palo e tsoa ho tsona.',
    started_on: 'Letsatsi leo mohlape o kentsoeng ka lona – le thusa ho bala lilemo (mohl. libeke tsa ho beela).',
    produce_id: 'Sehlahisoa sa setoko seo tlhahiso ea letsatsi e kenang ho sona, mohl. "Mahe – terei 30", "Lebese (litara)", "Boea (kg)". Se etse ho Products pele.',
    place: 'Ntlo, kampo, lesaka kapa motebo.',
    notes: 'Morekisi oa matsoana / liphoofolo, lenaneo la liente…',
    active: 'E tlose ha mohlape o rekisitsoe kaofela.'
  },
  animal: {
    tag: 'Nomoro ea tag ea tsebe, letšoao kapa tattoo – e tlameha ho ikhetha. Sebelisa ID ea mmuso ea liphoofolo moo e leng teng.',
    name: 'Lebitso, ha ho hlokahale, mohl. bakeng sa poho kapa khomo ea lebese.', species: 'khomo, nku, poli, kolobe…', breed: 'mohl. Merino, Dorper, Angora, Boer goat, Nguni, Bonsmara, Jersey.',
    sex: 'E tšehali kapa e tona – ke tse tšehali feela tse ka ngoloang tsoalo.', birth_date: 'Letsatsi la tsoalo le nepahetseng kapa le hakantsoeng – lilemo li bontšoa manethathamong.',
    group_id: 'Mohlape oo e leng ho oona.', acquired: 'E tsoaletsoe polasing kapa e rekiloe.', cost: 'Theko e lefiloeng ha e rekoa – karolo ea litšenyehelo tsa phoofolo.',
    weight: 'Boima bo tsebahalang ba ho qetela. Ho lekanya ho ngotsoeng hamorao ho bo nchafatsa.', notes: 'Matšoao, boitšoaro, nalane ea bophelo.'
  },
  field: { name: 'mohl. "Tšimo e tlase pel\'a noka", "Masimo a Ha Ramabanta".', size_ha: 'Boholo ka lihektara (1 ha = 100 m × 100 m).', place: 'Motse kapa sebaka.', irrigated: 'Tšoaea haeba e ka nosetsoa.', notes: 'Mofuta oa mobu, lime ea ho qetela, ho chenchana ha lijalo.', active: 'E tlose bakeng sa tšimo e sa sebelisoeng.' },
  season: {
    field_id: 'Tšimo eo e jetsoeng ho eona.', crop: 'mohl. poone, mabele, koro, linaoa, lierekisi, litapole, k\'habeche.', variety: 'Mofuta oa peo kapa morekisi.',
    area_ha: 'Lihektara tse jetsoeng (ha ho letho = tšimo eohle).', planted_on: 'Letsatsi la ho jala.', expected_harvest: 'Ha u lebelletse ho kotula.',
    produce_id: 'Sehlahisoa sa setoko seo kotulo e kenang ho sona, mohl. "Poone mokotla 50 kg". Se etse ho Products pele.', status: 'E reriloe, e ntse e hola, e kotutsoe kapa e hlolehile (sefako, komello…).', notes: 'Sebaka pakeng tsa limela, pula, mathata.'
  },
  farmlog: {
    kind: 'Tlhahiso = mahe a bokelitsoeng, lebese, boea kapa mohair o kutiloeng. Ho fepa / ente / phekolo / ho jala / manyolo / ho fafatsa li ntša sehlahisoa setokong. Kotulo e kenya sejalo setokong.',
    date: 'Letsatsi leo ho entsoeng ka lona – eseng nakong e tlang.', group_id: 'Mohlape oo e neng e le oa oona.', animal_id: 'Kapa phoofolo e le ’ngoe e nang le tag.', season_id: 'Kapa nako ea sejalo.',
    product_id: 'Se sebelisitsoeng (lijo, ente, moriana oa ho qoela, peo, manyolo) kapa se hlahisitsoeng. Lisebelisoa li tsoa setokong ka theko ea tsona – li reke ka Purchasing.',
    qty: 'Palo e sebelisitsoeng, ka yuniti ea sehlahisoa (mekotla, litekanyo, lilitara). Bakeng sa lefu mohlapeng: ho shoele tse kae.',
    produced_qty: 'Ho bokelitsoe kapa ho kotutsoe bokae (literei, lilitara, kg, mekotla) – ho kena setokong.',
    weight: 'Boima ka kg.', cost: 'Meputso, khontraktara (ho lema, ho kuta) kapa tšenyehelo e ’ngoe e lefiloeng kantle ho setoko.',
    next_due: 'Ha tekanyo e latelang kapa ente e lokela ho etsoa – e hlaha tlas\'a Health due.', final: 'Tšoaea kotulong ea ho qetela hore nako e koaloe.', note: 'Eng kapa eng e lokelang ho hopoloa.'
  },
  farmexit: { kind: 'E rekisitsoe (invoice e etsoa ho moreki), e shoele, kapa e hlabiloe.', date: 'Letsatsi.', partner_id: 'Moreki – eketsa bareki ba bacha ho Contacts.', amount: 'Theko ea ho rekisa.', weight: 'Boima ha e rekisoa kapa e hlabiloa.', note: 'Sesosa sa lefu, moo e rekisitsoeng teng…' },
  vehicle: {
    reg_no: 'Nomoro ea ngoliso hantle joalo ka ha e le ho disc ea laesense, mohl. "A 123 BCD".',
    name: 'Lebitso la bosoasoi leo bakhanni ba le sebelisang, ha ho hlokahale, mohl. "Quantum e putsoa".',
    kind: 'Mofuta oa koloi – litekesi le libese hangata li ngola chelete ea letsatsi, literaka le li-bakkie maeto.',
    seats: 'Litulo tsa bapalami – bakeng sa libese le litekesi tse lefisang ka setulo.',
    capacity_tons: 'E ka jara bokae – bakeng sa literaka tse lefisang ka thane.',
    odometer: 'Palo ea kilomitara hona joale. E nyoloha ka mafura a mang le a mang, leeto le chelete e ngotsoeng ’me e ke ke ea khutlela morao.',
    driver_id: 'Mokhanni ea e khannang ka tloaelo – o tlatsoa ka bo eona ho mafura, maeto le chelete. Bakhanni ba eketsoa ho HR e le basebetsi.',
    licence_expiry: 'Letsatsi leo disc ea laesense e felang ka lona – le bontšoa ka bofubelu skrineng ea Fleet matsatsi a 30 pele.',
    insurance_expiry: 'Letsatsi leo inshorense e lokelang ho nchafatsoa ka lona.',
    fitness_expiry: 'Setifikeiti sa ho tsamaea tseleng (roadworthy) bakeng sa lipalangoang tsa sechaba le literaka.',
    permit_expiry: 'Tumello ea ho sebetsa / ea tsela bakeng sa litekesi, libese le literaka tse tšelang moeli.',
    service_days: 'Nako ea tlhokomelo ka matsatsi – koloi e boetse ke mochine ho Maintenance, e u hopotsang ha tlhokomelo e hlokahala.',
    status: 'Likoloi tse tokisong le tse leetong li ke ke tsa romeloa leetong le lecha.',
    active: 'E tlose ha koloi e rekisitsoe kapa e ngotsoe e senyehile ka ho feletseng.'
  },
  fuel: {
    litres: 'Lilitara tse kentsoeng, ho tsoa ho slip ea mafura.',
    amount: 'Chelete e lefiloeng, ho tsoa ho slip. E ngoloa e le tšenyehelo ea mafura.',
    odometer: 'Palo ea kilomitara pompong – e hlokahala ho bala km ka litara.',
    full_tank: 'Tšoaea ha tanka e tlatsitsoe. km ka litara e baloa pakeng tsa litanka tse peli tse tletseng, kahoo e tlohele e tšoailoe ntle le haeba ho ekelitsoe feela.',
    station: 'Seteishene sa mafura, mohl. "Engen Maseru Mall".',
    method_id: 'E lefiloe joang hona joale (chelete, karete ea mafura bankeng, M-Pesa).',
    supplier_id: 'Haeba seteishene se u fa mokitlane, se khethe mona – se eketsoa ho seo u se kolotang ’me se lefuoa ka bili ea morekisi.'
  },
  trip: {
    vehicle_id: 'Koloi e etsang leeto – e tlameha ho ba e lokolohile ha e tloha.',
    driver_id: 'E tlohele e se na letho ho sebelisa mokhanni oa kamehla oa koloi.',
    from_place: 'Sebaka sa ho laela kapa toropo ea ho tloha.',
    to_place: 'Moo e eang teng, mohl. "Johannesburg City Deep".',
    partner_id: 'Moreki ea lefellang leeto. Maeto a felileng a moreki a le mong a ka kenngoa invoice e le ’ngoe hammoho.',
    load_desc: 'Ho jaroa eng, mohl. "mekotla e 30 ea samente" kapa "leeto la sekolo baithuti ba 45".',
    charge_by: 'Kamoo moreki a lefang kateng: theko e tsitsitseng ka leeto, ka km e khannoeng, ka thane, ka setulo kapa ka letsatsi la hire.',
    qty: 'Palo ea liyuniti tse lefisoang (lithane, litulo, matsatsi). Bakeng sa maeto a ka km, li-km tse khannoeng li tlatsoa ha koloi e khutla.',
    rate: 'Theko ka yuniti ntle le VAT – VAT e eketsoa ho invoice.',
    costs: 'Li-toll, litefiso tsa moeli, litumello le li-allowance tsa mokhanni tse lefiloeng bakeng sa leeto lena – li bontša phaello ea nnete ka leeto.',
    return_date: 'Letsatsi leo e lebelletsoeng kapa e khutlileng ka lona.'
  },
  takings: {
    amount: 'Chelete kapa M-Pesa eo mokhanni a e fileng bakeng sa letsatsi. E ngoloa e le chelete e kenang ea lipalangoang.',
    driver_id: 'Mokhanni ea sebelitseng ka koloi letsatsing leo – ho ngoloa hang feela ka koloi, mokhanni le letsatsi.',
    method_id: 'Moo chelete e ileng teng – lebokose la chelete, banka kapa mobile money.',
    trips: 'Palo ea meroalo kapa maeto a entsoeng – e bontša chelete ka leeto ha nako e ntse e tsamaea.',
    odometer: 'Palo ea kilomitara qetellong ea letsatsi (ha ho hlokahale).',
    notes: 'Eng kapa eng e khutšoanyane, mohl. "e haelloa M50 – ho senyeha Mafeteng".'
  }
};
