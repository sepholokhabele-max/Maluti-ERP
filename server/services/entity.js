// What kind of organisation is using S-ERP: informal trader, sole trader, partnership, private / public company,
// parastatal, government, NGO, cooperative, trust. It decides the income-tax treatment in the tax centre, the KYC
// documents asked for before activation, and suggests modules (e.g. e-procurement and the asset register in the public sector).
const ENTITY_TYPES = [
  { key: 'informal', name: 'Informal trader (not registered)', st: 'Morekisi ea sa ngolisoang', hint: 'Street vendor, hawker, spaza, home business – no company or business-name registration', tax: 'individual', registered: false,
    kyc: { owner_id: true, address: true, registration: false }, reg_label: null },
  { key: 'sole_trader', name: 'Sole trader (one owner, registered)', st: 'Mong\'a khoebo a le mong (e ngolisitsoe)', hint: 'Trader\'s licence or registered business name; the owner pays personal income tax', tax: 'individual', registered: true,
    kyc: { owner_id: true, address: true, registration: true }, reg_label: 'Trader\'s licence / business name no.' },
  { key: 'partnership', name: 'Partnership', st: 'Selekane', hint: 'Two or more partners; each partner pays income tax on their share', tax: 'individual', registered: true,
    kyc: { owner_id: true, address: true, registration: true }, reg_label: 'Partnership / trader\'s licence no.' },
  { key: 'private_company', name: 'Private company – (Pty) Ltd', st: 'Khamphani e ikemetseng – (Pty) Ltd', hint: 'Registered with the Registrar of Companies (OBFC); company income tax', tax: 'company', registered: true,
    kyc: { owner_id: true, address: true, registration: true }, reg_label: 'Company registration no.' },
  { key: 'public_company', name: 'Public company / corporate group – Ltd', st: 'Khamphani ea sechaba / koporasi', hint: 'Listed or large corporate with a board', tax: 'company', registered: true,
    kyc: { owner_id: true, address: true, registration: true }, reg_label: 'Company registration no.', suggest: ['assets', 'procurement'] },
  { key: 'parastatal', name: 'Parastatal / state-owned enterprise', st: 'Mokhatlo oa mmuso (parastatal)', hint: 'Owned or controlled by government (e.g. a water, power or development company)', tax: 'company', registered: true, public: true,
    kyc: { owner_id: true, address: true, registration: true }, reg_label: 'Establishing Act / registration no.', suggest: ['procurement', 'assets', 'fleet'] },
  { key: 'government', name: 'Government ministry, department or council', st: 'Lekala la mmuso kapa lekhotla', hint: 'Public body; not liable to income tax', tax: 'exempt', registered: true, public: true,
    kyc: { owner_id: true, address: true, registration: false }, reg_label: 'Vote / department code', suggest: ['procurement', 'assets', 'fleet'] },
  { key: 'ngo', name: 'NGO, church, association or non-profit', st: 'NGO, kereke kapa mokhatlo o sa etseng phaello', hint: 'Registered society or non-profit; usually exempt from income tax (check your RSL exemption)', tax: 'exempt', registered: true,
    kyc: { owner_id: true, address: true, registration: true }, reg_label: 'Society / NGO registration no.', suggest: ['assets', 'procurement'] },
  { key: 'cooperative', name: 'Cooperative society', st: 'Mokhatlo oa kopanelo (co-op)', hint: 'Registered under the Co-operative Societies Act', tax: 'company', registered: true,
    kyc: { owner_id: true, address: true, registration: true }, reg_label: 'Co-operative registration no.' },
  { key: 'trust', name: 'Trust', st: 'Trust', hint: 'Registered trust with trustees', tax: 'company', registered: true,
    kyc: { owner_id: true, address: true, registration: true }, reg_label: 'Trust deed / registration no.' }
];
const byKey = k => ENTITY_TYPES.find(e => e.key === k) || null;
module.exports = { ENTITY_TYPES, byKey };
