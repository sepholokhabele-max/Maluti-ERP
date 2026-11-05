// Sesotho help notes – Smartel connection, payment services at the till, settlements (1.18.0)
export const E = {
  portal: {
    enabled: 'Bareki ba ka bula link ea bona ea lekunutu (se setseng, li-invoice, statement). Tima ho koala li-link tsohle hang.',
    allow_proof: 'Bareki ba lefileng bankeng ba ka kenya slip. E kena ho contact ea bona e le faele, ’me ofisi e fumana mosebetsi oa ho e hlahloba.',
    terminal_id: 'Litefo inthaneteng li feta till ena e hokahaneng le Smartel – ha li ee ho MyWallet ka kotloloho. Siea e se na letho haeba ha ho tefo inthaneteng.'
  },
  tax_settings: {
    tin: 'Nomoro ea hau ea molefi oa lekhetho (TIN) ho tsoa RSL – e setifikeiting sa ngoliso le mangolong ohle a RSL.',
    entity: 'Khamphani e lefa lekhetho la lekeno la khamphani; mohoebi a le mong o lefa lekhetho la lekeno la motho ka matsatsi a tšoanang.',
    vat_registered: 'Tšoaea haeba RSL e u ngolisitse bakeng sa VAT (ho qobelloa ka holim\'a M2 000 000 ka selemo). Joale return ea VAT e lefshoa khoeli le khoeli.',
    vat_rate: 'Sekhahla se tloaelehileng – 15% kajeno. Motlakase ke 10%; thepa e romeloang kantle le lijo tsa motheo ke 0%.',
    vat_due_day: 'Letsatsi la khoeli e latelang leo VAT e lefshoang ka lona – la 20.',
    paye_due_day: 'Letsatsi la khoeli e latelang leo PAYE e lefshoang ka lona – la 15.',
    wht_due_day: 'Letsatsi leo lekhetho le tšoaroang le lefshoang RSL – la 15.',
    cit_rate: '25% bakeng sa likhamphani tse ngata; 10% bakeng sa tlhahiso le temo ea khoebo.',
    year_end_month: 'Khoeli eo selemo sa hau sa lichelete se felang ka eona. Hangata ke Hlakubele (3): likarolo 30 Loetse, 31 Tšitoe, 31 Hlakubele, return 30 Phupjane.',
    fbt_enabled: 'Tšoaea haeba basebetsi ba fumana melemo e kang koloi, ntlo kapa likalimo tse theko e tlase.',
    fbt_rate: 'Sekhahla se boleng ba melemo. Mehloli e fapana – netefatsa le RSL.',
    rsl_phone: 'Nomoro e fumanang SMS ea MyWallet ha u lefa RSL ka MyWallet.',
    rsl_fee_fixed: 'Tefo ea tšebeletso ea ho lefa RSL ka MyWallet, joalo ka ha ho lumellanoe le My Wallet / Smartel. Ha MyWallet e fana ka tefo ea eona, ho sebelisoa eona. Tefo e bontšoa pele u netefatsa ’me e ngoloa e le tefo ea ho lefa lekhetho.',
    rsl_fee_pct: 'Phesente ea lekhetho e eketsoang tefong, mohl. 0.5.',
    rsl_fee_max: 'Tefo e phahameng ka ho fetisisa bakeng sa tefo e le ’ngoe. Siea e se na letho haeba ha ho moeli.',
    start_month: 'Li-return tsa pele ho khoeli ena ha li bontšoe. Siea e se na letho ho qala ho tloha ho ngoloa ha pele libukeng.'
  },
  tax_pay: {
    method: '"MyWallet ka Smartel" e lefa RSL ho till joalo ka sekoloto – u fumana referense ea MyWallet hang-hang. Ho seng joalo ngola tefo ea banka, M-Pesa kapa chelete eo u seng u e entse.',
    amount: 'U ka lefa ka likarolo; return e bontša se setseng.',
    pos_session_id: 'Till e nang le session e butsoeng moo u kenyang chelete.',
    account_code: 'Moo chelete e tsoang teng – e ntšoa akhaontong eo libukeng.',
    reference: 'Nomoro ea slip ea banka, EFT kapa risiti ea RSL.',
    fee: 'Tefo ea banka – e ngoloa e le tefo ea ho lefa lekhetho.'
  },
  tax_wht: {
    direction: 'E tšoeroe = u lefile kontraka chelete e fokolang ’me u tlameha ho lefa lekhetho leo ho RSL ka la 15. E tšoaretsoe = moreki o u lefile chelete e fokolang ’me o u file setifikeiti; se fokotsa lekhetho la hau la lekeno.',
    partner_id: 'Kontraka eo u e lefileng, kapa moreki ea u tšoaretseng lekhetho.',
    kind: 'Tefo e ne e le ea eng – e etsa qeto ea sekhahla.',
    gross: 'Chelete ea invoice PELE ho VAT.',
    tx_date: 'Letsatsi la tefo.',
    reference: 'Nomoro ea invoice kapa ea setifikeiti.'
  },
  tax_inputs: {
    benefits_value: 'Boleng ba melemo eohle kotara ena.', details: 'Tlhaloso e khutšoanyane.',
    levy_name: 'Mohl. Plastic levy.', basis: 'Mohl. "mekotla e 2 000 × M0.90".', amount: 'Chelete e lefshoang.',
    estimated_income: 'Phaello eo u e lebeletseng selemo sohle. Siea e se na letho ho sebelisa phaello ea selemo se fetileng.',
    rate: 'Siea se se na letho ho sebelisa sekhahla sa Settings.',
    add_backs: 'Litšenyehelo tseo molao o sa li lumelleng, mohl. likotlo.',
    allowances: 'Ho senyeha ha thepa (capital allowances) ka litekanyetso tsa RSL.',
    losses_brought_forward: 'Tahlehelo ea lilemo tse fetileng eo RSL e e amohetseng.'
  },
  tax_file: { filed_ref: 'Nomoro ea netefatso ho tsoa RSL e-Tax kapa setempe sa RSL.' },
  tax_levy: { levy_name: 'Mohl. Plastic levy.', basis: 'Kamoo e baliloeng kateng.', amount: 'Chelete.', period_from: 'Letsatsi la pele.', period_to: 'Letsatsi la ho qetela.', due_date: 'Letsatsi leo RSL e e batlang.' },
  smartel: {
    enabled: 'Bulela ha liaterese le litifikeiti tsa li-till li se li kentsoe. Ha e butsoe, litšebeletso tsa chelete, litefo tsa karete / MyWallet / Switch, ho khutlisa lihlahisoa le register li sebetsa ka Smartel.',
    pos_api_url: 'Aterese ea pos-api e lengolong la Smartel, e qala ka https://. S-ERP ha e letsetse MyWallet ka boeona – ke aterese ena feela.',
    syncd_url: 'Aterese ea syncd e lengolong. Lirisiti tse tiisitsoeng li ea mona; ho khutlisa, lihlahisoa, litheko le Thoki li tsoa mona.',
    auth: 'Tloaelo: till ka ’ngoe e kena ka setifikeiti sa eona. Sebelisa "gateway e tšeptjoang" feela ha Smartel e kentse gateway lebenkeleng kapa bakeng sa teko.',
    merchant_id: 'ID ea hau ea mohoebi ea Smartel (lengolong). E sebelisoa bakeng sa meputso ka bongata.',
    ca_pem: 'Setifikeiti sa CA sa Smartel, se kenngoa e le mongolo. Siea se se na letho haeba Smartel e re ho sebelisoa litifikeiti tse tloaelehileng.',
    portal_auth: 'Kamoo mong’a khoebo a kenang bakeng sa meputso. "Token ea portal" haeba Smartel e u file eona.',
    portal_sub: 'Lebitso la mosebelisi oa mong’a khoebo portal ea Smartel.',
    portal_token: 'Token e tsoang portal ea Smartel. E bolokoa e le lekunutu – ha e sa bontšoa hape.',
    npr: 'Sehlahisoa se seng le se seng se rekisoang se tlameha ho ba ho Register ea Naha. "Hana" e thibela li-barcode tse sa tsejoeng ’me e li tlaleha; "Lemosa" feela ha u ntse u lokisa.',
    accept_prices: 'Tšoaea ho amohela litheko tseo Smartel e li romelang. Se tšoaee haeba u beha litheko tsa hau.',
    create_products: 'Tšoaea ho eketsa lihlahisoa tsa Smartel tseo u se nang tsona (li bapisoa ka barcode pele).',
    gps_lat: 'Sebaka sa lebenkele (mohl. -29.3167 bakeng sa Maseru). Se romeloa le lirisiti. Se fumane ho Google Maps.',
    gps_lng: 'Longitude, mohl. 27.4833 bakeng sa Maseru.',
    grn_terminal_id: 'Thepa e amoheloang ofising e tiisoa ketaneng ea till ena. Siea till ea pele haeba u sa tsebe.',
    timeout_s: 'Nako ea ho emela Smartel pele tšebeletso e nkoa e "sa tsejoe". Metsotsoana e 25 e tloaelehile. Tšebeletso e sa tsejoeng ha e romeloe hape.'
  },
  smartel_till: {
    terminal_uuid: 'ID ea till ENA e lengolong la Smartel (e shebahala joalo ka 7f3c2a10-…). Till ka ’ngoe e na le ea eona.',
    cert_pem: 'Setifikeiti sa till e le mongolo. Bula faele ea .crt / .pem ka Notepad ’me u kopitse tsohle.',
    key_pem: 'Senotlolo sa lekunutu sa till. Se boloke e le lekunutu – ha se sa bontšoa hape.'
  },
  smartel_settle: {
    kind: 'Seo MyWallet e se lefileng kapa seo u se fetisitseng. Sena se boloka liakhaonto tsa agency, chelete ea dijithale le khomishene li nepahetse.',
    amount: 'Chelete e ho statement ea MyWallet kapa slip ea banka.',
    account: 'Moo chelete e fihlileng kapa e tsoileng teng – hangata wallet ea khoebo ea MyWallet.',
    reference: 'Referense ea MyWallet kapa ea banka.',
    date: 'Letsatsi le ho statement. Siea le se na letho bakeng sa kajeno.'
  },
  agent: {
    cell: 'Nomoro ea MyWallet ea moreki – linomoro tse 8, mohl. 5812 3456. E balle moreki hape.',
    amount: 'Chelete ka Maloti. Tefo ea MyWallet e bontšoa pele u netefatsa – bolella moreki.',
    reference: 'Tlhaloso eo moreki a e batlang (ha e qobelloe).',
    account: 'Nomoro ea akhaonto ea agent kapa till.',
    cell_sender: 'Mohala oa motho ea romelang chelete.',
    cell_recipient: 'Mohala oa motho ea e amohelang.',
    tomember: 'Netweke e ’ngoe ea moreki (M-Pesa, EcoCash…).',
    voucher: 'Nomoro ea voucher eo moreki a e entseng wallet ea hae.',
    network: 'Vodacom kapa Econet.',
    meter: 'Nomoro ea metara ea LEC e linomoro tse 11.',
    biller: 'Ke mang ea lefuoang.',
    bouquet: 'Sephutheloana sa DStv.'
  }
};
