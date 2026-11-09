-- ==============================================================================
-- DỰ ÁN: HỆ THỐNG QUẢN LÝ THUÊ PHÒNG TRỌ NÂNG CAO (QuanLyNhaTro)
-- AGENT 1: DATABASE ARCHITECT (LƯỢC ĐỒ CƠ SỞ DỮ LIỆU MICROSOFT SQL SERVER / T-SQL)
-- TỆP TIN: schema.sql
-- ==============================================================================

-- 1. BẢNG USERS: Quản lý tài khoản, hỗ trợ phân quyền ('landlord', 'tenant')
IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        username NVARCHAR(50) NOT NULL UNIQUE,
        password_hash NVARCHAR(255) NOT NULL,
        full_name NVARCHAR(100) NOT NULL,
        phone NVARCHAR(20),
        email NVARCHAR(100),
        role NVARCHAR(20) NOT NULL CHECK (role IN ('landlord', 'tenant')),
        created_at DATETIME DEFAULT GETDATE()
    );
END;

-- 2. BẢNG PROPERTIES: Hỗ trợ quản lý đa cơ sở (Multi-property Scaling)
IF OBJECT_ID('dbo.Properties', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Properties (
        id INT IDENTITY(1,1) PRIMARY KEY,
        landlord_id INT NOT NULL,
        name NVARCHAR(150) NOT NULL,
        address NVARCHAR(255) NOT NULL,
        description NVARCHAR(MAX),
        bank_name NVARCHAR(50) DEFAULT 'MBBank',             -- Dùng cho tạo mã VietQR
        bank_account_no NVARCHAR(50) DEFAULT '0987654321',   -- Số tài khoản nhận tiền
        bank_account_name NVARCHAR(100) DEFAULT 'CHU PHONG TRO',
        created_at DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_Properties_Landlord FOREIGN KEY (landlord_id) REFERENCES dbo.Users(id) ON DELETE CASCADE
    );
END;

-- 3. BẢNG ROOMS: Quản lý thông tin phòng trọ thuộc cơ sở
IF OBJECT_ID('dbo.Rooms', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Rooms (
        id INT IDENTITY(1,1) PRIMARY KEY,
        property_id INT NOT NULL,
        room_number NVARCHAR(20) NOT NULL,
        room_type NVARCHAR(50) DEFAULT N'Phòng đơn',         -- Phòng đơn, Studio, Gác lửng...
        base_price DECIMAL(18,2) NOT NULL,                   -- Giá thuê cơ bản (VNĐ/tháng)
        area_sqm DECIMAL(10,2) DEFAULT 20.0,                 -- Diện tích (m2)
        status NVARCHAR(20) NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Occupied', 'Maintenance')),
        created_at DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_Rooms_Property FOREIGN KEY (property_id) REFERENCES dbo.Properties(id) ON DELETE CASCADE
    );
END;

-- 4. BẢNG INVENTORY: Quản lý nội thất, tài sản bàn giao lúc check-in / check-out
IF OBJECT_ID('dbo.Inventory', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Inventory (
        id INT IDENTITY(1,1) PRIMARY KEY,
        room_id INT NOT NULL,
        item_name NVARCHAR(150) NOT NULL,                    -- Tên đồ dùng: Điều hòa, Tủ lạnh, Giường nệm...
        quantity INT NOT NULL DEFAULT 1,
        condition_checkin NVARCHAR(255) NOT NULL DEFAULT N'Mới 100% / Hoạt động tốt',
        condition_checkout NVARCHAR(255) DEFAULT N'Chưa bàn giao trả',
        status NVARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Damaged', 'Replaced')),
        notes NVARCHAR(MAX),
        created_at DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_Inventory_Room FOREIGN KEY (room_id) REFERENCES dbo.Rooms(id) ON DELETE CASCADE
    );
END;

-- 5. BẢNG CONTRACTS: Hợp đồng thuê phòng, thời hạn để tính cảnh báo hết hạn (15-30 ngày)
-- Chú ý: tenant_id dùng ON DELETE NO ACTION để tránh lỗi cycles / multiple cascade paths trong SQL Server (Error 1785)
IF OBJECT_ID('dbo.Contracts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Contracts (
        id INT IDENTITY(1,1) PRIMARY KEY,
        room_id INT NOT NULL,
        tenant_id INT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,                              -- Dùng cho hệ thống cảnh báo (15-30 ngày)
        monthly_rent DECIMAL(18,2) NOT NULL,
        deposit_amount DECIMAL(18,2) NOT NULL,               -- Tiền cọc giữ phòng
        electricity_rate DECIMAL(18,2) DEFAULT 3500,         -- Đơn giá điện (VNĐ/kWh)
        water_rate DECIMAL(18,2) DEFAULT 25000,              -- Đơn giá nước (VNĐ/khối hoặc người)
        status NVARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Expired', 'Terminated')),
        created_at DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_Contracts_Room FOREIGN KEY (room_id) REFERENCES dbo.Rooms(id) ON DELETE CASCADE,
        CONSTRAINT FK_Contracts_Tenant FOREIGN KEY (tenant_id) REFERENCES dbo.Users(id) ON DELETE NO ACTION
    );
END;

-- 6. BẢNG INVOICES: Quản lý hóa đơn định kỳ, tiền điện nước, dịch vụ và trạng thái
IF OBJECT_ID('dbo.Invoices', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Invoices (
        id INT IDENTITY(1,1) PRIMARY KEY,
        contract_id INT NOT NULL,
        tenant_id INT NULL,
        room_id INT NULL,
        invoice_month NVARCHAR(20) NOT NULL,                 -- Định dạng: YYYY-MM (VD: 2026-11)
        billing_month NVARCHAR(50) NULL,                     -- Ví dụ: Tháng 11/2026
        room_rent DECIMAL(18,2) NOT NULL,
        electricity_start DECIMAL(10,2) DEFAULT 0,           -- Chỉ số điện đầu
        electricity_end DECIMAL(10,2) DEFAULT 0,             -- Chỉ số điện cuối
        electricity_cost DECIMAL(18,2) DEFAULT 0,
        water_cost DECIMAL(18,2) DEFAULT 0,
        trash_cost DECIMAL(18,2) DEFAULT 50000,
        wifi_cost DECIMAL(18,2) DEFAULT 100000,
        service_cost DECIMAL(18,2) DEFAULT 0,                -- Tiền mạng, vệ sinh, rác
        total_amount DECIMAL(18,2) NOT NULL,                 -- Tổng tiền cần thanh toán
        due_date DATE NOT NULL,                              -- Hạn thanh toán (cảnh báo quá hạn)
        status NVARCHAR(50) NOT NULL DEFAULT N'chưa thanh toán',
        paid_at DATETIME NULL,
        created_at DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_Invoices_Contract FOREIGN KEY (contract_id) REFERENCES dbo.Contracts(id) ON DELETE CASCADE
    );
END;

-- 7. BẢNG MAINTENANCE: Quản lý yêu cầu bảo trì, báo cáo sự cố từ người thuê
-- Chú ý: tenant_id dùng ON DELETE NO ACTION để tránh multiple cascade paths
IF OBJECT_ID('dbo.Maintenance', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Maintenance (
        id INT IDENTITY(1,1) PRIMARY KEY,
        room_id INT NOT NULL,
        tenant_id INT NOT NULL,
        title NVARCHAR(200) NOT NULL,                        -- Tiêu đề sự cố
        description NVARCHAR(MAX) NOT NULL,                  -- Chi tiết sự cố
        priority NVARCHAR(20) NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent')),
        status NVARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Completed')),
        reported_at DATETIME DEFAULT GETDATE(),
        resolved_at DATETIME NULL,
        admin_notes NVARCHAR(MAX),
        CONSTRAINT FK_Maintenance_Room FOREIGN KEY (room_id) REFERENCES dbo.Rooms(id) ON DELETE CASCADE,
        CONSTRAINT FK_Maintenance_Tenant FOREIGN KEY (tenant_id) REFERENCES dbo.Users(id) ON DELETE NO ACTION
    );
END;

-- 8. BẢNG FEEDBACKS: Hệ thống tiếp nhận phản ánh & sự cố kỹ thuật từ khách thuê
IF OBJECT_ID('dbo.feedbacks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.feedbacks (
        id INT IDENTITY(1,1) PRIMARY KEY,
        tenant_id INT NOT NULL,
        room_id INT NULL,
        issue_content NVARCHAR(MAX) NOT NULL,
        status NVARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_Feedbacks_Tenant FOREIGN KEY (tenant_id) REFERENCES dbo.Users(id) ON DELETE CASCADE,
        CONSTRAINT FK_Feedbacks_Room FOREIGN KEY (room_id) REFERENCES dbo.Rooms(id) ON DELETE NO ACTION
    );
END;

-- 9. BẢNG NOTIFICATIONS: Bảng tin thông báo từ Chủ trọ gửi toàn bộ cư dân
IF OBJECT_ID('dbo.notifications', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.notifications (
        id INT IDENTITY(1,1) PRIMARY KEY,
        message NVARCHAR(MAX) NOT NULL,
        created_at DATETIME DEFAULT GETDATE()
    );
END;

-- TẠO CÁC CHỈ MỤC (INDEXES) ĐỂ TỐI ƯU HÓA HIỆU NĂNG TRUY VẤN
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_rooms_property' AND object_id = OBJECT_ID('dbo.Rooms'))
    CREATE INDEX idx_rooms_property ON dbo.Rooms(property_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_contracts_tenant' AND object_id = OBJECT_ID('dbo.Contracts'))
    CREATE INDEX idx_contracts_tenant ON dbo.Contracts(tenant_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_contracts_room' AND object_id = OBJECT_ID('dbo.Contracts'))
    CREATE INDEX idx_contracts_room ON dbo.Contracts(room_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_invoices_contract' AND object_id = OBJECT_ID('dbo.Invoices'))
    CREATE INDEX idx_invoices_contract ON dbo.Invoices(contract_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_maintenance_room' AND object_id = OBJECT_ID('dbo.Maintenance'))
    CREATE INDEX idx_maintenance_room ON dbo.Maintenance(room_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_maintenance_tenant' AND object_id = OBJECT_ID('dbo.Maintenance'))
    CREATE INDEX idx_maintenance_tenant ON dbo.Maintenance(tenant_id);
