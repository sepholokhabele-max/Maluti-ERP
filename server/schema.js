// Database schema. Each migration runs once and is recorded in `schema_migrations`.
// Append new migrations to the end; never edit an applied one.
module.exports = [
  {
    id: 1,
    name: 'core',
    sql: [
      `CREATE TABLE IF NOT EXISTS settings (
        k VARCHAR(100) PRIMARY KEY,
        v JSON NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        username VARCHAR(60) NOT NULL UNIQUE,
        email VARCHAR(160) NULL,
        password_hash VARCHAR(100) NOT NULL,
        pin_hash VARCHAR(100) NULL,
        role ENUM('admin','manager','accountant','cashier','waiter','bartender','kitchen') NOT NULL DEFAULT 'cashier',
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS auth_tokens (
        token CHAR(64) PRIMARY KEY,
        user_id INT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB`,

      `CREATE TABLE IF NOT EXISTS audit_log (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NULL,
        action VARCHAR(80) NOT NULL,
        entity VARCHAR(60) NULL,
        entity_id BIGINT NULL,
        details JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS taxes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(60) NOT NULL,
        rate DECIMAL(6,3) NOT NULL DEFAULT 0,
        price_includes_tax TINYINT(1) NOT NULL DEFAULT 1,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        color VARCHAR(20) NOT NULL DEFAULT '#4f46e5',
        station ENUM('none','kitchen','bar') NOT NULL DEFAULT 'none',
        sort_order INT NOT NULL DEFAULT 0,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sku VARCHAR(60) NULL UNIQUE,
        barcode VARCHAR(80) NULL,
        name VARCHAR(160) NOT NULL,
        category_id INT NULL,
        type ENUM('stock','service','consumable') NOT NULL DEFAULT 'stock',
        uom VARCHAR(20) NOT NULL DEFAULT 'Unit',
        price DECIMAL(14,2) NOT NULL DEFAULT 0,
        cost DECIMAL(14,4) NOT NULL DEFAULT 0,
        tax_id INT NULL,
        stock_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
        reorder_level DECIMAL(14,3) NOT NULL DEFAULT 0,
        pos_visible TINYINT(1) NOT NULL DEFAULT 1,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (barcode), INDEX (name),
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
        FOREIGN KEY (tax_id) REFERENCES taxes(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS stock_moves (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        qty DECIMAL(14,3) NOT NULL,
        unit_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
        move_type ENUM('sale','refund','purchase','adjustment','invoice','opening') NOT NULL,
        reference VARCHAR(80) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (product_id), INDEX (created_at),
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS partners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        is_customer TINYINT(1) NOT NULL DEFAULT 1,
        is_supplier TINYINT(1) NOT NULL DEFAULT 0,
        phone VARCHAR(40) NULL,
        email VARCHAR(160) NULL,
        address VARCHAR(255) NULL,
        tax_number VARCHAR(60) NULL,
        credit_limit DECIMAL(14,2) NOT NULL DEFAULT 0,
        notes TEXT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (name), INDEX (phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS floors (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS restaurant_tables (
        id INT AUTO_INCREMENT PRIMARY KEY,
        floor_id INT NOT NULL,
        name VARCHAR(40) NOT NULL,
        seats INT NOT NULL DEFAULT 4,
        active TINYINT(1) NOT NULL DEFAULT 1,
        FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS pos_terminals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        mode ENUM('retail','restaurant','bar') NOT NULL DEFAULT 'retail',
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS pos_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        terminal_id INT NOT NULL,
        user_id INT NOT NULL,
        status ENUM('open','closed') NOT NULL DEFAULT 'open',
        opening_cash DECIMAL(14,2) NOT NULL DEFAULT 0,
        expected_cash DECIMAL(14,2) NULL,
        counted_cash DECIMAL(14,2) NULL,
        notes VARCHAR(255) NULL,
        opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME NULL,
        INDEX (status),
        FOREIGN KEY (terminal_id) REFERENCES pos_terminals(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB`,

      `CREATE TABLE IF NOT EXISTS payment_methods (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(60) NOT NULL,
        kind ENUM('cash','card','mobile_money','account','other') NOT NULL,
        account_code VARCHAR(20) NOT NULL,
        requires_reference TINYINT(1) NOT NULL DEFAULT 0,
        plugin_id VARCHAR(80) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS orders (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        session_id INT NULL,
        terminal_id INT NULL,
        user_id INT NULL,
        partner_id INT NULL,
        table_id INT NULL,
        tab_name VARCHAR(80) NULL,
        mode ENUM('retail','restaurant','bar') NOT NULL DEFAULT 'retail',
        status ENUM('open','paid','voided','refunded') NOT NULL DEFAULT 'open',
        guests INT NOT NULL DEFAULT 0,
        subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        discount_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        total DECIMAL(14,2) NOT NULL DEFAULT 0,
        paid_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        change_given DECIMAL(14,2) NOT NULL DEFAULT 0,
        cost_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        refund_of BIGINT NULL,
        notes VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        paid_at DATETIME NULL,
        INDEX (status), INDEX (paid_at), INDEX (session_id), INDEX (table_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS order_lines (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        order_id BIGINT NOT NULL,
        product_id INT NULL,
        name VARCHAR(200) NOT NULL,
        qty DECIMAL(14,3) NOT NULL DEFAULT 1,
        unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
        discount_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
        tax_rate DECIMAL(6,3) NOT NULL DEFAULT 0,
        price_includes_tax TINYINT(1) NOT NULL DEFAULT 1,
        net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        line_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        unit_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
        note VARCHAR(255) NULL,
        station ENUM('none','kitchen','bar') NOT NULL DEFAULT 'none',
        kitchen_status ENUM('pending','sent','preparing','ready','served') NOT NULL DEFAULT 'pending',
        sent_at DATETIME NULL,
        vas_transaction_id BIGINT NULL,
        INDEX (order_id), INDEX (kitchen_status),
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS payments (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        direction ENUM('in','out') NOT NULL DEFAULT 'in',
        order_id BIGINT NULL,
        invoice_id BIGINT NULL,
        partner_id INT NULL,
        method_id INT NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        reference VARCHAR(120) NULL,
        phone VARCHAR(40) NULL,
        status ENUM('pending','completed','failed','reversed') NOT NULL DEFAULT 'completed',
        session_id INT NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (order_id), INDEX (invoice_id), INDEX (created_at), INDEX (session_id),
        FOREIGN KEY (method_id) REFERENCES payment_methods(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS plugins (
        id VARCHAR(80) PRIMARY KEY,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        config JSON NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS vas_transactions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        plugin_id VARCHAR(80) NOT NULL,
        service VARCHAR(60) NOT NULL,
        provider VARCHAR(80) NULL,
        product_code VARCHAR(80) NULL,
        recipient VARCHAR(80) NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        commission DECIMAL(14,2) NOT NULL DEFAULT 0,
        status ENUM('pending','success','failed','reversed') NOT NULL DEFAULT 'pending',
        provider_ref VARCHAR(120) NULL,
        token VARCHAR(255) NULL,
        message VARCHAR(255) NULL,
        response JSON NULL,
        order_id BIGINT NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (created_at), INDEX (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(120) NOT NULL,
        type ENUM('asset','liability','equity','income','expense') NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS journal_entries (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        entry_date DATE NOT NULL,
        reference VARCHAR(80) NULL,
        memo VARCHAR(255) NULL,
        source_type VARCHAR(40) NULL,
        source_id BIGINT NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (entry_date), INDEX (source_type, source_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS journal_lines (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        entry_id BIGINT NOT NULL,
        account_id INT NOT NULL,
        partner_id INT NULL,
        description VARCHAR(255) NULL,
        debit DECIMAL(14,2) NOT NULL DEFAULT 0,
        credit DECIMAL(14,2) NOT NULL DEFAULT 0,
        INDEX (account_id),
        FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS purchase_orders (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        supplier_id INT NOT NULL,
        status ENUM('draft','confirmed','partial','received','cancelled') NOT NULL DEFAULT 'draft',
        order_date DATE NOT NULL,
        expected_date DATE NULL,
        subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        total DECIMAL(14,2) NOT NULL DEFAULT 0,
        billed TINYINT(1) NOT NULL DEFAULT 0,
        notes VARCHAR(255) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES partners(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS purchase_lines (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        po_id BIGINT NOT NULL,
        product_id INT NULL,
        description VARCHAR(200) NOT NULL,
        qty DECIMAL(14,3) NOT NULL,
        qty_received DECIMAL(14,3) NOT NULL DEFAULT 0,
        unit_cost DECIMAL(14,4) NOT NULL,
        tax_rate DECIMAL(6,3) NOT NULL DEFAULT 0,
        net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        line_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS invoices (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        kind ENUM('customer_invoice','supplier_bill') NOT NULL,
        partner_id INT NOT NULL,
        invoice_date DATE NOT NULL,
        due_date DATE NULL,
        status ENUM('draft','posted','partial','paid','cancelled') NOT NULL DEFAULT 'draft',
        subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        total DECIMAL(14,2) NOT NULL DEFAULT 0,
        amount_paid DECIMAL(14,2) NOT NULL DEFAULT 0,
        po_id BIGINT NULL,
        order_id BIGINT NULL,
        notes VARCHAR(255) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (kind, status),
        FOREIGN KEY (partner_id) REFERENCES partners(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS invoice_lines (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        invoice_id BIGINT NOT NULL,
        product_id INT NULL,
        description VARCHAR(200) NOT NULL,
        account_code VARCHAR(20) NULL,
        qty DECIMAL(14,3) NOT NULL,
        unit_price DECIMAL(14,4) NOT NULL,
        tax_rate DECIMAL(6,3) NOT NULL DEFAULT 0,
        net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        line_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS email_log (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        kind VARCHAR(40) NOT NULL,
        report_date DATE NULL,
        recipients TEXT NOT NULL,
        subject VARCHAR(255) NOT NULL,
        status ENUM('sent','failed') NOT NULL,
        error TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  },
  {
    id: 2,
    name: 'sales_recon_and_crm',
    sql: [
      `ALTER TABLE partners
         ADD COLUMN contact_person VARCHAR(120) NULL,
         ADD COLUMN birthday DATE NULL,
         ADD COLUMN tags VARCHAR(255) NULL,
         ADD COLUMN owner_id INT NULL`,

      `CREATE TABLE IF NOT EXISTS crm_activities (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        partner_id INT NOT NULL,
        type ENUM('note','call','meeting','task','email','sms','visit') NOT NULL DEFAULT 'note',
        subject VARCHAR(200) NOT NULL,
        body TEXT NULL,
        due_at DATETIME NULL,
        done TINYINT(1) NOT NULL DEFAULT 0,
        done_at DATETIME NULL,
        assigned_to INT NULL,
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (partner_id), INDEX (assigned_to, done, due_at),
        FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS sales_recons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        recon_date DATE NOT NULL UNIQUE,
        status ENUM('draft','submitted','approved') NOT NULL DEFAULT 'draft',
        expected_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        actual_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        variance_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        notes TEXT NULL,
        prepared_by INT NULL,
        prepared_at DATETIME NULL,
        approved_by INT NULL,
        approved_at DATETIME NULL,
        adjust_entry_id BIGINT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS sales_recon_lines (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        recon_id INT NOT NULL,
        method_id INT NOT NULL,
        txn_count INT NOT NULL DEFAULT 0,
        received DECIMAL(14,2) NOT NULL DEFAULT 0,
        refunded DECIMAL(14,2) NOT NULL DEFAULT 0,
        expected DECIMAL(14,2) NOT NULL DEFAULT 0,
        actual DECIMAL(14,2) NULL,
        already_posted DECIMAL(14,2) NOT NULL DEFAULT 0,
        variance DECIMAL(14,2) NOT NULL DEFAULT 0,
        adjustment_posted DECIMAL(14,2) NOT NULL DEFAULT 0,
        note VARCHAR(255) NULL,
        FOREIGN KEY (recon_id) REFERENCES sales_recons(id) ON DELETE CASCADE,
        FOREIGN KEY (method_id) REFERENCES payment_methods(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  },
  {
    id: 3,
    name: 'hrm_payroll',
    sql: [
      `CREATE TABLE IF NOT EXISTS departments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS employees (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(30) NULL UNIQUE,
        first_name VARCHAR(80) NOT NULL,
        last_name VARCHAR(80) NOT NULL,
        id_number VARCHAR(40) NULL,
        tin VARCHAR(40) NULL,
        gender ENUM('female','male','other') NULL,
        birth_date DATE NULL,
        phone VARCHAR(40) NULL,
        email VARCHAR(160) NULL,
        address VARCHAR(255) NULL,
        department_id INT NULL,
        job_title VARCHAR(100) NULL,
        employment_type ENUM('permanent','fixed_term','casual','intern') NOT NULL DEFAULT 'permanent',
        hire_date DATE NULL,
        termination_date DATE NULL,
        status ENUM('active','suspended','terminated') NOT NULL DEFAULT 'active',
        basic_salary DECIMAL(14,2) NOT NULL DEFAULT 0,
        paye_applies TINYINT(1) NOT NULL DEFAULT 1,
        pay_method ENUM('bank','cash','mobile_money') NOT NULL DEFAULT 'bank',
        bank_name VARCHAR(80) NULL,
        bank_account VARCHAR(60) NULL,
        mobile_money_number VARCHAR(40) NULL,
        user_id INT NULL,
        emergency_contact VARCHAR(160) NULL,
        notes TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (status),
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS employee_pay_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NOT NULL,
        kind ENUM('earning','deduction') NOT NULL,
        name VARCHAR(100) NOT NULL,
        amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        taxable TINYINT(1) NOT NULL DEFAULT 1,
        pre_tax TINYINT(1) NOT NULL DEFAULT 0,
        active TINYINT(1) NOT NULL DEFAULT 1,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS paye_tables (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        effective_from DATE NOT NULL UNIQUE,
        band_monthly DECIMAL(14,2) NOT NULL,
        lower_rate DECIMAL(6,3) NOT NULL,
        upper_rate DECIMAL(6,3) NOT NULL,
        credit_monthly DECIMAL(14,2) NOT NULL,
        source VARCHAR(255) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `INSERT IGNORE INTO paye_tables (name, effective_from, band_monthly, lower_rate, upper_rate, credit_monthly, source) VALUES
        ('Lesotho 2025/26', '2025-04-01', 6170.00, 20, 30, 970.00, 'Revenue Services Lesotho'),
        ('Lesotho 2026/27', '2026-04-01', 6480.00, 20, 30, 1020.00, 'RSL Income Tax structure effective 1 April 2026')`,

      `CREATE TABLE IF NOT EXISTS leave_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(60) NOT NULL,
        days_per_year DECIMAL(6,2) NOT NULL DEFAULT 0,
        paid TINYINT(1) NOT NULL DEFAULT 1,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS leave_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NOT NULL,
        leave_type_id INT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        days DECIMAL(6,2) NOT NULL,
        reason VARCHAR(255) NULL,
        status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
        decided_by INT NULL,
        decided_at DATETIME NULL,
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (employee_id, status),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        FOREIGN KEY (leave_type_id) REFERENCES leave_types(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS payroll_runs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        period CHAR(7) NOT NULL UNIQUE,
        pay_date DATE NULL,
        status ENUM('draft','approved','paid') NOT NULL DEFAULT 'draft',
        paye_enabled TINYINT(1) NOT NULL DEFAULT 1,
        paye_table_id INT NULL,
        gross_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        paye_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        deductions_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        net_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        employees INT NOT NULL DEFAULT 0,
        notes VARCHAR(255) NULL,
        journal_entry_id BIGINT NULL,
        payment_entry_id BIGINT NULL,
        created_by INT NULL, approved_by INT NULL, approved_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS payslips (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        run_id INT NOT NULL,
        employee_id INT NOT NULL,
        basic DECIMAL(14,2) NOT NULL DEFAULT 0,
        earnings_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        gross DECIMAL(14,2) NOT NULL DEFAULT 0,
        pre_tax_deductions DECIMAL(14,2) NOT NULL DEFAULT 0,
        taxable_income DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_before_credit DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_credit DECIMAL(14,2) NOT NULL DEFAULT 0,
        paye DECIMAL(14,2) NOT NULL DEFAULT 0,
        other_deductions DECIMAL(14,2) NOT NULL DEFAULT 0,
        net DECIMAL(14,2) NOT NULL DEFAULT 0,
        detail JSON NULL,
        UNIQUE KEY (run_id, employee_id),
        FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS payslip_adjustments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        run_id INT NOT NULL,
        employee_id INT NOT NULL,
        kind ENUM('earning','deduction') NOT NULL,
        name VARCHAR(100) NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        taxable TINYINT(1) NOT NULL DEFAULT 1,
        pre_tax TINYINT(1) NOT NULL DEFAULT 0,
        FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `INSERT INTO leave_types (name, days_per_year, paid)
        SELECT * FROM (SELECT 'Annual leave' n, 12 d, 1 p UNION ALL SELECT 'Sick leave', 11, 1 UNION ALL SELECT 'Maternity leave', 84, 1
          UNION ALL SELECT 'Family responsibility', 3, 1 UNION ALL SELECT 'Unpaid leave', 0, 0) x
        WHERE NOT EXISTS (SELECT 1 FROM leave_types)`,

      `INSERT INTO departments (name)
        SELECT * FROM (SELECT 'Front of house' n UNION ALL SELECT 'Kitchen' UNION ALL SELECT 'Bar' UNION ALL SELECT 'Shop floor' UNION ALL SELECT 'Administration') x
        WHERE NOT EXISTS (SELECT 1 FROM departments)`,

      `INSERT IGNORE INTO accounts (code, name, type) VALUES
        ('2200', 'PAYE Payable (RSL)', 'liability'),
        ('2210', 'Payroll Deductions Payable', 'liability'),
        ('2300', 'Net Salaries Payable', 'liability')`
    ]
  },
  {
    id: 4,
    name: 'receipt_qr_and_pay_qr',
    sql: [
      `ALTER TABLE orders ADD COLUMN receipt_token CHAR(24) NULL, ADD UNIQUE KEY uq_receipt_token (receipt_token)`,
      `ALTER TABLE payment_methods ADD COLUMN qr_payload VARCHAR(500) NULL, ADD COLUMN qr_label VARCHAR(120) NULL`
    ]
  },
  {
    id: 5,
    name: 'butchery',
    sql: [
      `ALTER TABLE products
         ADD COLUMN sold_by_weight TINYINT(1) NOT NULL DEFAULT 0,
         ADD COLUMN plu VARCHAR(10) NULL,
         ADD COLUMN track_batches TINYINT(1) NOT NULL DEFAULT 0,
         ADD COLUMN shelf_life_days INT NULL,
         ADD INDEX idx_products_plu (plu)`,
      `ALTER TABLE stock_moves
         MODIFY move_type ENUM('sale','refund','purchase','adjustment','invoice','opening','waste','breakdown') NOT NULL,
         ADD COLUMN reason VARCHAR(40) NULL`,
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('5150', 'Stock Losses & Wastage', 'expense')`,

      `CREATE TABLE IF NOT EXISTS stock_batches (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        batch_no VARCHAR(40) NOT NULL,
        source ENUM('purchase','breakdown','manual','adjustment','opening') NOT NULL DEFAULT 'manual',
        reference VARCHAR(80) NULL,
        received_date DATE NOT NULL,
        expiry_date DATE NULL,
        qty_in DECIMAL(14,3) NOT NULL DEFAULT 0,
        qty_remaining DECIMAL(14,3) NOT NULL DEFAULT 0,
        unit_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
        supplier_id INT NULL,
        notes VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (product_id, qty_remaining), INDEX (expiry_date),
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS batch_moves (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        batch_id INT NOT NULL,
        qty DECIMAL(14,3) NOT NULL,
        move_type VARCHAR(20) NOT NULL,
        reference VARCHAR(80) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (batch_id),
        FOREIGN KEY (batch_id) REFERENCES stock_batches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS cut_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        source_product_id INT NOT NULL,
        notes VARCHAR(255) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        FOREIGN KEY (source_product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS cut_template_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        template_id INT NOT NULL,
        product_id INT NULL,
        name VARCHAR(100) NOT NULL,
        yield_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
        is_waste TINYINT(1) NOT NULL DEFAULT 0,
        FOREIGN KEY (template_id) REFERENCES cut_templates(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS breakdowns (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(30) NULL UNIQUE,
        template_id INT NULL,
        source_product_id INT NOT NULL,
        source_batch_id INT NULL,
        source_qty DECIMAL(14,3) NOT NULL,
        source_cost_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        output_qty_total DECIMAL(14,3) NOT NULL DEFAULT 0,
        waste_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
        sale_value_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        breakdown_date DATE NOT NULL,
        notes VARCHAR(255) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS breakdown_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        breakdown_id INT NOT NULL,
        product_id INT NULL,
        name VARCHAR(100) NOT NULL,
        is_waste TINYINT(1) NOT NULL DEFAULT 0,
        expected_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
        actual_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
        unit_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
        cost_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        sale_value DECIMAL(14,2) NOT NULL DEFAULT 0,
        batch_id INT NULL,
        FOREIGN KEY (breakdown_id) REFERENCES breakdowns(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  },
  {
    id: 6,
    name: 'carcass_trace_production_bar',
    sql: [
      `ALTER TABLE products
         ADD COLUMN is_carcass TINYINT(1) NOT NULL DEFAULT 0,
         ADD COLUMN bottle_ml DECIMAL(10,1) NULL,
         ADD COLUMN bottle_empty_g DECIMAL(10,1) NULL,
         ADD COLUMN bottle_full_g DECIMAL(10,1) NULL,
         ADD COLUMN liquid_density DECIMAL(5,3) NULL,
         ADD COLUMN pour_from_id INT NULL,
         ADD COLUMN pour_ml DECIMAL(10,1) NULL`,
      `ALTER TABLE stock_moves MODIFY move_type ENUM('sale','refund','purchase','adjustment','invoice','opening','waste','breakdown','production','count') NOT NULL,
         MODIFY qty DECIMAL(16,4) NOT NULL`,
      // 4 decimals so bar measures (25 ml of a 750 ml bottle) don't drift
      `ALTER TABLE products MODIFY stock_qty DECIMAL(16,4) NOT NULL DEFAULT 0`,
      `ALTER TABLE stock_batches MODIFY source ENUM('purchase','breakdown','manual','adjustment','opening','production') NOT NULL DEFAULT 'manual'`,
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('4950', 'Stock Count Gains', 'income')`,

      // lineage: how many kg of a parent batch went into a child batch (breakdown cut / production output)
      `CREATE TABLE IF NOT EXISTS batch_links (
        id INT AUTO_INCREMENT PRIMARY KEY,
        child_batch_id INT NOT NULL,
        parent_batch_id INT NOT NULL,
        qty DECIMAL(14,3) NOT NULL,
        via ENUM('breakdown','production') NOT NULL,
        reference VARCHAR(80) NULL,
        INDEX (child_batch_id), INDEX (parent_batch_id),
        FOREIGN KEY (child_batch_id) REFERENCES stock_batches(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_batch_id) REFERENCES stock_batches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS recipes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        output_product_id INT NOT NULL,
        output_qty DECIMAL(14,3) NOT NULL DEFAULT 10,
        notes VARCHAR(255) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        FOREIGN KEY (output_product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS recipe_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        recipe_id INT NOT NULL,
        product_id INT NULL,
        name VARCHAR(100) NOT NULL,
        kind ENUM('meat','fat','casing','water','binder','spice','other') NOT NULL DEFAULT 'other',
        qty DECIMAL(14,3) NOT NULL DEFAULT 0,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS production_runs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(30) NULL UNIQUE,
        recipe_id INT NULL,
        output_product_id INT NOT NULL,
        output_qty DECIMAL(14,3) NOT NULL,
        output_batch_id INT NULL,
        input_qty_total DECIMAL(14,3) NOT NULL DEFAULT 0,
        meat_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
        cost_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        run_date DATE NOT NULL,
        notes VARCHAR(255) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (output_product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS production_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        run_id INT NOT NULL,
        product_id INT NULL,
        name VARCHAR(100) NOT NULL,
        kind VARCHAR(10) NOT NULL DEFAULT 'other',
        planned_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
        actual_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
        unit_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
        cost_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        batches VARCHAR(255) NULL,
        FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      // bar: bottle stock counted by weight
      `CREATE TABLE IF NOT EXISTS bar_counts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(30) NULL UNIQUE,
        count_date DATE NOT NULL,
        status ENUM('draft','posted') NOT NULL DEFAULT 'draft',
        notes VARCHAR(255) NULL,
        variance_value DECIMAL(14,2) NOT NULL DEFAULT 0,
        user_id INT NULL,
        posted_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS bar_count_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        count_id INT NOT NULL,
        product_id INT NOT NULL,
        full_bottles DECIMAL(10,4) NOT NULL DEFAULT 0,
        open_weights VARCHAR(255) NULL,
        open_ml DECIMAL(12,1) NOT NULL DEFAULT 0,
        counted_qty DECIMAL(16,4) NOT NULL DEFAULT 0,
        system_qty DECIMAL(16,4) NOT NULL DEFAULT 0,
        variance_qty DECIMAL(16,4) NOT NULL DEFAULT 0,
        variance_ml DECIMAL(12,1) NOT NULL DEFAULT 0,
        unit_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
        variance_value DECIMAL(14,2) NOT NULL DEFAULT 0,
        FOREIGN KEY (count_id) REFERENCES bar_counts(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  }
  ,{
    id: 7,
    name: 'species_live_weight',
    sql: [
      `ALTER TABLE products ADD COLUMN species VARCHAR(20) NULL, ADD INDEX idx_products_species (species)`,
      `ALTER TABLE stock_batches ADD COLUMN live_weight DECIMAL(14,3) NULL`
    ]
  }
];
