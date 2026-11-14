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
  ,{
    id: 8,
    name: 'sales_pricing_bank_expenses_attendance',
    sql: [
      // ---- quotations & sales orders
      `CREATE TABLE IF NOT EXISTS sale_orders (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        quote_number VARCHAR(40) NULL UNIQUE,
        number VARCHAR(40) NULL UNIQUE,
        status ENUM('quote','sent','confirmed','invoiced','declined','cancelled') NOT NULL DEFAULT 'quote',
        partner_id INT NOT NULL,
        order_date DATE NOT NULL,
        valid_until DATE NULL,
        delivery_date DATE NULL,
        subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        discount_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        total DECIMAL(14,2) NOT NULL DEFAULT 0,
        customer_ref VARCHAR(80) NULL,
        notes VARCHAR(500) NULL,
        terms VARCHAR(1000) NULL,
        invoice_id BIGINT NULL,
        user_id INT NULL,
        confirmed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (status), FOREIGN KEY (partner_id) REFERENCES partners(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS sale_order_lines (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        order_id BIGINT NOT NULL,
        product_id INT NULL,
        description VARCHAR(200) NOT NULL,
        qty DECIMAL(14,3) NOT NULL,
        unit_price DECIMAL(14,4) NOT NULL,
        discount_pct DECIMAL(6,3) NOT NULL DEFAULT 0,
        tax_rate DECIMAL(6,3) NOT NULL DEFAULT 0,
        net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        line_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        rule_id INT NULL,
        FOREIGN KEY (order_id) REFERENCES sale_orders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE invoices ADD COLUMN sale_order_id BIGINT NULL`,
      `ALTER TABLE invoice_lines ADD COLUMN discount_pct DECIMAL(6,3) NOT NULL DEFAULT 0`,

      // ---- pricing rules & promotions
      `CREATE TABLE IF NOT EXISTS price_rules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        kind ENUM('percent','fixed_price','amount_off','multibuy') NOT NULL DEFAULT 'percent',
        value DECIMAL(14,4) NOT NULL DEFAULT 0,
        applies_to ENUM('all','category','product') NOT NULL DEFAULT 'product',
        product_id INT NULL,
        category_id INT NULL,
        min_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
        free_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
        customer_scope ENUM('all','partner','tag') NOT NULL DEFAULT 'all',
        partner_id INT NULL,
        partner_tag VARCHAR(40) NULL,
        days VARCHAR(20) NULL,
        time_from TIME NULL,
        time_to TIME NULL,
        date_from DATE NULL,
        date_to DATE NULL,
        on_pos TINYINT(1) NOT NULL DEFAULT 1,
        on_invoice TINYINT(1) NOT NULL DEFAULT 1,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE order_lines ADD COLUMN rule_id INT NULL`,

      // ---- bank / mobile money statement reconciliation
      `CREATE TABLE IF NOT EXISTS bank_statements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_code VARCHAR(20) NOT NULL,
        name VARCHAR(120) NOT NULL,
        date_from DATE NULL,
        date_to DATE NULL,
        opening_balance DECIMAL(14,2) NULL,
        closing_balance DECIMAL(14,2) NULL,
        status ENUM('open','done') NOT NULL DEFAULT 'open',
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS bank_statement_lines (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        statement_id INT NOT NULL,
        line_date DATE NOT NULL,
        description VARCHAR(255) NULL,
        reference VARCHAR(120) NULL,
        amount DECIMAL(14,2) NOT NULL,
        journal_line_id BIGINT NULL,
        match_kind ENUM('auto','manual','created') NULL,
        INDEX (statement_id), INDEX (journal_line_id),
        FOREIGN KEY (statement_id) REFERENCES bank_statements(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE journal_lines ADD COLUMN reconciled TINYINT(1) NOT NULL DEFAULT 0`,
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('6400', 'Bank Charges', 'expense'), ('4300', 'Interest Received', 'income'),
        ('2250', 'Staff Expense Claims Payable', 'liability'), ('6500', 'Travel & Transport', 'expense'), ('6600', 'Repairs & Maintenance', 'expense'),
        ('6700', 'Telephone & Airtime', 'expense'), ('6800', 'Fuel', 'expense')`,

      // ---- expense claims & approvals
      `CREATE TABLE IF NOT EXISTS expense_claims (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(30) NULL UNIQUE,
        user_id INT NOT NULL,
        claim_date DATE NOT NULL,
        description VARCHAR(255) NOT NULL,
        account_code VARCHAR(20) NOT NULL DEFAULT '6000',
        amount DECIMAL(14,2) NOT NULL,
        tax_rate DECIMAL(6,3) NOT NULL DEFAULT 0,
        paid_by ENUM('own','company') NOT NULL DEFAULT 'own',
        company_method_id INT NULL,
        supplier VARCHAR(120) NULL,
        receipt MEDIUMTEXT NULL,
        status ENUM('submitted','approved','rejected','reimbursed') NOT NULL DEFAULT 'submitted',
        approver_id INT NULL,
        decided_at DATETIME NULL,
        reject_reason VARCHAR(255) NULL,
        reimbursed_method_id INT NULL,
        reimbursed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (status), INDEX (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE purchase_orders MODIFY status ENUM('draft','to_approve','confirmed','partial','received','cancelled') NOT NULL DEFAULT 'draft',
        ADD COLUMN approved_by INT NULL, ADD COLUMN approved_at DATETIME NULL`,

      // ---- attendance
      `CREATE TABLE IF NOT EXISTS attendance (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        check_in DATETIME NOT NULL,
        check_out DATETIME NULL,
        source ENUM('pin','manual') NOT NULL DEFAULT 'pin',
        note VARCHAR(200) NULL,
        edited_by INT NULL,
        INDEX (user_id, check_in),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  }
  ,{
    id: 9,
    name: 'locations_transfers_modules',
    sql: [
      // ---- branches / warehouses / stock locations
      `CREATE TABLE IF NOT EXISTS locations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        kind ENUM('shop','warehouse','branch','transit','van','farm','site') NOT NULL DEFAULT 'shop',
        address VARCHAR(255) NULL,
        phone VARCHAR(40) NULL,
        is_default TINYINT(1) NOT NULL DEFAULT 0,
        sellable TINYINT(1) NOT NULL DEFAULT 1,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `INSERT IGNORE INTO locations (code, name, kind, is_default) VALUES ('MAIN', 'Main shop', 'shop', 1)`,
      `INSERT IGNORE INTO locations (code, name, kind, is_default, sellable) VALUES ('TRANSIT', 'In transit', 'transit', 0, 0)`,
      `CREATE TABLE IF NOT EXISTS product_locations (
        product_id INT NOT NULL,
        location_id INT NOT NULL,
        qty DECIMAL(16,4) NOT NULL DEFAULT 0,
        min_qty DECIMAL(16,4) NULL,
        bin VARCHAR(40) NULL,
        PRIMARY KEY (product_id, location_id),
        INDEX (location_id),
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (location_id) REFERENCES locations(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `INSERT IGNORE INTO product_locations (product_id, location_id, qty)
        SELECT p.id, l.id, p.stock_qty FROM products p JOIN locations l ON l.code = 'MAIN' WHERE p.type = 'stock'`,
      `ALTER TABLE stock_moves ADD COLUMN location_id INT NULL, ADD INDEX idx_moves_loc (location_id),
         MODIFY move_type ENUM('sale','refund','purchase','adjustment','invoice','opening','waste','breakdown','production','count','transfer') NOT NULL`,
      `UPDATE stock_moves SET location_id = (SELECT id FROM locations WHERE code = 'MAIN')`,
      `ALTER TABLE stock_batches ADD COLUMN location_id INT NULL, ADD INDEX idx_batches_loc (location_id)`,
      `UPDATE stock_batches SET location_id = (SELECT id FROM locations WHERE code = 'MAIN')`,
      `ALTER TABLE pos_terminals ADD COLUMN location_id INT NULL`,
      `ALTER TABLE purchase_orders ADD COLUMN location_id INT NULL`,
      `ALTER TABLE invoices ADD COLUMN location_id INT NULL`,
      `ALTER TABLE sale_orders ADD COLUMN location_id INT NULL`,
      `ALTER TABLE journal_entries ADD COLUMN location_id INT NULL, ADD INDEX idx_je_loc (location_id)`,
      `ALTER TABLE users ADD COLUMN location_id INT NULL`,

      // ---- transfers between locations (stock sits in "In transit" until received)
      `CREATE TABLE IF NOT EXISTS stock_transfers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        from_location_id INT NOT NULL,
        to_location_id INT NOT NULL,
        status ENUM('draft','sent','received','cancelled') NOT NULL DEFAULT 'draft',
        notes VARCHAR(255) NULL,
        user_id INT NULL,
        sent_at DATETIME NULL,
        received_at DATETIME NULL,
        received_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (status),
        FOREIGN KEY (from_location_id) REFERENCES locations(id),
        FOREIGN KEY (to_location_id) REFERENCES locations(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS stock_transfer_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transfer_id INT NOT NULL,
        product_id INT NOT NULL,
        qty DECIMAL(16,4) NOT NULL,
        qty_received DECIMAL(16,4) NULL,
        unit_cost DECIMAL(14,4) NULL,
        FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('5150', 'Transfer Shortages', 'expense')`
    ]
  }
  ,{
    id: 10,
    name: 'manufacturing_bom_work_orders',
    sql: [
      `CREATE TABLE IF NOT EXISTS boms (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        name VARCHAR(120) NOT NULL,
        code VARCHAR(40) NULL,
        output_qty DECIMAL(14,4) NOT NULL DEFAULT 1,
        labour_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
        overhead_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
        minutes INT NULL,
        shelf_life_days INT NULL,
        instructions TEXT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (product_id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS bom_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bom_id INT NOT NULL,
        product_id INT NOT NULL,
        qty DECIMAL(14,4) NOT NULL,
        scrap_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
        notes VARCHAR(120) NULL,
        FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS work_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        bom_id INT NULL,
        product_id INT NOT NULL,
        qty_planned DECIMAL(14,4) NOT NULL,
        qty_produced DECIMAL(14,4) NULL,
        qty_rejected DECIMAL(14,4) NULL,
        status ENUM('draft','confirmed','in_progress','done','cancelled') NOT NULL DEFAULT 'draft',
        location_id INT NULL,
        planned_date DATE NULL,
        started_at DATETIME NULL,
        finished_at DATETIME NULL,
        labour_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
        overhead_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
        material_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
        unit_cost DECIMAL(14,4) NULL,
        batch_no VARCHAR(60) NULL,
        expiry_date DATE NULL,
        output_batch_id INT NULL,
        qc_status ENUM('none','passed','failed') NOT NULL DEFAULT 'none',
        qc_notes VARCHAR(255) NULL,
        sale_order_id BIGINT NULL,
        notes VARCHAR(255) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (status), INDEX (product_id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS work_order_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        wo_id INT NOT NULL,
        product_id INT NOT NULL,
        qty_planned DECIMAL(14,4) NOT NULL,
        qty_used DECIMAL(14,4) NULL,
        unit_cost DECIMAL(14,4) NULL,
        cost_total DECIMAL(14,2) NULL,
        batches VARCHAR(255) NULL,
        FOREIGN KEY (wo_id) REFERENCES work_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('5210', 'Labour & overhead absorbed into production', 'expense')`,
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('5220', 'Production rejects & scrap', 'expense')`
    ]
  }
  ,{
    id: 11,
    name: 'maintenance_rfq_projects_helpdesk',
    sql: [
      `ALTER TABLE users MODIFY role ENUM('admin','manager','accountant','cashier','waiter','bartender','kitchen','technician','staff') NOT NULL DEFAULT 'cashier'`,
      // ---- machines & maintenance
      `CREATE TABLE IF NOT EXISTS equipment (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        code VARCHAR(40) NULL,
        category VARCHAR(60) NULL,
        location_id INT NULL,
        serial_no VARCHAR(80) NULL,
        supplier_id INT NULL,
        purchase_date DATE NULL,
        cost DECIMAL(14,2) NULL,
        warranty_until DATE NULL,
        interval_days INT NULL,
        last_service DATE NULL,
        next_service DATE NULL,
        status ENUM('working','down','retired') NOT NULL DEFAULT 'working',
        notes VARCHAR(255) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS maintenance_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        equipment_id INT NOT NULL,
        kind ENUM('corrective','preventive') NOT NULL DEFAULT 'corrective',
        priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
        title VARCHAR(160) NOT NULL,
        description TEXT NULL,
        status ENUM('new','in_progress','done','cancelled') NOT NULL DEFAULT 'new',
        machine_down TINYINT(1) NOT NULL DEFAULT 0,
        reported_by INT NULL,
        assigned_to INT NULL,
        scheduled_date DATE NULL,
        started_at DATETIME NULL,
        done_at DATETIME NULL,
        downtime_hours DECIMAL(10,2) NULL,
        labour_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
        parts_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
        external_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
        resolution VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (status), INDEX (equipment_id),
        FOREIGN KEY (equipment_id) REFERENCES equipment(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS maintenance_parts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT NOT NULL,
        product_id INT NOT NULL,
        qty DECIMAL(14,4) NOT NULL,
        unit_cost DECIMAL(14,4) NULL,
        FOREIGN KEY (request_id) REFERENCES maintenance_requests(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE work_orders ADD COLUMN equipment_id INT NULL`,
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('6900', 'Repairs & maintenance', 'expense')`,

      // ---- requests for quotation to several suppliers
      `CREATE TABLE IF NOT EXISTS rfqs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        status ENUM('draft','sent','closed','cancelled') NOT NULL DEFAULT 'draft',
        deadline DATE NULL,
        location_id INT NULL,
        notes VARCHAR(255) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS rfq_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rfq_id INT NOT NULL,
        product_id INT NULL,
        description VARCHAR(200) NOT NULL,
        qty DECIMAL(14,3) NOT NULL,
        FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS rfq_suppliers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rfq_id INT NOT NULL,
        partner_id INT NOT NULL,
        status ENUM('invited','replied','declined') NOT NULL DEFAULT 'invited',
        sent_at DATETIME NULL,
        replied_at DATETIME NULL,
        lead_days INT NULL,
        notes VARCHAR(255) NULL,
        po_id BIGINT NULL,
        UNIQUE KEY (rfq_id, partner_id),
        FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS rfq_quotes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rfq_id INT NOT NULL,
        line_id INT NOT NULL,
        partner_id INT NOT NULL,
        unit_cost DECIMAL(14,4) NOT NULL,
        awarded TINYINT(1) NOT NULL DEFAULT 0,
        UNIQUE KEY (line_id, partner_id),
        FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE,
        FOREIGN KEY (line_id) REFERENCES rfq_lines(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      // ---- projects, tasks, timesheets
      `CREATE TABLE IF NOT EXISTS projects (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(30) NULL UNIQUE,
        name VARCHAR(160) NOT NULL,
        partner_id INT NULL,
        manager_id INT NULL,
        status ENUM('active','on_hold','done','cancelled') NOT NULL DEFAULT 'active',
        billing ENUM('hourly','fixed','none') NOT NULL DEFAULT 'hourly',
        hourly_rate DECIMAL(14,2) NOT NULL DEFAULT 0,
        budget_hours DECIMAL(10,2) NULL,
        budget_amount DECIMAL(14,2) NULL,
        start_date DATE NULL,
        end_date DATE NULL,
        location_id INT NULL,
        sale_order_id BIGINT NULL,
        description TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT NULL,
        status ENUM('todo','doing','review','done') NOT NULL DEFAULT 'todo',
        priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
        assigned_to INT NULL,
        due_date DATE NULL,
        estimate_hours DECIMAL(10,2) NULL,
        sort INT NOT NULL DEFAULT 0,
        created_by INT NULL,
        done_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (project_id, status), INDEX (assigned_to),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS timesheets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        work_date DATE NOT NULL,
        hours DECIMAL(6,2) NOT NULL,
        project_id INT NULL,
        task_id INT NULL,
        ticket_id INT NULL,
        description VARCHAR(255) NULL,
        billable TINYINT(1) NOT NULL DEFAULT 1,
        rate DECIMAL(14,2) NOT NULL DEFAULT 0,
        cost_rate DECIMAL(14,2) NOT NULL DEFAULT 0,
        invoice_id BIGINT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id, work_date), INDEX (project_id), INDEX (ticket_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE invoices ADD COLUMN project_id INT NULL, ADD COLUMN ticket_id INT NULL`,
      `ALTER TABLE expense_claims ADD COLUMN project_id INT NULL`,

      // ---- helpdesk & repairs
      `CREATE TABLE IF NOT EXISTS tickets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        partner_id INT NULL,
        contact_name VARCHAR(120) NULL,
        phone VARCHAR(40) NULL,
        email VARCHAR(120) NULL,
        subject VARCHAR(200) NOT NULL,
        description TEXT NULL,
        channel ENUM('phone','walk_in','email','whatsapp','other') NOT NULL DEFAULT 'phone',
        kind ENUM('question','problem','repair','request') NOT NULL DEFAULT 'problem',
        priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
        status ENUM('new','open','waiting','solved','closed') NOT NULL DEFAULT 'new',
        assigned_to INT NULL,
        project_id INT NULL,
        item VARCHAR(160) NULL,
        serial_no VARCHAR(80) NULL,
        sla_due DATETIME NULL,
        first_response_at DATETIME NULL,
        solved_at DATETIME NULL,
        invoice_id BIGINT NULL,
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (status), INDEX (assigned_to), INDEX (partner_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS ticket_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id INT NOT NULL,
        user_id INT NULL,
        body TEXT NOT NULL,
        internal TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS ticket_parts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id INT NOT NULL,
        product_id INT NOT NULL,
        qty DECIMAL(14,4) NOT NULL,
        unit_price DECIMAL(14,4) NOT NULL DEFAULT 0,
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  }
  ,{
    id: 12,
    name: 'pipeline_contracts_attachments',
    sql: [
      // ---- CRM pipeline (leads / opportunities)
      `CREATE TABLE IF NOT EXISTS crm_stages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(60) NOT NULL,
        sort INT NOT NULL DEFAULT 0,
        probability INT NOT NULL DEFAULT 10,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `INSERT INTO crm_stages (name, sort, probability) SELECT * FROM (SELECT 'New' n, 1 s, 10 p UNION ALL SELECT 'Qualified', 2, 30 UNION ALL SELECT 'Proposal sent', 3, 60 UNION ALL SELECT 'Negotiation', 4, 80) x
        WHERE NOT EXISTS (SELECT 1 FROM crm_stages)`,
      `CREATE TABLE IF NOT EXISTS leads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        partner_id INT NULL,
        company VARCHAR(160) NULL,
        contact_name VARCHAR(120) NULL,
        phone VARCHAR(40) NULL,
        email VARCHAR(120) NULL,
        source ENUM('walk_in','phone','whatsapp','facebook','referral','website','tender','other') NOT NULL DEFAULT 'other',
        stage_id INT NULL,
        status ENUM('open','won','lost') NOT NULL DEFAULT 'open',
        expected_value DECIMAL(14,2) NOT NULL DEFAULT 0,
        probability INT NULL,
        expected_close DATE NULL,
        owner_id INT NULL,
        priority TINYINT NOT NULL DEFAULT 1,
        notes TEXT NULL,
        lost_reason VARCHAR(160) NULL,
        sale_order_id BIGINT NULL,
        closed_at DATETIME NULL,
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (status, stage_id), INDEX (owner_id), INDEX (sale_order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      // activities can now belong to a lead instead of a customer: partner_id becomes optional (its foreign key name differs per server)
      async ({ query }) => {
        const fks = await query(`SELECT CONSTRAINT_NAME n FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_activities' AND COLUMN_NAME = 'partner_id' AND REFERENCED_TABLE_NAME IS NOT NULL`);
        for (const f of fks) await query(`ALTER TABLE crm_activities DROP FOREIGN KEY \`${f.n}\``);
        await query(`ALTER TABLE crm_activities MODIFY partner_id INT NULL, ADD COLUMN lead_id INT NULL, ADD INDEX idx_act_lead (lead_id)`);
        await query(`ALTER TABLE crm_activities ADD CONSTRAINT fk_act_partner FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE`);
      },

      // ---- contracts & recurring invoices
      `CREATE TABLE IF NOT EXISTS contracts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        partner_id INT NOT NULL,
        name VARCHAR(160) NOT NULL,
        status ENUM('draft','active','paused','ended') NOT NULL DEFAULT 'draft',
        period ENUM('weekly','monthly','quarterly','yearly') NOT NULL DEFAULT 'monthly',
        every INT NOT NULL DEFAULT 1,
        start_date DATE NOT NULL,
        next_date DATE NOT NULL,
        end_date DATE NULL,
        auto_post TINYINT(1) NOT NULL DEFAULT 0,
        due_days INT NOT NULL DEFAULT 7,
        project_id INT NULL,
        location_id INT NULL,
        notes VARCHAR(255) NULL,
        invoices_made INT NOT NULL DEFAULT 0,
        last_invoice_id BIGINT NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (status, next_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS contract_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contract_id INT NOT NULL,
        product_id INT NULL,
        description VARCHAR(200) NOT NULL,
        qty DECIMAL(14,3) NOT NULL DEFAULT 1,
        unit_price DECIMAL(14,4) NOT NULL,
        tax_rate DECIMAL(6,3) NOT NULL DEFAULT 15,
        FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE invoices ADD COLUMN contract_id INT NULL, ADD INDEX idx_inv_contract (contract_id)`,

      // ---- file attachments (kept in the database so backups include them)
      `CREATE TABLE IF NOT EXISTS attachments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        entity VARCHAR(30) NOT NULL,
        entity_id BIGINT NOT NULL,
        filename VARCHAR(200) NOT NULL,
        mime VARCHAR(100) NOT NULL,
        size INT NOT NULL,
        data MEDIUMBLOB NOT NULL,
        note VARCHAR(200) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (entity, entity_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  }
  ,{
    id: 13,
    name: 'property_school_sites',
    sql: [
      // fix: maintenance parts were booked to 6900 (Cash over/short) – move them to 6600 Repairs & maintenance
      `UPDATE journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
         SET l.account_id = (SELECT id FROM (SELECT id FROM accounts WHERE code = '6600') x) WHERE e.source_type = 'maintenance' AND a.code = '6900'`,
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('2400', 'Tenant deposits held', 'liability'), ('2410', 'Rent collected for landlords', 'liability'),
         ('4500', 'Management commission', 'income'), ('4600', 'Rental income', 'income'), ('4700', 'School fees', 'income'), ('5300', 'Consumables used on sites', 'expense')`,
      `ALTER TABLE contract_lines ADD COLUMN account_code VARCHAR(10) NULL`,
      `ALTER TABLE users MODIFY role ENUM('admin','manager','accountant','cashier','waiter','bartender','kitchen','technician','staff','supervisor') NOT NULL DEFAULT 'cashier'`,

      // ---- property & rent
      `CREATE TABLE IF NOT EXISTS properties (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        address VARCHAR(255) NULL,
        owner_id INT NULL,
        commission_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
        notes VARCHAR(255) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS units (
        id INT AUTO_INCREMENT PRIMARY KEY,
        property_id INT NOT NULL,
        name VARCHAR(60) NOT NULL,
        kind ENUM('flat','house','room','shop','office','warehouse','site','other') NOT NULL DEFAULT 'flat',
        bedrooms INT NULL,
        size_m2 DECIMAL(10,2) NULL,
        market_rent DECIMAL(14,2) NULL,
        meter_no VARCHAR(60) NULL,
        notes VARCHAR(255) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        FOREIGN KEY (property_id) REFERENCES properties(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS leases (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        unit_id INT NOT NULL,
        tenant_id INT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NULL,
        rent DECIMAL(14,2) NOT NULL,
        tax_rate DECIMAL(6,3) NOT NULL DEFAULT 0,
        due_day INT NOT NULL DEFAULT 1,
        deposit DECIMAL(14,2) NOT NULL DEFAULT 0,
        deposit_held DECIMAL(14,2) NOT NULL DEFAULT 0,
        escalation_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
        next_escalation DATE NULL,
        status ENUM('draft','active','notice','ended') NOT NULL DEFAULT 'draft',
        contract_id INT NULL,
        notice_date DATE NULL,
        ended_at DATE NULL,
        notes VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (unit_id, status), INDEX (tenant_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS owner_payouts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        property_id INT NOT NULL,
        period_from DATE NOT NULL,
        period_to DATE NOT NULL,
        collected DECIMAL(14,2) NOT NULL,
        commission DECIMAL(14,2) NOT NULL,
        paid DECIMAL(14,2) NOT NULL,
        method_id INT NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      // ---- school fees
      `CREATE TABLE IF NOT EXISTS school_classes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(60) NOT NULL,
        grade VARCHAR(40) NOT NULL,
        sort INT NOT NULL DEFAULT 0,
        teacher VARCHAR(120) NULL,
        capacity INT NULL,
        next_class_id INT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS learners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admission_no VARCHAR(30) NULL UNIQUE,
        first_name VARCHAR(80) NOT NULL,
        last_name VARCHAR(80) NOT NULL,
        gender ENUM('F','M') NULL,
        birth_date DATE NULL,
        class_id INT NULL,
        guardian_id INT NOT NULL,
        guardian2 VARCHAR(160) NULL,
        status ENUM('enrolled','left','graduated') NOT NULL DEFAULT 'enrolled',
        enrolled_on DATE NULL,
        left_on DATE NULL,
        bursary_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
        medical VARCHAR(255) NULL,
        notes VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (class_id, status), INDEX (guardian_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS fee_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        grade VARCHAR(40) NULL,
        amount DECIMAL(14,2) NOT NULL,
        period ENUM('term','year','month','once') NOT NULL DEFAULT 'term',
        optional TINYINT(1) NOT NULL DEFAULT 0,
        sibling_discount TINYINT(1) NOT NULL DEFAULT 1,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS learner_fees (
        learner_id INT NOT NULL,
        fee_item_id INT NOT NULL,
        PRIMARY KEY (learner_id, fee_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS fee_runs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        label VARCHAR(60) NOT NULL,
        period ENUM('term','year','month','once') NOT NULL,
        invoice_date DATE NOT NULL,
        due_date DATE NULL,
        invoices INT NOT NULL DEFAULT 0,
        total DECIMAL(14,2) NOT NULL DEFAULT 0,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY (label)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS fee_bills (
        run_id INT NOT NULL,
        learner_id INT NOT NULL,
        invoice_id BIGINT NOT NULL,
        PRIMARY KEY (run_id, learner_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE invoices ADD COLUMN learner_id INT NULL, ADD COLUMN lease_id INT NULL, ADD COLUMN site_id INT NULL`,

      // ---- sites, shifts, occurrence book, incidents, inspections (security & cleaning)
      `CREATE TABLE IF NOT EXISTS sites (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        partner_id INT NOT NULL,
        kind ENUM('security','cleaning','both') NOT NULL DEFAULT 'security',
        address VARCHAR(255) NULL,
        contact_name VARCHAR(120) NULL,
        contact_phone VARCHAR(40) NULL,
        staff_day INT NOT NULL DEFAULT 0,
        staff_night INT NOT NULL DEFAULT 0,
        billing ENUM('contract','per_shift','per_hour') NOT NULL DEFAULT 'contract',
        rate DECIMAL(14,2) NOT NULL DEFAULT 0,
        contract_id INT NULL,
        checklist TEXT NULL,
        instructions TEXT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS shifts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        site_id INT NOT NULL,
        employee_id INT NOT NULL,
        role ENUM('guard','supervisor','cleaner','driver','other') NOT NULL DEFAULT 'guard',
        start_at DATETIME NOT NULL,
        end_at DATETIME NOT NULL,
        status ENUM('planned','on_duty','done','absent','cancelled') NOT NULL DEFAULT 'planned',
        check_in_at DATETIME NULL,
        check_out_at DATETIME NULL,
        replaced_by INT NULL,
        invoice_id BIGINT NULL,
        note VARCHAR(255) NULL,
        INDEX (site_id, start_at), INDEX (employee_id, start_at), INDEX (status),
        FOREIGN KEY (site_id) REFERENCES sites(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS site_log (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        site_id INT NOT NULL,
        kind ENUM('on_duty','off_duty','patrol','visitor','handover','note') NOT NULL DEFAULT 'note',
        at DATETIME NOT NULL,
        employee_id INT NULL,
        text VARCHAR(500) NOT NULL,
        user_id INT NULL,
        INDEX (site_id, at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS incidents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        site_id INT NOT NULL,
        occurred_at DATETIME NOT NULL,
        kind ENUM('theft','break_in','trespass','fire','injury','damage','alarm','complaint','other') NOT NULL DEFAULT 'other',
        severity ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
        employee_id INT NULL,
        description TEXT NOT NULL,
        action_taken TEXT NULL,
        police_case VARCHAR(60) NULL,
        status ENUM('open','closed') NOT NULL DEFAULT 'open',
        client_informed TINYINT(1) NOT NULL DEFAULT 0,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (site_id, occurred_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS inspections (
        id INT AUTO_INCREMENT PRIMARY KEY,
        site_id INT NOT NULL,
        at DATETIME NOT NULL,
        items TEXT NOT NULL,
        score DECIMAL(5,1) NULL,
        signed_by VARCHAR(120) NULL,
        notes VARCHAR(500) NULL,
        user_id INT NULL,
        INDEX (site_id, at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  }
  ,{
    id: 14,
    name: 'reminders',
    sql: [
      `CREATE TABLE IF NOT EXISTS reminder_log (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        partner_id INT NOT NULL,
        channel ENUM('sms','email','whatsapp') NOT NULL,
        source VARCHAR(20) NOT NULL DEFAULT 'all',
        amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        sent_to VARCHAR(160) NULL,
        message TEXT NULL,
        status ENUM('sent','failed') NOT NULL,
        error VARCHAR(255) NULL,
        auto TINYINT(1) NOT NULL DEFAULT 0,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (partner_id, created_at), INDEX (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  }
  ,{
    id: 15,
    name: 'rooms_fleet',
    sql: [
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('4800', 'Transport income', 'income'), ('4850', 'Accommodation income', 'income')`,
      `ALTER TABLE users MODIFY role ENUM('admin','manager','accountant','cashier','waiter','bartender','kitchen','technician','staff','supervisor','receptionist') NOT NULL DEFAULT 'cashier'`,
      // ---- rooms & bookings
      `CREATE TABLE IF NOT EXISTS room_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        rate DECIMAL(14,2) NOT NULL,
        capacity INT NOT NULL DEFAULT 2,
        breakfast TINYINT(1) NOT NULL DEFAULT 0,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS rooms (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(40) NOT NULL,
        room_type_id INT NOT NULL,
        floor VARCHAR(20) NULL,
        housekeeping ENUM('clean','dirty','out_of_order') NOT NULL DEFAULT 'clean',
        notes VARCHAR(255) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        FOREIGN KEY (room_type_id) REFERENCES room_types(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS bookings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        room_id INT NOT NULL,
        guest_id INT NOT NULL,
        adults INT NOT NULL DEFAULT 1,
        children INT NOT NULL DEFAULT 0,
        check_in DATE NOT NULL,
        check_out DATE NOT NULL,
        rate DECIMAL(14,2) NOT NULL,
        status ENUM('reserved','checked_in','checked_out','cancelled','no_show') NOT NULL DEFAULT 'reserved',
        source ENUM('walk_in','phone','email','whatsapp','booking_site','agent','other') NOT NULL DEFAULT 'phone',
        company_id INT NULL,
        notes VARCHAR(255) NULL,
        checked_in_at DATETIME NULL,
        checked_out_at DATETIME NULL,
        invoice_id BIGINT NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (room_id, check_in, check_out), INDEX (status), INDEX (guest_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS booking_charges (
        id INT AUTO_INCREMENT PRIMARY KEY,
        booking_id INT NOT NULL,
        charge_date DATE NOT NULL,
        description VARCHAR(160) NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        user_id INT NULL,
        FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      // ---- fleet & trips
      `CREATE TABLE IF NOT EXISTS vehicles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reg_no VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(80) NULL,
        kind ENUM('car','bakkie','truck','bus','taxi','motorbike','trailer','other') NOT NULL DEFAULT 'bakkie',
        make VARCHAR(40) NULL, model VARCHAR(40) NULL, year INT NULL,
        fuel ENUM('diesel','petrol','other') NOT NULL DEFAULT 'diesel',
        seats INT NULL, capacity_tons DECIMAL(8,2) NULL,
        odometer INT NOT NULL DEFAULT 0,
        driver_id INT NULL,
        licence_expiry DATE NULL, insurance_expiry DATE NULL, fitness_expiry DATE NULL, permit_expiry DATE NULL,
        equipment_id INT NULL,
        status ENUM('available','on_trip','in_repair','sold') NOT NULL DEFAULT 'available',
        notes VARCHAR(255) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS fuel_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        vehicle_id INT NOT NULL,
        fill_date DATE NOT NULL,
        litres DECIMAL(10,2) NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        odometer INT NULL,
        full_tank TINYINT(1) NOT NULL DEFAULT 1,
        station VARCHAR(80) NULL,
        driver_id INT NULL,
        method_id INT NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (vehicle_id, fill_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS trips (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        vehicle_id INT NOT NULL,
        driver_id INT NULL,
        partner_id INT NULL,
        trip_date DATE NOT NULL,
        return_date DATE NULL,
        from_place VARCHAR(120) NULL,
        to_place VARCHAR(120) NULL,
        load_desc VARCHAR(160) NULL,
        odo_out INT NULL, odo_in INT NULL,
        charge_by ENUM('trip','km','ton','seat','day') NOT NULL DEFAULT 'trip',
        qty DECIMAL(12,2) NOT NULL DEFAULT 1,
        rate DECIMAL(14,2) NOT NULL DEFAULT 0,
        costs DECIMAL(14,2) NOT NULL DEFAULT 0,
        status ENUM('planned','on_trip','done','cancelled') NOT NULL DEFAULT 'planned',
        invoice_id BIGINT NULL,
        notes VARCHAR(255) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (vehicle_id, trip_date), INDEX (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS vehicle_takings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        vehicle_id INT NOT NULL,
        take_date DATE NOT NULL,
        driver_id INT NULL,
        amount DECIMAL(14,2) NOT NULL,
        method_id INT NOT NULL,
        trips INT NULL,
        notes VARCHAR(160) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY (vehicle_id, take_date, driver_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE invoices ADD COLUMN booking_id INT NULL`
    ]
  },
  {
    id: 16,
    name: 'equipment_hire',
    sql: [
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('2420', 'Hire deposits held', 'liability'), ('4880', 'Hire income', 'income')`,
      `CREATE TABLE IF NOT EXISTS hire_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        code VARCHAR(40) NULL,
        category VARCHAR(60) NULL,
        qty_owned DECIMAL(12,2) NOT NULL DEFAULT 1,
        qty_out_of_service DECIMAL(12,2) NOT NULL DEFAULT 0,
        rate_day DECIMAL(14,2) NOT NULL DEFAULT 0,
        rate_week DECIMAL(14,2) NULL,
        rate_month DECIMAL(14,2) NULL,
        deposit DECIMAL(14,2) NOT NULL DEFAULT 0,
        replacement_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
        equipment_id INT NULL,
        notes VARCHAR(255) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS hire_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        partner_id INT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        status ENUM('reserved','out','returned','settled','cancelled') NOT NULL DEFAULT 'reserved',
        delivery_address VARCHAR(255) NULL,
        delivery_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
        deposit_required DECIMAL(14,2) NOT NULL DEFAULT 0,
        deposit_held DECIMAL(14,2) NOT NULL DEFAULT 0,
        id_number VARCHAR(40) NULL,
        notes VARCHAR(255) NULL,
        handed_over_at DATETIME NULL,
        returned_at DATE NULL,
        invoice_id BIGINT NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (status), INDEX (partner_id), INDEX (start_date, end_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS hire_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        item_id INT NOT NULL,
        qty DECIMAL(12,2) NOT NULL,
        rate_day DECIMAL(14,2) NOT NULL,
        rate_week DECIMAL(14,2) NULL,
        rate_month DECIMAL(14,2) NULL,
        qty_back DECIMAL(12,2) NOT NULL DEFAULT 0,
        FOREIGN KEY (order_id) REFERENCES hire_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (item_id) REFERENCES hire_items(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS hire_returns (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        line_id INT NOT NULL,
        return_date DATE NOT NULL,
        qty DECIMAL(12,2) NOT NULL DEFAULT 0,
        damaged DECIMAL(12,2) NOT NULL DEFAULT 0,
        lost DECIMAL(12,2) NOT NULL DEFAULT 0,
        days INT NOT NULL,
        hire_charge DECIMAL(14,2) NOT NULL DEFAULT 0,
        damage_charge DECIMAL(14,2) NOT NULL DEFAULT 0,
        note VARCHAR(160) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES hire_orders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE invoices ADD COLUMN hire_order_id INT NULL`
    ]
  },
  {
    id: 17,
    name: 'patients',
    sql: [
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('4960', 'Medical & consultation fees', 'income')`,
      `ALTER TABLE users MODIFY role ENUM('admin','manager','accountant','cashier','waiter','bartender','kitchen','technician','staff','supervisor','receptionist','clinician') NOT NULL DEFAULT 'cashier'`,
      `CREATE TABLE IF NOT EXISTS patients (
        id INT AUTO_INCREMENT PRIMARY KEY,
        file_no VARCHAR(30) NULL UNIQUE,
        first_name VARCHAR(80) NOT NULL,
        last_name VARCHAR(80) NULL,
        dob DATE NULL,
        sex ENUM('F','M','X') NULL,
        id_number VARCHAR(40) NULL,
        phone VARCHAR(40) NULL,
        email VARCHAR(120) NULL,
        address VARCHAR(255) NULL,
        next_of_kin VARCHAR(120) NULL,
        next_of_kin_phone VARCHAR(40) NULL,
        allergies VARCHAR(255) NULL,
        chronic VARCHAR(255) NULL,
        blood_group VARCHAR(5) NULL,
        species VARCHAR(40) NULL,
        partner_id INT NULL,
        medical_aid_id INT NULL,
        medical_aid_no VARCHAR(40) NULL,
        main_member VARCHAR(120) NULL,
        notes VARCHAR(255) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (last_name, first_name), INDEX (phone), INDEX (id_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS visits (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        patient_id INT NOT NULL,
        visit_date DATE NOT NULL,
        queue_no INT NULL,
        status ENUM('waiting','in_consult','done','billed','cancelled') NOT NULL DEFAULT 'waiting',
        kind ENUM('consultation','pharmacy','follow_up','procedure') NOT NULL DEFAULT 'consultation',
        practitioner_id INT NULL,
        reason VARCHAR(255) NULL,
        bp_sys INT NULL, bp_dia INT NULL, pulse INT NULL, resp INT NULL, spo2 INT NULL,
        temp DECIMAL(4,1) NULL, weight DECIMAL(6,2) NULL, height DECIMAL(5,1) NULL, glucose DECIMAL(5,1) NULL,
        history TEXT NULL, exam TEXT NULL,
        diagnosis VARCHAR(255) NULL, icd10 VARCHAR(20) NULL,
        plan TEXT NULL,
        sick_note_days INT NULL,
        follow_up DATE NULL,
        bill_to ENUM('patient','medical_aid') NULL,
        invoice_id BIGINT NULL, copay_invoice_id BIGINT NULL,
        started_at DATETIME NULL, done_at DATETIME NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (visit_date, status), INDEX (patient_id),
        FOREIGN KEY (patient_id) REFERENCES patients(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS visit_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        visit_id INT NOT NULL,
        kind ENUM('service','medicine') NOT NULL,
        product_id INT NULL,
        description VARCHAR(200) NOT NULL,
        qty DECIMAL(12,3) NOT NULL DEFAULT 1,
        unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_rate DECIMAL(6,3) NOT NULL DEFAULT 0,
        dosage VARCHAR(160) NULL,
        duration VARCHAR(40) NULL,
        dispensed TINYINT(1) NOT NULL DEFAULT 0,
        user_id INT NULL,
        FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE invoices ADD COLUMN visit_id INT NULL`
    ]
  },
  {
    id: 18,
    name: 'farm',
    sql: [
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('4910', 'Farm sales (animals & produce)', 'income'), ('5400', 'Farm inputs used (feed, medicine, seed, fertiliser)', 'expense')`,
      `ALTER TABLE users MODIFY role ENUM('admin','manager','accountant','cashier','waiter','bartender','kitchen','technician','staff','supervisor','receptionist','clinician','farmworker') NOT NULL DEFAULT 'cashier'`,
      `CREATE TABLE IF NOT EXISTS farm_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        kind ENUM('livestock','poultry','other') NOT NULL DEFAULT 'livestock',
        species VARCHAR(40) NULL,
        purpose VARCHAR(40) NULL,
        head_count INT NULL,
        started_on DATE NULL,
        place VARCHAR(120) NULL,
        produce_id INT NULL,
        notes VARCHAR(255) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS farm_animals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tag VARCHAR(40) NOT NULL UNIQUE,
        name VARCHAR(60) NULL,
        species VARCHAR(40) NOT NULL,
        breed VARCHAR(60) NULL,
        sex ENUM('F','M') NULL,
        birth_date DATE NULL,
        group_id INT NULL,
        mother_id INT NULL,
        acquired ENUM('born','bought','other') NOT NULL DEFAULT 'bought',
        cost DECIMAL(14,2) NOT NULL DEFAULT 0,
        weight DECIMAL(8,2) NULL,
        status ENUM('alive','sold','died','slaughtered') NOT NULL DEFAULT 'alive',
        exit_date DATE NULL, exit_note VARCHAR(160) NULL,
        notes VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (group_id), INDEX (status, species)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS farm_fields (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        size_ha DECIMAL(8,2) NULL,
        place VARCHAR(120) NULL,
        irrigated TINYINT(1) NOT NULL DEFAULT 0,
        notes VARCHAR(255) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS farm_seasons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        field_id INT NOT NULL,
        crop VARCHAR(60) NOT NULL,
        variety VARCHAR(60) NULL,
        area_ha DECIMAL(8,2) NULL,
        planted_on DATE NULL,
        expected_harvest DATE NULL,
        produce_id INT NULL,
        status ENUM('planned','growing','harvested','failed') NOT NULL DEFAULT 'growing',
        notes VARCHAR(255) NULL,
        FOREIGN KEY (field_id) REFERENCES farm_fields(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS farm_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        log_date DATE NOT NULL,
        kind ENUM('feed','vaccinate','treat','weigh','production','plant','fertilise','spray','harvest','labour','expense','birth','death','sale','other') NOT NULL,
        group_id INT NULL, animal_id INT NULL, season_id INT NULL,
        product_id INT NULL,
        qty DECIMAL(14,3) NULL,
        cost DECIMAL(14,2) NOT NULL DEFAULT 0,
        produced_qty DECIMAL(14,3) NULL,
        value DECIMAL(14,2) NOT NULL DEFAULT 0,
        weight DECIMAL(8,2) NULL,
        next_due DATE NULL,
        invoice_id BIGINT NULL,
        note VARCHAR(255) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (log_date), INDEX (group_id), INDEX (season_id), INDEX (animal_id), INDEX (kind, next_due)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  },
  {
    id: 19,
    name: 'campaigns_recruitment',
    sql: [
      `ALTER TABLE partners ADD COLUMN marketing_opt_out TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN opt_out_at DATETIME NULL`,
      `CREATE TABLE IF NOT EXISTS campaigns (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        channel ENUM('sms','email','both') NOT NULL DEFAULT 'sms',
        audience TEXT NULL,
        subject VARCHAR(160) NULL,
        message TEXT NULL,
        status ENUM('draft','scheduled','sending','sent','cancelled') NOT NULL DEFAULT 'draft',
        scheduled_at DATETIME NULL,
        sent_at DATETIME NULL,
        recipients INT NOT NULL DEFAULT 0, sent INT NOT NULL DEFAULT 0, failed INT NOT NULL DEFAULT 0,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS campaign_recipients (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        campaign_id INT NOT NULL,
        partner_id INT NOT NULL,
        channel ENUM('sms','email') NOT NULL,
        sent_to VARCHAR(160) NULL,
        status ENUM('sent','failed') NOT NULL,
        error VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (campaign_id), INDEX (partner_id),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS job_openings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(120) NOT NULL,
        department_id INT NULL,
        location VARCHAR(120) NULL,
        employment_type ENUM('permanent','fixed_term','casual','intern') NOT NULL DEFAULT 'permanent',
        positions INT NOT NULL DEFAULT 1,
        salary_from DECIMAL(14,2) NULL, salary_to DECIMAL(14,2) NULL,
        description TEXT NULL, requirements TEXT NULL,
        how_to_apply VARCHAR(255) NULL,
        closing_date DATE NULL,
        status ENUM('draft','open','closed','filled') NOT NULL DEFAULT 'open',
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS applicants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        opening_id INT NOT NULL,
        first_name VARCHAR(80) NOT NULL, last_name VARCHAR(80) NULL,
        phone VARCHAR(40) NULL, email VARCHAR(120) NULL, id_number VARCHAR(40) NULL,
        source ENUM('walk_in','referral','facebook','newspaper','radio','website','whatsapp','other') NOT NULL DEFAULT 'walk_in',
        stage ENUM('new','screening','interview','offer','hired','rejected','withdrawn') NOT NULL DEFAULT 'new',
        rating TINYINT NULL,
        interview_at DATETIME NULL, interviewer VARCHAR(120) NULL,
        salary_offered DECIMAL(14,2) NULL, start_date DATE NULL,
        employee_id INT NULL,
        reject_reason VARCHAR(160) NULL,
        notes TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NULL,
        INDEX (opening_id, stage),
        FOREIGN KEY (opening_id) REFERENCES job_openings(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS appraisals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NOT NULL,
        period VARCHAR(40) NOT NULL,
        review_date DATE NOT NULL,
        reviewer_id INT NULL,
        status ENUM('draft','discussed','closed') NOT NULL DEFAULT 'draft',
        overall DECIMAL(4,2) NULL,
        strengths TEXT NULL, improvements TEXT NULL, goals TEXT NULL, employee_comment TEXT NULL,
        increase_pct DECIMAL(5,2) NULL,
        increase_applied TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY (employee_id, period)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS appraisal_scores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        appraisal_id INT NOT NULL,
        criterion VARCHAR(80) NOT NULL,
        weight DECIMAL(5,2) NOT NULL DEFAULT 1,
        score TINYINT NULL,
        comment VARCHAR(255) NULL,
        FOREIGN KEY (appraisal_id) REFERENCES appraisals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  },
  {
    id: 20,
    name: 'smartel_adapter',
    sql: [
      `CREATE TABLE IF NOT EXISTS smartel_terminals (
        pos_terminal_id INT PRIMARY KEY,
        terminal_uuid VARCHAR(64) NOT NULL,
        cert_pem TEXT NULL, key_pem TEXT NULL,
        device_seq BIGINT NOT NULL DEFAULT 0,
        head_hash CHAR(64) NOT NULL DEFAULT 'GENESIS',
        quarantined TINYINT(1) NOT NULL DEFAULT 0,
        quarantine_reason VARCHAR(255) NULL,
        last_push_at DATETIME NULL, last_heartbeat_at DATETIME NULL, last_error VARCHAR(255) NULL,
        receipt_seq INT NOT NULL DEFAULT 0,
        UNIQUE KEY (terminal_uuid),
        FOREIGN KEY (pos_terminal_id) REFERENCES pos_terminals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS smartel_sessions (
        session_uuid CHAR(36) PRIMARY KEY,
        pos_terminal_id INT NOT NULL,
        pos_session_id INT NULL,
        remote_open TINYINT(1) NOT NULL DEFAULT 0,
        state ENUM('open','closed','abandoned') NOT NULL DEFAULT 'open',
        order_id BIGINT NULL,
        receipt_no VARCHAR(40) NULL,
        goods_gross DECIMAL(14,2) NOT NULL DEFAULT 0,
        net_cash DECIMAL(14,2) NOT NULL DEFAULT 0,
        tender_seq INT NOT NULL DEFAULT 0,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, closed_at DATETIME NULL,
        INDEX (pos_session_id), INDEX (state)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS smartel_ops (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        session_uuid CHAR(36) NOT NULL,
        line_no INT NOT NULL,
        op VARCHAR(12) NOT NULL,
        fields JSON NULL,
        amount DECIMAL(14,2) NOT NULL,
        operation_id VARCHAR(64) NULL,
        state VARCHAR(16) NOT NULL DEFAULT 'draft',
        fee DECIMAL(14,2) NULL, commission DECIMAL(14,2) NULL,
        counterparty VARCHAR(160) NULL, account_masked VARCHAR(40) NULL,
        mw_ref VARCHAR(80) NULL, cash DECIMAL(14,2) NOT NULL DEFAULT 0,
        failure_code VARCHAR(40) NULL, result VARCHAR(255) NULL,
        booked TINYINT(1) NOT NULL DEFAULT 0,
        order_id BIGINT NULL, pos_session_id INT NULL, user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NULL,
        UNIQUE KEY (session_uuid, line_no), INDEX (state), INDEX (order_id), INDEX (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS smartel_intents (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        session_uuid CHAR(36) NOT NULL,
        tender_seq INT NOT NULL,
        tender ENUM('card','mywallet','switch') NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        intent_id VARCHAR(64) NULL,
        state VARCHAR(16) NOT NULL DEFAULT 'CREATED',
        payload TEXT NULL,
        mw_ref VARCHAR(80) NULL,
        order_id BIGINT NULL, user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NULL,
        UNIQUE KEY (session_uuid, tender_seq), INDEX (intent_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS smartel_outbox (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        pos_terminal_id INT NOT NULL,
        client_id CHAR(36) NOT NULL,
        type VARCHAR(20) NOT NULL,
        schema_version INT NOT NULL DEFAULT 1,
        device_seq BIGINT NOT NULL,
        device_time VARCHAR(40) NOT NULL,
        prev_hash CHAR(64) NOT NULL,
        hash CHAR(64) NOT NULL,
        body MEDIUMTEXT NOT NULL,
        status ENUM('pending','applied','duplicate','held','rejected') NOT NULL DEFAULT 'pending',
        code VARCHAR(40) NULL, reason VARCHAR(255) NULL,
        source_type VARCHAR(30) NULL, source_id BIGINT NULL,
        attempts INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, sent_at DATETIME NULL,
        UNIQUE KEY (client_id), UNIQUE KEY (pos_terminal_id, device_seq), INDEX (status), INDEX (source_type, source_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS smartel_cursors (
        scope VARCHAR(20) PRIMARY KEY,
        seq BIGINT NOT NULL DEFAULT 0,
        pulled_at DATETIME NULL, last_error VARCHAR(255) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS smartel_changes (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        scope VARCHAR(20) NOT NULL, seq BIGINT NOT NULL,
        entity VARCHAR(40) NULL, entity_id VARCHAR(80) NULL, op VARCHAR(20) NULL,
        payload JSON NULL, note VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY (scope, seq)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS smartel_recalls (
        recall_id VARCHAR(64) PRIMARY KEY,
        gtin VARCHAR(14) NOT NULL, lot VARCHAR(40) NULL,
        reason VARCHAR(255) NULL,
        received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME NULL,
        acked_at DATETIME NULL, units_blocked DECIMAL(14,3) NULL,
        INDEX (gtin)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS smartel_register (
        gtin VARCHAR(14) PRIMARY KEY,
        product_name VARCHAR(200) NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS smartel_register_lots (
        gtin VARCHAR(14) NOT NULL, lot VARCHAR(40) NOT NULL, expires_on DATE NULL,
        PRIMARY KEY (gtin, lot)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS smartel_credit (
        as_of DATE PRIMARY KEY,
        float_limit DECIMAL(14,2) NULL, arrears DECIMAL(14,2) NULL, stock_advance DECIMAL(14,2) NULL,
        pd_bp INT NULL, elasticity DECIMAL(8,4) NULL, ref VARCHAR(80) NULL,
        payload JSON NULL, received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS smartel_bulk (
        id INT AUTO_INCREMENT PRIMARY KEY,
        payroll_run_id INT NULL,
        batch_id VARCHAR(64) NULL,
        title VARCHAR(120) NOT NULL,
        total DECIMAL(14,2) NOT NULL DEFAULT 0,
        state VARCHAR(16) NOT NULL DEFAULT 'draft',
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS smartel_bulk_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bulk_id INT NOT NULL,
        line_no INT NOT NULL,
        employee_id INT NULL,
        name VARCHAR(160) NOT NULL, msisdn VARCHAR(16) NOT NULL, provider VARCHAR(20) NOT NULL DEFAULT 'mywallet',
        amount DECIMAL(14,2) NOT NULL,
        state VARCHAR(16) NOT NULL DEFAULT 'ready',
        mw_ref VARCHAR(80) NULL, failure VARCHAR(255) NULL,
        booked TINYINT(1) NOT NULL DEFAULT 0,
        UNIQUE KEY (bulk_id, line_no),
        FOREIGN KEY (bulk_id) REFERENCES smartel_bulk(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE products ADD COLUMN smartel_product_id VARCHAR(64) NULL, ADD INDEX (smartel_product_id)`,
      `ALTER TABLE stock_batches ADD COLUMN recalled TINYINT(1) NOT NULL DEFAULT 0`,
      `INSERT IGNORE INTO accounts (code, name, type) VALUES
        ('1150', 'Digital takings due from MyWallet (card, MyWallet, Switch)', 'asset'),
        ('1160', 'Agency commission receivable – MyWallet', 'asset'),
        ('1170', 'MyWallet business wallet', 'asset'),
        ('2450', 'Agency cash clearing – MyWallet services', 'liability'),
        ('4150', 'Agency commission income', 'income')`
    ]
  },
  {
    id: 21,
    name: 'tax_centre',
    sql: [
      `CREATE TABLE IF NOT EXISTS tax_returns (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tax VARCHAR(20) NOT NULL,
        period_label VARCHAR(40) NOT NULL,
        period_from DATE NOT NULL, period_to DATE NOT NULL, due_date DATE NOT NULL,
        status ENUM('draft','filed','paid','part_paid') NOT NULL DEFAULT 'draft',
        amount_due DECIMAL(14,2) NOT NULL DEFAULT 0,
        amount_paid DECIMAL(14,2) NOT NULL DEFAULT 0,
        figures JSON NULL,
        filed_at DATETIME NULL, filed_ref VARCHAR(80) NULL,
        journal_entry_id BIGINT NULL,
        notes VARCHAR(255) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY (tax, period_from, period_to), INDEX (due_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS tax_payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        return_id INT NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        fee DECIMAL(14,2) NOT NULL DEFAULT 0,
        method VARCHAR(20) NOT NULL,
        account_code VARCHAR(20) NULL,
        reference VARCHAR(80) NULL,
        smartel_op_id BIGINT NULL,
        status ENUM('pending','paid','failed') NOT NULL DEFAULT 'pending',
        paid_at DATETIME NULL, user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (return_id) REFERENCES tax_returns(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS tax_withholding (
        id INT AUTO_INCREMENT PRIMARY KEY,
        direction ENUM('deducted','suffered') NOT NULL,
        partner_id INT NOT NULL,
        kind VARCHAR(30) NOT NULL,
        tx_date DATE NOT NULL,
        gross DECIMAL(14,2) NOT NULL,
        rate DECIMAL(6,3) NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        reference VARCHAR(80) NULL,
        certificate_no VARCHAR(40) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (direction, tx_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `INSERT IGNORE INTO accounts (code, name, type) VALUES
        ('2110', 'VAT payable to RSL (filed returns)', 'liability'),
        ('1410', 'VAT refund due from RSL', 'asset'),
        ('1420', 'Withholding tax suffered (credit against income tax)', 'asset'),
        ('2220', 'Withholding tax payable (RSL)', 'liability'),
        ('2230', 'Income tax payable (RSL)', 'liability'),
        ('2240', 'Fringe benefit tax payable (RSL)', 'liability'),
        ('2260', 'Other taxes & levies payable (RSL)', 'liability'),
        ('6450', 'Tax payment fees', 'expense'),
        ('6460', 'Tax penalties & interest', 'expense'),
        ('6470', 'Fringe benefit tax', 'expense'),
        ('6480', 'Levies (plastic, gaming, other)', 'expense'),
        ('7100', 'Income tax expense', 'expense')`
    ]
  },
  {
    id: 22,
    name: 'customer_portal',
    sql: [
      `ALTER TABLE partners ADD COLUMN portal_token CHAR(32) NULL, ADD UNIQUE KEY uq_portal_token (portal_token)`,
      `ALTER TABLE smartel_intents ADD COLUMN partner_id INT NULL, ADD COLUMN allocated TINYINT(1) NOT NULL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS portal_log (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        partner_id INT NOT NULL,
        action VARCHAR(30) NOT NULL,
        detail VARCHAR(255) NULL,
        ip VARCHAR(60) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (partner_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  },
  {
    // Account codes that two modules had both claimed (INSERT IGNORE kept the first name):
    //   2250 staff expense claims (migration 8)  -> levies move to 2260
    //   4900 sales returns (default chart)       -> hire income moves to 4880
    //   4950 stock count gains (migration 6)     -> medical & consultation fees move to 4960
    id: 23,
    name: 'account_code_clashes',
    sql: [
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('2260', 'Other taxes & levies payable (RSL)', 'liability')`,
      `UPDATE journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
         SET l.account_id = (SELECT id FROM (SELECT id FROM accounts WHERE code = '2260') x)
       WHERE a.code = '2250' AND e.source_type IN ('tax_close', 'tax_payment')`,
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('4880', 'Hire income', 'income'), ('4960', 'Medical & consultation fees', 'income')`,
      `UPDATE accounts SET name = 'Sales Returns & Refunds' WHERE code = '4900'`,
      `UPDATE accounts SET name = 'Stock Count Gains' WHERE code = '4950'`,
      `UPDATE journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
         SET l.account_id = (SELECT id FROM (SELECT id FROM accounts WHERE code = '4880') x)
       WHERE a.code = '4900' AND e.source_type IN ('invoice', 'hire_deposit')`,
      `UPDATE journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
         SET l.account_id = (SELECT id FROM (SELECT id FROM accounts WHERE code = '4960') x)
       WHERE a.code = '4950' AND e.source_type = 'invoice'`,
      `UPDATE invoice_lines SET account_code = '4880' WHERE account_code = '4900'`,
      `UPDATE invoice_lines SET account_code = '4960' WHERE account_code = '4950'`
    ]
  },
  {
    // Water utility: customer connections (prepaid and postpaid), meters, reading routes, block tariffs, billing runs,
    // prepaid token vending, field jobs (connections, disconnections, repairs) and non-revenue water per zone.
    id: 24,
    name: 'water_utility',
    sql: [
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('4870', 'Water sales', 'income'), ('4875', 'Water service & sewer charges', 'income'),
        ('4876', 'Connection & reconnection fees', 'income'), ('2430', 'Water deposits held', 'liability'), ('5500', 'Network materials used', 'expense')`,
      `ALTER TABLE users MODIFY role ENUM('admin','manager','accountant','cashier','waiter','bartender','kitchen','technician','staff','supervisor','receptionist','clinician','farmworker','meterreader') NOT NULL DEFAULT 'cashier'`,
      `CREATE TABLE IF NOT EXISTS water_zones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        code VARCHAR(20) NULL,
        bulk_meter_no VARCHAR(60) NULL,
        reader_id INT NULL,
        notes VARCHAR(255) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS water_tariffs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        category ENUM('domestic','commercial','industrial','institutional','standpipe','other') NOT NULL DEFAULT 'domestic',
        blocks JSON NOT NULL,
        service_charge DECIMAL(14,2) NOT NULL DEFAULT 0,
        sewer_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
        min_m3 DECIMAL(10,3) NOT NULL DEFAULT 0,
        tax_rate DECIMAL(6,2) NOT NULL DEFAULT 0,
        active TINYINT(1) NOT NULL DEFAULT 1,
        notes VARCHAR(255) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS water_meters (
        id INT AUTO_INCREMENT PRIMARY KEY,
        serial VARCHAR(60) NOT NULL UNIQUE,
        kind ENUM('postpaid','prepaid') NOT NULL DEFAULT 'postpaid',
        make VARCHAR(60) NULL,
        size_mm INT NULL,
        status ENUM('in_store','installed','faulty','removed') NOT NULL DEFAULT 'in_store',
        account_id INT NULL,
        install_date DATE NULL,
        initial_reading DECIMAL(14,3) NOT NULL DEFAULT 0,
        notes VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS water_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_no VARCHAR(30) NOT NULL UNIQUE,
        partner_id INT NOT NULL,
        zone_id INT NULL,
        tariff_id INT NOT NULL,
        billing ENUM('postpaid','prepaid') NOT NULL DEFAULT 'postpaid',
        status ENUM('pending','active','disconnected','closed') NOT NULL DEFAULT 'pending',
        address VARCHAR(255) NULL,
        plot_no VARCHAR(60) NULL,
        gps VARCHAR(60) NULL,
        meter_id INT NULL,
        route_seq INT NOT NULL DEFAULT 0,
        connection_date DATE NULL,
        deposit_held DECIMAL(14,2) NOT NULL DEFAULT 0,
        debt_recovery_pct DECIMAL(6,2) NULL,
        notes VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (partner_id), INDEX (zone_id, route_seq), INDEX (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS water_readings (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        meter_id INT NULL,
        reading_date DATE NOT NULL,
        reading DECIMAL(14,3) NOT NULL,
        consumption DECIMAL(14,3) NULL,
        kind ENUM('actual','estimated','initial','final','customer') NOT NULL DEFAULT 'actual',
        flag VARCHAR(40) NULL,
        bill_id INT NULL,
        user_id INT NULL,
        notes VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (account_id, reading_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS water_bill_runs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        period CHAR(7) NOT NULL,
        run_date DATE NOT NULL,
        due_date DATE NULL,
        status ENUM('posted','cancelled') NOT NULL DEFAULT 'posted',
        bills INT NOT NULL DEFAULT 0,
        m3 DECIMAL(14,3) NOT NULL DEFAULT 0,
        total DECIMAL(14,2) NOT NULL DEFAULT 0,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS water_bills (
        id INT AUTO_INCREMENT PRIMARY KEY,
        run_id INT NOT NULL,
        account_id INT NOT NULL,
        period CHAR(7) NOT NULL,
        prev_reading DECIMAL(14,3) NULL,
        curr_reading DECIMAL(14,3) NULL,
        consumption DECIMAL(14,3) NOT NULL DEFAULT 0,
        billed_m3 DECIMAL(14,3) NOT NULL DEFAULT 0,
        estimated TINYINT(1) NOT NULL DEFAULT 0,
        water_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        service_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        sewer_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        total DECIMAL(14,2) NOT NULL DEFAULT 0,
        invoice_id BIGINT NULL,
        UNIQUE KEY (account_id, period), INDEX (run_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS water_vends (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(30) NULL,
        account_id INT NOT NULL,
        meter_id INT NULL,
        amount DECIMAL(14,2) NOT NULL,
        debt_recovered DECIMAL(14,2) NOT NULL DEFAULT 0,
        service_recovered DECIMAL(14,2) NOT NULL DEFAULT 0,
        water_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        units_m3 DECIMAL(14,3) NOT NULL DEFAULT 0,
        token VARCHAR(60) NULL,
        provider VARCHAR(40) NULL,
        provider_ref VARCHAR(80) NULL,
        method_id INT NULL,
        session_id INT NULL,
        user_id INT NULL,
        status ENUM('completed','reversed') NOT NULL DEFAULT 'completed',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (account_id, created_at), INDEX (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS water_jobs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(30) NULL,
        account_id INT NULL,
        kind ENUM('new_connection','disconnection','reconnection','meter_install','meter_replace','leak','burst','complaint','inspection','other') NOT NULL,
        status ENUM('open','assigned','done','cancelled') NOT NULL DEFAULT 'open',
        priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
        location VARCHAR(255) NULL,
        description VARCHAR(500) NULL,
        assigned_to INT NULL,
        due_date DATE NULL,
        result VARCHAR(500) NULL,
        fee DECIMAL(14,2) NOT NULL DEFAULT 0,
        invoice_id BIGINT NULL,
        materials JSON NULL,
        materials_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        done_at DATETIME NULL,
        INDEX (status), INDEX (account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS water_zone_readings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        zone_id INT NOT NULL,
        period CHAR(7) NOT NULL,
        bulk_m3 DECIMAL(14,3) NOT NULL,
        notes VARCHAR(255) NULL,
        UNIQUE KEY (zone_id, period)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE invoices ADD COLUMN water_account_id INT NULL, ADD INDEX (water_account_id)`
    ]
  },
  {
    // WASCO / LEWA-style tariffs: more customer categories, a standing charge that is free while use stays in the first band,
    // sewerage charged per m³ on a share of the water used (waterborne / non-waterborne), and VAT 15% by default.
    id: 25,
    name: 'water_tariff_lewa',
    sql: [
      `ALTER TABLE water_tariffs MODIFY category ENUM('domestic','commercial','industrial','institutional','government','school','church','standpipe','other') NOT NULL DEFAULT 'domestic'`,
      `ALTER TABLE water_tariffs ADD COLUMN service_free_upto DECIMAL(10,3) NULL AFTER service_charge,
        ADD COLUMN sewer_rate DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER sewer_pct,
        ADD COLUMN sewer_wb_pct DECIMAL(6,2) NOT NULL DEFAULT 85 AFTER sewer_rate,
        ADD COLUMN sewer_nwb_pct DECIMAL(6,2) NOT NULL DEFAULT 65 AFTER sewer_wb_pct,
        ADD COLUMN effective_from DATE NULL`,
      `ALTER TABLE water_accounts ADD COLUMN sewer_type ENUM('none','waterborne','non_waterborne') NOT NULL DEFAULT 'none' AFTER billing`,
      `ALTER TABLE water_vends ADD COLUMN sewer_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER water_amount`,
      `ALTER TABLE water_bills ADD COLUMN sewer_m3 DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER sewer_amount`
    ]
  },
  {
    // Payment partners: M-Pesa, EcoCash, banks, agents and shops collect for us on their own platforms through the
    // collections API (/api/collect/v1). Money they collect is owed to us (1180) until they settle, less their commission (6420).
    id: 26,
    name: 'payment_partners',
    sql: [
      `INSERT IGNORE INTO accounts (code, name, type) VALUES ('1180', 'Collections due from payment partners', 'asset'), ('6420', 'Payment partner commission', 'expense')`,
      `CREATE TABLE IF NOT EXISTS pay_partners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        kind ENUM('mobile_money','bank','agent','retail','other') NOT NULL DEFAULT 'mobile_money',
        method_id INT NULL,
        mode ENUM('test','live') NOT NULL DEFAULT 'test',
        status ENUM('active','suspended') NOT NULL DEFAULT 'active',
        key_prefix VARCHAR(16) NULL,
        key_hash CHAR(64) NULL UNIQUE,
        ip_allow VARCHAR(255) NULL,
        scopes VARCHAR(120) NOT NULL DEFAULT 'water_bill,water_token,invoice',
        commission_pct DECIMAL(6,3) NOT NULL DEFAULT 0,
        commission_fixed DECIMAL(10,2) NOT NULL DEFAULT 0,
        min_amount DECIMAL(12,2) NOT NULL DEFAULT 1,
        max_amount DECIMAL(12,2) NOT NULL DEFAULT 10000,
        contact_name VARCHAR(80) NULL, contact_phone VARCHAR(40) NULL, contact_email VARCHAR(120) NULL,
        notes VARCHAR(255) NULL,
        created_by INT NULL,
        last_used_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS pay_partner_settlements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        partner_id INT NOT NULL,
        settle_date DATE NOT NULL,
        upto_date DATE NOT NULL,
        txns INT NOT NULL DEFAULT 0,
        collected DECIMAL(14,2) NOT NULL DEFAULT 0,
        commission DECIMAL(14,2) NOT NULL DEFAULT 0,
        received DECIMAL(14,2) NOT NULL DEFAULT 0,
        account_code VARCHAR(20) NOT NULL,
        reference VARCHAR(80) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (partner_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS pay_partner_txns (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        partner_id INT NOT NULL,
        reference VARCHAR(80) NOT NULL,
        account_ref VARCHAR(80) NOT NULL,
        kind ENUM('water_bill','water_token','invoice') NULL,
        customer_id INT NULL,
        water_account_id INT NULL,
        invoice_id INT NULL,
        vend_id BIGINT NULL,
        amount DECIMAL(14,2) NOT NULL,
        commission DECIMAL(14,2) NOT NULL DEFAULT 0,
        status ENUM('pending','completed','failed','test') NOT NULL DEFAULT 'pending',
        result JSON NULL,
        error VARCHAR(255) NULL,
        payer_phone VARCHAR(40) NULL,
        paid_at DATETIME NULL,
        settlement_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY partner_ref (partner_id, reference),
        INDEX (created_at), INDEX (settlement_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS pay_partner_log (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        partner_id INT NULL,
        ip VARCHAR(64) NULL,
        method VARCHAR(8) NULL,
        path VARCHAR(160) NULL,
        status SMALLINT NULL,
        error VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (partner_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  },
  {
    // e-Procurement: supplier register with ownership (nationality, gender, youth, disability, SMME), procurement cases by
    // method (open tender, restricted tender, RFQ, waiver / direct), sealed online bids through a supplier portal,
    // clarifications, bid opening, committee evaluation with conflict-of-interest declarations, preference scorecards,
    // award approval, standstill and challenges, contract (purchase order) and supplier rating.
    id: 27,
    name: 'e_procurement',
    sql: [
      `CREATE TABLE IF NOT EXISTS supplier_profiles (
        partner_id INT PRIMARY KEY,
        reg_no VARCHAR(60) NULL,
        tax_clearance_no VARCHAR(60) NULL, tax_clearance_expiry DATE NULL,
        trader_licence_no VARCHAR(60) NULL, trader_licence_expiry DATE NULL,
        country VARCHAR(60) NULL DEFAULT 'Lesotho',
        citizen_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
        women_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
        youth_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
        disabled_owned TINYINT(1) NOT NULL DEFAULT 0,
        size ENUM('micro','small','medium','large') NOT NULL DEFAULT 'small',
        district VARCHAR(40) NULL,
        categories VARCHAR(255) NULL,
        contact_person VARCHAR(80) NULL,
        status ENUM('pending','approved','suspended','debarred') NOT NULL DEFAULT 'pending',
        debar_until DATE NULL, debar_reason VARCHAR(255) NULL,
        rating DECIMAL(4,2) NULL, ratings INT NOT NULL DEFAULT 0,
        verified_by INT NULL, verified_at DATETIME NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS tenders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(40) NULL UNIQUE,
        title VARCHAR(200) NOT NULL,
        description TEXT NULL,
        category ENUM('goods','works','services','consultancy') NOT NULL DEFAULT 'goods',
        method ENUM('open','restricted','rfq','waiver') NOT NULL DEFAULT 'rfq',
        waiver_reason ENUM('single_source','emergency','proprietary','continuity','below_threshold','other') NULL,
        waiver_justification TEXT NULL,
        waiver_supplier_id INT NULL,
        estimated_value DECIMAL(16,2) NOT NULL DEFAULT 0,
        budget_code VARCHAR(20) NULL,
        department VARCHAR(80) NULL,
        status ENUM('draft','submitted','approved','published','closed','opened','evaluated','recommended','awarded','challenged','contracted','cancelled') NOT NULL DEFAULT 'draft',
        closing_at DATETIME NULL,
        bid_validity_days INT NOT NULL DEFAULT 90,
        bid_security DECIMAL(14,2) NOT NULL DEFAULT 0,
        tech_weight DECIMAL(5,2) NOT NULL DEFAULT 0,
        price_weight DECIMAL(5,2) NOT NULL DEFAULT 80,
        pref_weight DECIMAL(5,2) NOT NULL DEFAULT 20,
        min_tech_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
        slug CHAR(16) NULL UNIQUE,
        created_by INT NULL,
        approved_by INT NULL, approved_at DATETIME NULL,
        published_at DATETIME NULL, opened_at DATETIME NULL,
        recommended_bid_id INT NULL, recommended_by INT NULL, recommendation TEXT NULL,
        awarded_to INT NULL, award_value DECIMAL(16,2) NULL, award_approved_by INT NULL, awarded_at DATETIME NULL,
        standstill_until DATE NULL,
        po_id BIGINT NULL, contract_start DATE NULL, contract_end DATE NULL,
        supplier_rating TINYINT NULL, rating_note VARCHAR(255) NULL,
        cancel_reason VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (status), INDEX (method)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS tender_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tender_id INT NOT NULL,
        product_id INT NULL,
        description VARCHAR(200) NOT NULL,
        qty DECIMAL(14,3) NOT NULL DEFAULT 1,
        uom VARCHAR(20) NULL,
        est_unit DECIMAL(14,2) NOT NULL DEFAULT 0,
        FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS tender_criteria (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tender_id INT NOT NULL,
        kind ENUM('mandatory','technical') NOT NULL,
        name VARCHAR(160) NOT NULL,
        max_points DECIMAL(6,2) NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0,
        FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS tender_committee (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tender_id INT NOT NULL,
        user_id INT NOT NULL,
        role ENUM('chair','member','secretary') NOT NULL DEFAULT 'member',
        coi_declared_at DATETIME NULL,
        coi_conflict TINYINT(1) NULL,
        coi_note VARCHAR(255) NULL,
        UNIQUE KEY tu (tender_id, user_id),
        FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS tender_bidders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tender_id INT NOT NULL,
        partner_id INT NOT NULL,
        token CHAR(32) NOT NULL UNIQUE,
        status ENUM('invited','registered','submitted','withdrawn','declined') NOT NULL DEFAULT 'invited',
        invited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        viewed_at DATETIME NULL,
        UNIQUE KEY tp (tender_id, partner_id),
        FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS tender_bids (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tender_id INT NOT NULL,
        partner_id INT NOT NULL,
        subtotal DECIMAL(16,2) NOT NULL DEFAULT 0,
        vat DECIMAL(16,2) NOT NULL DEFAULT 0,
        total DECIMAL(16,2) NOT NULL DEFAULT 0,
        delivery_days INT NULL,
        validity_days INT NULL,
        notes TEXT NULL,
        declaration TINYINT(1) NOT NULL DEFAULT 0,
        submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        entered_by INT NULL,
        compliant TINYINT(1) NULL,
        tech_pct DECIMAL(6,2) NULL, price_score DECIMAL(6,2) NULL, pref_score DECIMAL(6,2) NULL, total_score DECIMAL(6,2) NULL,
        rank_no INT NULL,
        status ENUM('valid','withdrawn','disqualified') NOT NULL DEFAULT 'valid',
        disqualified_reason VARCHAR(255) NULL,
        seal CHAR(64) NULL,
        UNIQUE KEY tp (tender_id, partner_id),
        FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS tender_bid_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bid_id INT NOT NULL,
        line_id INT NOT NULL,
        unit_price DECIMAL(14,2) NOT NULL,
        UNIQUE KEY bl (bid_id, line_id),
        FOREIGN KEY (bid_id) REFERENCES tender_bids(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS tender_scores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bid_id INT NOT NULL,
        criterion_id INT NOT NULL,
        user_id INT NOT NULL,
        score DECIMAL(6,2) NOT NULL,
        comment VARCHAR(255) NULL,
        UNIQUE KEY bcu (bid_id, criterion_id, user_id),
        FOREIGN KEY (bid_id) REFERENCES tender_bids(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS tender_clarifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tender_id INT NOT NULL,
        partner_id INT NULL,
        kind ENUM('question','addendum','challenge') NOT NULL DEFAULT 'question',
        question TEXT NOT NULL,
        answer TEXT NULL,
        answered_by INT NULL, answered_at DATETIME NULL,
        status ENUM('open','answered','upheld','dismissed') NOT NULL DEFAULT 'open',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS tender_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tender_id INT NOT NULL,
        user_id INT NULL,
        partner_id INT NULL,
        action VARCHAR(60) NOT NULL,
        details VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (tender_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  },
  {
    // Fixed asset register: categories with accounts and depreciation rules, assets, monthly depreciation runs,
    // transfers, physical verification and disposal. Fleet upgrade: service schedules and records, driver licences,
    // pool-vehicle requests, fines and accidents.
    id: 28,
    name: 'assets_fleet',
    sql: [
      `INSERT IGNORE INTO accounts (code, name, type) VALUES
        ('1600', 'Land & buildings', 'asset'), ('1605', 'Accumulated depreciation – buildings', 'asset'),
        ('1610', 'Motor vehicles', 'asset'), ('1615', 'Accumulated depreciation – vehicles', 'asset'),
        ('1620', 'Plant & machinery', 'asset'), ('1625', 'Accumulated depreciation – plant', 'asset'),
        ('1630', 'Furniture & office equipment', 'asset'), ('1635', 'Accumulated depreciation – furniture', 'asset'),
        ('1640', 'Computer equipment', 'asset'), ('1645', 'Accumulated depreciation – computers', 'asset'),
        ('1650', 'Network & infrastructure', 'asset'), ('1655', 'Accumulated depreciation – infrastructure', 'asset'),
        ('4250', 'Gain on disposal of assets', 'income'), ('6950', 'Depreciation', 'expense'), ('6960', 'Loss on disposal of assets', 'expense'),
        ('6490', 'Traffic fines & penalties', 'expense'), ('6610', 'Vehicle servicing & repairs', 'expense')`,
      `CREATE TABLE IF NOT EXISTS asset_categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL UNIQUE,
        asset_code VARCHAR(20) NOT NULL, accum_code VARCHAR(20) NOT NULL, expense_code VARCHAR(20) NOT NULL DEFAULT '6950',
        method ENUM('straight_line','reducing_balance','none') NOT NULL DEFAULT 'straight_line',
        life_months INT NOT NULL DEFAULT 60,
        rate_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
        residual_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `INSERT IGNORE INTO asset_categories (name, asset_code, accum_code, method, life_months, rate_pct, residual_pct) VALUES
        ('Land', '1600', '1605', 'none', 0, 0, 0), ('Buildings', '1600', '1605', 'straight_line', 600, 0, 0),
        ('Motor vehicles', '1610', '1615', 'straight_line', 60, 0, 10), ('Plant & machinery', '1620', '1625', 'straight_line', 120, 0, 5),
        ('Furniture & office equipment', '1630', '1635', 'straight_line', 120, 0, 0), ('Computer equipment', '1640', '1645', 'straight_line', 36, 0, 0),
        ('Network & infrastructure (pipes, reservoirs)', '1650', '1655', 'straight_line', 480, 0, 0)`,
      `CREATE TABLE IF NOT EXISTS fixed_assets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        asset_no VARCHAR(30) NULL UNIQUE,
        name VARCHAR(160) NOT NULL,
        category_id INT NOT NULL,
        description VARCHAR(255) NULL,
        serial_no VARCHAR(80) NULL, make_model VARCHAR(80) NULL, barcode VARCHAR(80) NULL,
        location_id INT NULL, location VARCHAR(120) NULL, department VARCHAR(80) NULL,
        custodian VARCHAR(120) NULL, custodian_employee_id INT NULL,
        supplier_id INT NULL, invoice_ref VARCHAR(80) NULL, funding VARCHAR(80) NULL,
        purchase_date DATE NULL, in_service_date DATE NOT NULL,
        cost DECIMAL(16,2) NOT NULL, residual_value DECIMAL(16,2) NOT NULL DEFAULT 0,
        method ENUM('straight_line','reducing_balance','none') NOT NULL DEFAULT 'straight_line',
        life_months INT NOT NULL DEFAULT 60, rate_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
        accum_dep DECIMAL(16,2) NOT NULL DEFAULT 0,
        last_dep_period CHAR(7) NULL,
        status ENUM('active','disposed','written_off') NOT NULL DEFAULT 'active',
        disposal_date DATE NULL, disposal_proceeds DECIMAL(16,2) NULL, disposal_gain DECIMAL(16,2) NULL, disposal_note VARCHAR(255) NULL,
        condition_now ENUM('new','good','fair','poor','broken') NOT NULL DEFAULT 'good',
        warranty_until DATE NULL, insured_value DECIMAL(16,2) NULL, insurer VARCHAR(80) NULL, insurance_expiry DATE NULL,
        vehicle_id INT NULL, equipment_id INT NULL, tender_id INT NULL,
        last_verified DATE NULL,
        notes VARCHAR(255) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (category_id), INDEX (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS asset_dep_runs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        upto_period CHAR(7) NOT NULL,
        assets INT NOT NULL DEFAULT 0,
        total DECIMAL(16,2) NOT NULL DEFAULT 0,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS asset_depreciation (
        id INT AUTO_INCREMENT PRIMARY KEY,
        asset_id INT NOT NULL,
        period CHAR(7) NOT NULL,
        amount DECIMAL(16,2) NOT NULL,
        accum_after DECIMAL(16,2) NOT NULL,
        run_id INT NULL,
        UNIQUE KEY ap (asset_id, period)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS asset_moves (
        id INT AUTO_INCREMENT PRIMARY KEY,
        asset_id INT NOT NULL,
        move_date DATE NOT NULL,
        kind VARCHAR(30) NOT NULL DEFAULT 'transfer',
        from_location VARCHAR(120) NULL, to_location VARCHAR(120) NULL,
        from_custodian VARCHAR(120) NULL, to_custodian VARCHAR(120) NULL,
        note VARCHAR(255) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (asset_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS asset_counts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        location VARCHAR(120) NULL,
        status ENUM('open','closed') NOT NULL DEFAULT 'open',
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS asset_count_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        count_id INT NOT NULL,
        asset_id INT NOT NULL,
        found TINYINT(1) NOT NULL DEFAULT 1,
        condition_now ENUM('new','good','fair','poor','broken') NULL,
        location_seen VARCHAR(120) NULL,
        note VARCHAR(255) NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY ca (count_id, asset_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE vehicles ADD COLUMN service_interval_km INT NULL, ADD COLUMN service_interval_months INT NULL,
        ADD COLUMN last_service_km INT NULL, ADD COLUMN last_service_date DATE NULL, ADD COLUMN asset_id INT NULL,
        ADD COLUMN vin VARCHAR(40) NULL, ADD COLUMN fuel_card VARCHAR(40) NULL, ADD COLUMN pool TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN department VARCHAR(80) NULL,
        ADD COLUMN expected_km_per_litre DECIMAL(6,2) NULL`,
      `CREATE TABLE IF NOT EXISTS vehicle_services (
        id INT AUTO_INCREMENT PRIMARY KEY,
        vehicle_id INT NOT NULL,
        service_date DATE NOT NULL,
        odometer INT NULL,
        kind ENUM('service','repair','tyres','battery','inspection','accident_repair','other') NOT NULL DEFAULT 'service',
        description VARCHAR(255) NULL,
        workshop VARCHAR(120) NULL, supplier_id INT NULL,
        cost DECIMAL(14,2) NOT NULL DEFAULT 0,
        method_id INT NULL,
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (vehicle_id, service_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS fleet_drivers (
        employee_id INT PRIMARY KEY,
        licence_no VARCHAR(40) NULL,
        licence_codes VARCHAR(40) NULL,
        licence_expiry DATE NULL,
        prdp_expiry DATE NULL,
        notes VARCHAR(255) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS vehicle_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(30) NULL UNIQUE,
        user_id INT NOT NULL,
        department VARCHAR(80) NULL,
        purpose VARCHAR(255) NOT NULL,
        destination VARCHAR(160) NULL,
        depart_at DATETIME NOT NULL, return_at DATETIME NOT NULL,
        passengers INT NOT NULL DEFAULT 1,
        vehicle_id INT NULL, driver_id INT NULL,
        status ENUM('requested','approved','rejected','out','returned','cancelled') NOT NULL DEFAULT 'requested',
        decided_by INT NULL, decision_note VARCHAR(255) NULL,
        odo_out INT NULL, odo_in INT NULL, out_at DATETIME NULL, in_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (vehicle_id, depart_at), INDEX (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS vehicle_incidents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        vehicle_id INT NOT NULL,
        driver_id INT NULL,
        incident_date DATE NOT NULL,
        kind ENUM('fine','accident','theft','damage','breakdown') NOT NULL,
        description VARCHAR(255) NOT NULL,
        place VARCHAR(120) NULL,
        reference VARCHAR(60) NULL,
        amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        paid TINYINT(1) NOT NULL DEFAULT 0, method_id INT NULL,
        recover_from_driver TINYINT(1) NOT NULL DEFAULT 0,
        claim_no VARCHAR(60) NULL, claim_status ENUM('none','lodged','paid','rejected') NOT NULL DEFAULT 'none', claim_amount DECIMAL(14,2) NULL,
        status ENUM('open','closed') NOT NULL DEFAULT 'open',
        user_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (vehicle_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  },
  {
    // Finance & audit (Sage-level): classified chart of accounts with control accounts and cash-flow mapping, cost centres,
    // financial years with period lock and year-end close, journal batches (approval, reversing, recurring), budgets,
    // a tamper-evident hash chain over the ledger, auditor role, audit queries.
    id: 29,
    name: 'finance_audit',
    sql: [
      `ALTER TABLE accounts ADD COLUMN category ENUM('current_asset','non_current_asset','current_liability','non_current_liability','equity','revenue','cost_of_sales','other_income','operating_expense','finance_cost','tax_expense') NULL,
        ADD COLUMN is_control TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN cash_flow ENUM('cash','operating','investing','financing','none') NULL,
        ADD COLUMN description VARCHAR(255) NULL, ADD COLUMN report_group VARCHAR(80) NULL`,
      // classify what is already there by code range (each can be changed later)
      `UPDATE accounts SET category = CASE
          WHEN type = 'asset' AND (code < '1500' OR code BETWEEN '1150' AND '1499') THEN 'current_asset'
          WHEN type = 'asset' THEN 'non_current_asset'
          WHEN type = 'liability' AND code < '2500' THEN 'current_liability'
          WHEN type = 'liability' THEN 'non_current_liability'
          WHEN type = 'equity' THEN 'equity'
          WHEN type = 'income' AND code IN ('4200','4250','4300') THEN 'other_income'
          WHEN type = 'income' THEN 'revenue'
          WHEN type = 'expense' AND code < '6000' THEN 'cost_of_sales'
          WHEN type = 'expense' AND code = '7100' THEN 'tax_expense'
          WHEN type = 'expense' AND code IN ('6400','6460') THEN 'finance_cost'
          ELSE 'operating_expense' END WHERE category IS NULL`,
      `UPDATE accounts SET cash_flow = CASE
          WHEN code IN ('1000','1010','1020','1050','1170') THEN 'cash'
          WHEN type = 'asset' AND code >= '1500' THEN 'investing'
          WHEN type = 'liability' AND code >= '2500' THEN 'financing'
          WHEN type = 'equity' AND code <> '3100' THEN 'financing'
          WHEN type IN ('income','expense') THEN 'none'
          ELSE 'operating' END WHERE cash_flow IS NULL`,
      `UPDATE accounts SET is_control = 1 WHERE code IN ('1100','1200','1400','2000','2050','2100','2200','2300')`,
      `CREATE TABLE IF NOT EXISTS cost_centres (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        kind ENUM('department','project','branch','fund','other') NOT NULL DEFAULT 'department',
        manager VARCHAR(80) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE journal_lines ADD COLUMN cost_centre_id INT NULL, ADD INDEX (cost_centre_id)`,
      `ALTER TABLE journal_entries ADD COLUMN number VARCHAR(30) NULL, ADD COLUMN reverses_id BIGINT NULL, ADD COLUMN reversed_by_id BIGINT NULL,
        ADD COLUMN batch_id INT NULL, ADD COLUMN hash CHAR(64) NULL, ADD COLUMN seal_seq BIGINT NULL, ADD INDEX (entry_date), ADD INDEX (source_type), ADD INDEX (seal_seq)`,
      `CREATE TABLE IF NOT EXISTS fin_years (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(40) NOT NULL,
        start_date DATE NOT NULL, end_date DATE NOT NULL,
        status ENUM('open','closed') NOT NULL DEFAULT 'open',
        closing_entry_id BIGINT NULL,
        closed_by INT NULL, closed_at DATETIME NULL,
        UNIQUE KEY (start_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS journal_batches (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(30) NULL UNIQUE,
        entry_date DATE NOT NULL,
        reference VARCHAR(80) NULL,
        memo VARCHAR(255) NULL,
        \`lines\` JSON NOT NULL,
        total DECIMAL(16,2) NOT NULL DEFAULT 0,
        status ENUM('draft','submitted','posted','rejected','cancelled') NOT NULL DEFAULT 'draft',
        reverse_on DATE NULL,
        recurring_id INT NULL,
        created_by INT NULL, approved_by INT NULL, approved_at DATETIME NULL, note VARCHAR(255) NULL,
        entry_id BIGINT NULL, reversal_entry_id BIGINT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS recurring_journals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        reference VARCHAR(80) NULL, memo VARCHAR(255) NULL,
        \`lines\` JSON NOT NULL,
        frequency ENUM('monthly','quarterly','yearly') NOT NULL DEFAULT 'monthly',
        next_date DATE NOT NULL, end_date DATE NULL,
        auto_post TINYINT(1) NOT NULL DEFAULT 0,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_by INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS budgets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        fin_year_id INT NOT NULL,
        status ENUM('draft','approved') NOT NULL DEFAULT 'draft',
        created_by INT NULL, approved_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS budget_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        budget_id INT NOT NULL,
        account_id INT NOT NULL,
        cost_centre_id INT NULL,
        period TINYINT NOT NULL,
        amount DECIMAL(16,2) NOT NULL DEFAULT 0,
        UNIQUE KEY bacp (budget_id, account_id, cost_centre_id, period),
        FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS audit_queries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        entity VARCHAR(40) NOT NULL,
        entity_id BIGINT NULL,
        subject VARCHAR(200) NOT NULL,
        question TEXT NOT NULL,
        raised_by INT NULL,
        assigned_to INT NULL,
        answer TEXT NULL, answered_by INT NULL, answered_at DATETIME NULL,
        status ENUM('open','answered','closed') NOT NULL DEFAULT 'open',
        risk ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME NULL,
        INDEX (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE audit_log ADD COLUMN ip VARCHAR(64) NULL, ADD INDEX (user_id, created_at), ADD INDEX (action)`,
      `ALTER TABLE users MODIFY role ENUM('admin','manager','accountant','cashier','waiter','bartender','kitchen','technician','staff','supervisor','receptionist','clinician','farmworker','meterreader','auditor','internal_auditor') NOT NULL DEFAULT 'cashier'`,
      // internal audit: audit universe (what can be audited, with risk), annual plans, engagements with a work programme,
      // findings (condition / criteria / cause / effect / recommendation), management action plans and follow-up
      `CREATE TABLE IF NOT EXISTS ia_universe (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        area VARCHAR(60) NULL,
        owner VARCHAR(80) NULL,
        description VARCHAR(255) NULL,
        impact TINYINT NOT NULL DEFAULT 3, likelihood TINYINT NOT NULL DEFAULT 3,
        control_rating ENUM('strong','adequate','weak','unknown') NOT NULL DEFAULT 'unknown',
        last_audited DATE NULL,
        frequency_months INT NOT NULL DEFAULT 12,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS ia_engagements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(30) NULL UNIQUE,
        title VARCHAR(200) NOT NULL,
        universe_id INT NULL,
        plan_year INT NOT NULL,
        kind ENUM('assurance','compliance','financial','it','investigation','follow_up','consulting') NOT NULL DEFAULT 'assurance',
        objectives TEXT NULL, scope TEXT NULL, methodology TEXT NULL,
        lead_id INT NULL, team VARCHAR(255) NULL, auditee VARCHAR(120) NULL,
        planned_start DATE NULL, planned_end DATE NULL, actual_start DATE NULL, actual_end DATE NULL, budget_days DECIMAL(6,1) NULL,
        status ENUM('planned','fieldwork','review','draft_report','final','closed','cancelled') NOT NULL DEFAULT 'planned',
        overall_rating ENUM('satisfactory','needs_improvement','unsatisfactory') NULL,
        executive_summary TEXT NULL, conclusion TEXT NULL,
        reviewed_by INT NULL, reviewed_at DATETIME NULL, issued_at DATETIME NULL,
        created_by INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS ia_steps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        engagement_id INT NOT NULL,
        ref VARCHAR(20) NULL,
        objective VARCHAR(255) NULL,
        procedure_text TEXT NOT NULL,
        sample_size INT NULL, exceptions INT NULL,
        result ENUM('not_started','satisfactory','exceptions','not_applicable') NOT NULL DEFAULT 'not_started',
        notes TEXT NULL,
        done_by INT NULL, done_at DATETIME NULL, reviewed_by INT NULL, reviewed_at DATETIME NULL,
        sort_order INT NOT NULL DEFAULT 0,
        FOREIGN KEY (engagement_id) REFERENCES ia_engagements(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS ia_findings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        engagement_id INT NOT NULL,
        ref VARCHAR(20) NULL,
        title VARCHAR(200) NOT NULL,
        rating ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
        condition_text TEXT NOT NULL, criteria TEXT NULL, cause TEXT NULL, effect TEXT NULL, recommendation TEXT NOT NULL,
        management_response TEXT NULL, response_by VARCHAR(80) NULL, agreed TINYINT(1) NULL,
        source_entity VARCHAR(40) NULL, source_id BIGINT NULL, amount DECIMAL(16,2) NULL,
        status ENUM('draft','agreed','open','resolved','risk_accepted') NOT NULL DEFAULT 'draft',
        created_by INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (engagement_id) REFERENCES ia_engagements(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS ia_actions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        finding_id INT NOT NULL,
        action_text TEXT NOT NULL,
        owner VARCHAR(80) NOT NULL, owner_user_id INT NULL,
        due_date DATE NOT NULL,
        status ENUM('open','in_progress','implemented','verified','overdue_extended','not_implemented') NOT NULL DEFAULT 'open',
        progress_note TEXT NULL, revised_due DATE NULL,
        verified_by INT NULL, verified_at DATETIME NULL, verification_note TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (finding_id) REFERENCES ia_findings(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  },
  {
    // Governance: organogram (units, positions, reporting lines, acting appointments), delegation of authority that
    // decides who approves what in every module, decision rights (RACI), communication protocols, policies with versions
    // and staff acknowledgements, and the legal module (documents from Lesotho-based templates, contract register,
    // compliance obligations).
    id: 30,
    name: 'governance',
    sql: [
      `CREATE TABLE IF NOT EXISTS org_units (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(20) NULL,
        name VARCHAR(120) NOT NULL,
        kind ENUM('board','executive','division','department','section','unit','committee') NOT NULL DEFAULT 'department',
        parent_id INT NULL,
        cost_centre_id INT NULL,
        mandate TEXT NULL,
        communication_style ENUM('formal','consultative','collaborative','directive') NOT NULL DEFAULT 'consultative',
        channels VARCHAR(255) NULL,
        meeting_cadence VARCHAR(120) NULL,
        escalation_days INT NOT NULL DEFAULT 3,
        active TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS positions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(120) NOT NULL,
        code VARCHAR(30) NULL,
        unit_id INT NULL,
        reports_to_id INT NULL,
        user_id INT NULL,
        employee_id INT NULL,
        acting_user_id INT NULL, acting_until DATE NULL,
        grade VARCHAR(20) NULL,
        is_head TINYINT(1) NOT NULL DEFAULT 0,
        purpose TEXT NULL,
        responsibilities TEXT NULL,
        communication_style ENUM('formal','consultative','collaborative','directive') NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        INDEX (reports_to_id), INDEX (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS authority_grants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        position_id INT NOT NULL,
        doc_type VARCHAR(40) NOT NULL,
        kind ENUM('approve','concur') NOT NULL DEFAULT 'approve',
        max_amount DECIMAL(16,2) NULL,
        min_amount DECIMAL(16,2) NOT NULL DEFAULT 0,
        UNIQUE KEY pdk (position_id, doc_type, kind),
        INDEX (doc_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS decision_rights (
        id INT AUTO_INCREMENT PRIMARY KEY,
        decision VARCHAR(200) NOT NULL,
        category VARCHAR(60) NULL,
        decides_position_id INT NULL,
        recommends_position_id INT NULL,
        consulted VARCHAR(255) NULL,
        informed VARCHAR(255) NULL,
        notes VARCHAR(255) NULL,
        sort_order INT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS approval_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        doc_type VARCHAR(40) NOT NULL,
        doc_id BIGINT NOT NULL,
        amount DECIMAL(16,2) NOT NULL DEFAULT 0,
        requester_id INT NULL,
        requester_position_id INT NULL,
        summary VARCHAR(255) NULL,
        link VARCHAR(160) NULL,
        payload JSON NULL,
        status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        decided_at DATETIME NULL,
        INDEX (doc_type, doc_id), INDEX (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS approval_steps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT NOT NULL,
        step_no INT NOT NULL,
        kind ENUM('approve','concur') NOT NULL DEFAULT 'approve',
        position_id INT NOT NULL,
        status ENUM('pending','approved','rejected','skipped') NOT NULL DEFAULT 'pending',
        decided_by INT NULL, decided_at DATETIME NULL, via VARCHAR(20) NULL, note VARCHAR(255) NULL,
        FOREIGN KEY (request_id) REFERENCES approval_requests(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS policies (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(30) NULL UNIQUE,
        title VARCHAR(200) NOT NULL,
        unit_id INT NULL,
        department VARCHAR(60) NULL,
        template_key VARCHAR(60) NULL,
        owner_position_id INT NULL,
        status ENUM('draft','in_review','approved','retired') NOT NULL DEFAULT 'draft',
        current_version_id INT NULL,
        draft_version_id INT NULL,
        review_months INT NOT NULL DEFAULT 12,
        next_review DATE NULL,
        requires_ack ENUM('none','unit','all') NOT NULL DEFAULT 'all',
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS policy_versions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        policy_id INT NOT NULL,
        version INT NOT NULL,
        content MEDIUMTEXT NOT NULL,
        change_note VARCHAR(255) NULL,
        created_by INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        approved_by INT NULL, approved_at DATETIME NULL, effective_date DATE NULL,
        UNIQUE KEY pv (policy_id, version),
        FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS policy_acks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        version_id INT NOT NULL,
        user_id INT NOT NULL,
        acked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY vu (version_id, user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS legal_documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        number VARCHAR(30) NULL UNIQUE,
        template_key VARCHAR(60) NULL,
        title VARCHAR(200) NOT NULL,
        category VARCHAR(40) NULL,
        entity VARCHAR(30) NULL, entity_id BIGINT NULL,
        partner_id INT NULL, employee_id INT NULL,
        content MEDIUMTEXT NOT NULL,
        status ENUM('draft','in_review','approved','signed','expired','terminated') NOT NULL DEFAULT 'draft',
        value DECIMAL(16,2) NULL,
        start_date DATE NULL, end_date DATE NULL,
        renewal_notice_days INT NULL, auto_renew TINYINT(1) NOT NULL DEFAULT 0,
        owner_position_id INT NULL,
        signed_date DATE NULL,
        notes VARCHAR(255) NULL,
        created_by INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (entity, entity_id), INDEX (end_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS legal_obligations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        law VARCHAR(160) NULL,
        authority VARCHAR(120) NULL,
        frequency ENUM('once','monthly','quarterly','yearly') NOT NULL DEFAULT 'yearly',
        next_due DATE NULL,
        owner_position_id INT NULL,
        last_done DATE NULL,
        notes VARCHAR(255) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ]
  }
];
