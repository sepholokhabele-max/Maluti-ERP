// Data import from other systems: the screen reads Excel / CSV in the browser and creates records through the normal
// API (so every rule still applies). This route only gives the importer what already exists, so rows can be matched
// to existing customers, products, buildings … and re-importing a file does not make duplicates.
const express = require('express');
const db = require('../db');
const { can } = require('../auth');
const { ah, bad } = require('../util');

const r = express.Router();
const INDEX = {
  partners: ['partners', `SELECT id, name, phone, is_customer, is_supplier, tags FROM partners`],
  products: ['catalog', `SELECT id, name, sku, barcode, type, stock_qty, cost FROM products`],
  categories: ['catalog', `SELECT id, name FROM categories`],
  taxes: ['catalog', `SELECT id, name, rate FROM taxes WHERE active = 1`],
  accounts: ['accounting', `SELECT id, code, name, type FROM accounts`],
  employees: ['hrm', `SELECT id, code, first_name, last_name, id_number, phone FROM employees`],
  departments: ['hrm', `SELECT id, name FROM departments`],
  patients: ['patients', `SELECT id, file_no, first_name, last_name, id_number, phone, dob FROM patients`],
  medical_aids: ['patients', `SELECT id, name FROM partners WHERE FIND_IN_SET('medical_aid', REPLACE(COALESCE(tags, ''), ' ', ''))`],
  learners: ['school', `SELECT id, admission_no, first_name, last_name FROM learners`],
  classes: ['school', `SELECT id, name, grade FROM school_classes`],
  properties: ['property', `SELECT id, name FROM properties`],
  units: ['property', `SELECT u.id, u.name, u.property_id, p.name property_name, (SELECT COUNT(*) FROM leases l WHERE l.unit_id = u.id AND l.status IN ('active','notice')) let FROM units u JOIN properties p ON p.id = u.property_id`],
  vehicles: ['fleet', `SELECT id, reg_no FROM vehicles`],
  fleet_staff: ['fleet', `SELECT id, first_name, last_name FROM employees WHERE status = 'active'`],
  hire_items: ['hire', `SELECT id, name, code FROM hire_items`],
  room_types: ['rooms', `SELECT id, name, rate FROM room_types`],
  rooms: ['rooms', `SELECT id, name FROM rooms`],
  equipment: ['maintenance', `SELECT id, name, code, serial_no FROM equipment`],
  sites: ['sites', `SELECT id, name, partner_id FROM sites`],
  leads: ['crm', `SELECT id, title, phone FROM leads`],
  locations: ['inventory', `SELECT id, name, code FROM locations`],
  farm_animals: ['farm', `SELECT id, tag FROM farm_animals`],
  farm_groups: ['farm', `SELECT id, name FROM farm_groups`],
  farm_fields: ['farm', `SELECT id, name FROM farm_fields`]
};
r.get('/import/index', ah(async (req, res) => {
  const out = {};
  for (const w of String(req.query.what || '').split(',').filter(Boolean)) {
    const x = INDEX[w]; if (!x) throw bad(`Unknown list ${w}`);
    if (!can(req.user, x[0]) && !(w === 'partners' && ['invoicing', 'property', 'school', 'sites', 'crm', 'patients', 'hire', 'rooms', 'farm'].some(p => can(req.user, p)))) { out[w] = []; continue; }
    out[w] = await db.query(x[1]).catch(() => []);
  }
  res.json(out);
}));

module.exports = r;
