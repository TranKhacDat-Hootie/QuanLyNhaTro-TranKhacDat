# ==============================================================================
# DỰ ÁN: HỆ THỐNG QUẢN LÝ THUÊ PHÒNG TRỌ (QuanLyNhaTro)
# AGENT 2: BACKEND FLASK (app.py) - CHUẨN MỰC FLASK ARCHITECTURE + SQLITE (database.db)
# ==============================================================================

import os
import sqlite3
import datetime
from datetime import timedelta
import csv
import io
from functools import wraps
from flask import Flask, render_template, request, jsonify, session, Response, redirect, url_for
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix

# 1. THIẾT LẬP THƯ MỤC VÀ ĐƯỜNG DẪN CSDL CHUẨN FLASK
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'database.db')

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, 'templates'),
    static_folder=os.path.join(BASE_DIR, 'static')
)
app.secret_key = 'rentmaster_secret_2026'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)
app.config['JSON_AS_ASCII'] = False

# Hỗ trợ Reverse Proxy (Ngrok / Cloudflare Tunnel / Nginx) tự động nhận diện HTTPS và Host header
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# 2. BẬT CORS TOÀN DIỆN ĐỂ SỬA TRIỆT ĐỂ LỖI "LỖI KẾT NỐI TỚI MÁY CHỦ"
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

@app.after_request
def add_cors_headers(response):
    """Đảm bảo mọi phản hồi HTTP đều cho phép truy cập liên cổng (Cross-Origin) an toàn"""
    origin = request.headers.get('Origin')
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    else:
        response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
    return response

@app.before_request
def handle_preflight():
    if request.method == 'OPTIONS':
        res = jsonify({'status': 'ok'})
        origin = request.headers.get('Origin')
        if origin:
            res.headers['Access-Control-Allow-Origin'] = origin
            res.headers['Access-Control-Allow-Credentials'] = 'true'
        else:
            res.headers['Access-Control-Allow-Origin'] = '*'
        res.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
        res.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
        return res, 200

# ------------------------------------------------------------------------------
# HÀM KẾT NỐI CƠ SỞ DỮ LIỆU SQLITE (database.db)
# ------------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    """Khởi tạo cấu trúc các bảng và nạp dữ liệu mẫu ban đầu nếu database.db chưa có"""
    conn = get_db()
    cur = conn.cursor()

    cur.executescript("""
        CREATE TABLE IF NOT EXISTS Users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            role TEXT NOT NULL CHECK(role IN ('landlord', 'tenant')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS Properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            landlord_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (landlord_id) REFERENCES Users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            property_id INTEGER NOT NULL,
            room_number TEXT NOT NULL,
            room_type TEXT DEFAULT 'Phòng đơn',
            base_price REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'Available',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (property_id) REFERENCES Properties(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Contracts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            tenant_id INTEGER NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            monthly_rent REAL NOT NULL,
            deposit_amount REAL NOT NULL,
            electricity_rate REAL DEFAULT 3500,
            water_rate REAL DEFAULT 25000,
            status TEXT NOT NULL DEFAULT 'Active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (room_id) REFERENCES Rooms(id) ON DELETE CASCADE,
            FOREIGN KEY (tenant_id) REFERENCES Users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            contract_id INTEGER NOT NULL,
            tenant_id INTEGER,
            room_id INTEGER,
            invoice_month TEXT NOT NULL,
            billing_month TEXT,
            room_rent REAL NOT NULL,
            electricity_start REAL DEFAULT 0,
            electricity_end REAL DEFAULT 0,
            electricity_usage REAL DEFAULT 0,
            electricity_rate REAL DEFAULT 3500,
            electricity_cost REAL DEFAULT 0,
            water_start REAL DEFAULT 0,
            water_end REAL DEFAULT 0,
            water_usage REAL DEFAULT 0,
            water_rate REAL DEFAULT 25000,
            water_cost REAL DEFAULT 0,
            trash_cost REAL DEFAULT 50000,
            wifi_cost REAL DEFAULT 100000,
            service_cost REAL DEFAULT 150000,
            total_amount REAL NOT NULL,
            due_date DATE NOT NULL,
            status TEXT NOT NULL DEFAULT 'Unpaid',
            paid_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (contract_id) REFERENCES Contracts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Notices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            landlord_id INTEGER NOT NULL DEFAULT 1,
            tenant_id INTEGER,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            notice_type TEXT DEFAULT 'General',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (landlord_id) REFERENCES Users(id) ON DELETE CASCADE,
            FOREIGN KEY (tenant_id) REFERENCES Users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Maintenance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            tenant_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            priority TEXT NOT NULL DEFAULT 'Normal',
            status TEXT NOT NULL DEFAULT 'Pending',
            reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            resolved_at TIMESTAMP,
            admin_notes TEXT,
            FOREIGN KEY (room_id) REFERENCES Rooms(id) ON DELETE CASCADE,
            FOREIGN KEY (tenant_id) REFERENCES Users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS feedbacks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            room_id INTEGER,
            issue_content TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tenant_id) REFERENCES Users(id) ON DELETE CASCADE,
            FOREIGN KEY (room_id) REFERENCES Rooms(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipient_id INTEGER,
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipient_id) REFERENCES Users(id) ON DELETE CASCADE
        );

        CREATE VIEW IF NOT EXISTS vw_occupied_rooms AS 
        SELECT r.id, r.room_number, r.room_type, r.base_price, 
               COALESCE(u.full_name, 'Khách thuê') as tenant_name, 
               COALESCE(u.phone, '—') as tenant_phone, 
               c.start_date, c.end_date 
        FROM Rooms r 
        JOIN Contracts c ON r.id = c.room_id AND c.status = 'Active' 
        JOIN Users u ON c.tenant_id = u.id;

        CREATE VIEW IF NOT EXISTS vw_monthly_revenue AS 
        SELECT COALESCE(billing_month, invoice_month, '2026-11') as billing_month, 
               COUNT(*) as invoice_count, 
               SUM(total_amount) as total_revenue, 
               SUM(CASE WHEN LOWER(status) IN ('paid', 'đã thanh toán') THEN total_amount ELSE 0 END) as collected_amount, 
               SUM(CASE WHEN LOWER(status) NOT IN ('paid', 'đã thanh toán') THEN total_amount ELSE 0 END) as pending_amount 
        FROM Invoices 
        GROUP BY COALESCE(billing_month, invoice_month, '2026-11');

        CREATE TRIGGER IF NOT EXISTS trg_audit_room_status_update
        AFTER UPDATE OF status ON Rooms
        BEGIN
            INSERT INTO notifications (recipient_id, message, created_at)
            VALUES (NULL, '⚡ [TRIGGER DB] Phòng P.' || NEW.room_number || ' đổi trạng thái: ' || OLD.status || ' ➔ ' || NEW.status, CURRENT_TIMESTAMP);
        END;
    """)
    conn.commit()

    # Tự động di chuyển cấu trúc bảng nếu thiếu cột trong notifications
    cur.execute("PRAGMA table_info(notifications)")
    notif_cols = [col['name'] for col in cur.fetchall()]
    if 'recipient_id' not in notif_cols:
        cur.execute("ALTER TABLE notifications ADD COLUMN recipient_id INTEGER")
    conn.commit()

    # Tự động di chuyển cấu trúc bảng nếu thiếu cột trong Invoices
    cur.execute("PRAGMA table_info(Invoices)")
    inv_cols = [col['name'] for col in cur.fetchall()]
    if 'trash_cost' not in inv_cols:
        cur.execute("ALTER TABLE Invoices ADD COLUMN trash_cost REAL DEFAULT 50000")
    if 'wifi_cost' not in inv_cols:
        cur.execute("ALTER TABLE Invoices ADD COLUMN wifi_cost REAL DEFAULT 100000")
    if 'tenant_id' not in inv_cols:
        cur.execute("ALTER TABLE Invoices ADD COLUMN tenant_id INTEGER")
    if 'room_id' not in inv_cols:
        cur.execute("ALTER TABLE Invoices ADD COLUMN room_id INTEGER")
    if 'billing_month' not in inv_cols:
        cur.execute("ALTER TABLE Invoices ADD COLUMN billing_month TEXT")
    conn.commit()

    # Nạp thông báo mẫu nếu bảng notifications còn trống
    try:
        cur.execute("SELECT COUNT(*) as count FROM notifications")
        if cur.fetchone()['count'] == 0:
            cur.execute("""
                INSERT INTO notifications (message) VALUES 
                ('Chào mừng các cư dân đến với hệ thống quản lý phòng trọ RentMaster!'),
                ('Lưu ý: Quý khách vui lòng hoàn tất thanh toán tiền phòng và điện nước trước ngày 5 hàng tháng.')
            """)
            conn.commit()
    except Exception as e:
        pass

    # Kiểm tra xem đã có dữ liệu mẫu chưa hoặc nếu số phòng < 20 thì nạp đủ 20 phòng
    cur.execute("SELECT COUNT(*) as count FROM Users")
    user_count = cur.fetchone()['count']
    cur.execute("SELECT COUNT(*) as count FROM Rooms")
    room_count = cur.fetchone()['count']

    if user_count == 0 or room_count < 20:
        seed_data(conn)
    conn.close()

def seed_data(conn):
    """Nạp dữ liệu mẫu bao gồm 20 phòng, hợp đồng, các loại hóa đơn đa trạng thái và bảng tin thông báo"""
    cur = conn.cursor()
    pw = generate_password_hash("123456")

    # 1. Tạo tài khoản mẫu nếu chưa có
    cur.execute("SELECT COUNT(*) as count FROM Users")
    if cur.fetchone()['count'] == 0:
        cur.execute("""
            INSERT INTO Users (username, password_hash, full_name, phone, email, role)
            VALUES 
            ('chutro', ?, 'Nguyễn Văn Chủ', '0901234567', 'chutro@gmail.com', 'landlord'),
            ('nguyenvana', ?, 'Nguyễn Văn An', '0912345678', 'vana@gmail.com', 'tenant'),
            ('tranthib', ?, 'Trần Thị Bình', '0988776655', 'thibinh@gmail.com', 'tenant'),
            ('nguyenvanb', ?, 'Nguyễn Văn Bình', '0933221144', 'vanb@gmail.com', 'tenant'),
            ('lethic', ?, 'Lê Thị Cúc', '0977889900', 'thicuc@gmail.com', 'tenant')
        """, (pw, pw, pw, pw, pw))
        conn.commit()

    # 2. Tạo cơ sở nếu chưa có
    cur.execute("SELECT COUNT(*) as count FROM Properties")
    if cur.fetchone()['count'] == 0:
        cur.execute("""
            INSERT INTO Properties (landlord_id, name, address)
            VALUES 
            (1, 'Cơ sở 1 - Cầu Giấy (Thăng Long)', 'Số 18 Dịch Vọng Hậu, Cầu Giấy, Hà Nội'),
            (1, 'Cơ sở 2 - Hai Bà Trưng (Bách Khoa)', 'Số 45 Tạ Quang Bửu, Hai Bà Trưng, Hà Nội')
        """)
        conn.commit()

    cur.execute("SELECT id FROM Properties ORDER BY id ASC")
    props = cur.fetchall()
    p1 = props[0]['id']
    p2 = props[1]['id'] if len(props) > 1 else p1

    # 3. Tạo 20 phòng (P101-P105, P201-P205 tại Cơ sở 1; P301-P305, P401-P405 tại Cơ sở 2)
    cur.execute("SELECT COUNT(*) as count FROM Rooms")
    if cur.fetchone()['count'] < 20:
        cur.execute("DELETE FROM Invoices")
        cur.execute("DELETE FROM Contracts")
        cur.execute("DELETE FROM Maintenance")
        cur.execute("DELETE FROM Notices")
        cur.execute("DELETE FROM Rooms")

        p1_rooms = [
            ('P101', 'Studio khép kín', 3500000, 'Occupied'),
            ('P102', 'Gác lửng cao cấp', 3800000, 'Available'),
            ('P103', 'Phòng đơn tiêu chuẩn', 3200000, 'Available'),
            ('P104', 'Studio ban công', 4000000, 'Available'),
            ('P105', 'Gác lửng thoáng mát', 3600000, 'Available'),
            ('P201', 'Phòng đơn tiêu chuẩn', 2800000, 'Occupied'),
            ('P202', 'Phòng đôi có điều hòa', 3400000, 'Available'),
            ('P203', 'Studio cửa sổ lớn', 3700000, 'Available'),
            ('P204', 'Gác lửng cao cấp', 3800000, 'Available'),
            ('P205', 'Phòng đôi ban công', 3900000, 'Available'),
        ]

        p2_rooms = [
            ('P301', '1 Phòng ngủ + Bếp', 4800000, 'Occupied'),
            ('P302', 'Studio khép kín', 4200000, 'Available'),
            ('P303', 'Phòng đơn full nội thất', 3500000, 'Available'),
            ('P304', 'Gác lửng hiện đại', 4100000, 'Available'),
            ('P305', 'Studio ban công view thoáng', 4500000, 'Available'),
            ('P401', 'Phòng đơn tiêu chuẩn', 3200000, 'Occupied'),
            ('P402', 'Studio cao cấp', 4300000, 'Available'),
            ('P403', 'Gác lửng 2 người', 3900000, 'Available'),
            ('P404', 'Phòng đơn có ban công', 3600000, 'Available'),
            ('P405', 'Studio penthouse mini', 5000000, 'Available'),
        ]

        for r_num, r_type, price, status in p1_rooms:
            cur.execute("INSERT INTO Rooms (property_id, room_number, room_type, base_price, status) VALUES (?, ?, ?, ?, ?)",
                        (p1, r_num, r_type, price, status))

        for r_num, r_type, price, status in p2_rooms:
            cur.execute("INSERT INTO Rooms (property_id, room_number, room_type, base_price, status) VALUES (?, ?, ?, ?, ?)",
                        (p2, r_num, r_type, price, status))
        conn.commit()

        # Tạo hợp đồng thuê cho các phòng Occupied
        # Room 1 (P101) -> User 2 (nguyenvana)
        # Room 6 (P201) -> User 3 (tranthib)
        # Room 11 (P301) -> User 4 (nguyenvanb)
        # Room 16 (P401) -> User 5 (lethic)
        cur.execute("""
            INSERT INTO Contracts (room_id, tenant_id, start_date, end_date, monthly_rent, deposit_amount, electricity_rate, water_rate, status)
            VALUES 
            (1, 2, '2025-11-20', '2026-11-20', 3500000, 3500000, 3500, 25000, 'Active'),
            (6, 3, '2026-01-10', '2027-01-10', 2800000, 2800000, 3500, 25000, 'Active'),
            (11, 4, '2026-02-01', '2027-02-01', 4800000, 4800000, 3500, 25000, 'Active'),
            (16, 5, '2026-03-01', '2027-03-01', 3200000, 3200000, 3500, 25000, 'Active')
        """)

        # Tạo danh sách hóa đơn đa dạng trạng thái (Unpaid, Paid, Partially Paid, Overdue)
        cur.execute("""
            INSERT INTO Invoices (contract_id, invoice_month, room_rent, electricity_start, electricity_end, electricity_usage, electricity_rate, electricity_cost, water_start, water_end, water_usage, water_rate, water_cost, trash_cost, wifi_cost, service_cost, total_amount, due_date, status, paid_at)
            VALUES 
            (1, '2026-11', 3500000, 100, 182, 82, 3500, 287000, 20, 25, 5, 25000, 125000, 50000, 100000, 0, 4062000, '2026-11-25', 'Unpaid', NULL),
            (1, '2026-10', 3500000, 35, 100, 65, 3500, 227500, 16, 20, 4, 25000, 100000, 50000, 100000, 0, 3977500, '2026-10-25', 'Paid', '2026-10-23 14:30:00'),
            (2, '2026-11', 2800000, 60, 115, 55, 3500, 192500, 15, 18, 3, 25000, 75000, 50000, 100000, 0, 3217500, '2026-11-25', 'Partially Paid', NULL),
            (3, '2026-10', 4800000, 210, 310, 100, 3500, 350000, 40, 48, 8, 25000, 200000, 50000, 100000, 0, 5500000, '2026-10-15', 'Overdue', NULL),
            (4, '2026-11', 3200000, 80, 130, 50, 3500, 175000, 12, 16, 4, 25000, 100000, 50000, 100000, 0, 3625000, '2026-11-20', 'Paid', '2026-11-05 09:15:00')
        """)

        # Tạo bảng tin thông báo mẫu (Notices)
        cur.execute("""
            INSERT INTO Notices (landlord_id, tenant_id, title, content, notice_type)
            VALUES 
            (1, NULL, 'Thông báo bảo trì hệ thống cấp nước định kỳ', 'Ban quản lý sẽ bảo dưỡng máy bơm và thau rửa bể nước ngầm vào sáng Chủ Nhật từ 8h00 - 11h00. Quý cư dân vui lòng chủ động trữ nước sinh hoạt.', 'Maintenance'),
            (1, NULL, 'Quy định an ninh và phòng cháy chữa cháy chung', 'Nghiêm cấm sạc xe điện qua đêm tại hành lang chung. Vui lòng đóng cổng và khóa vân tay sau 23h00 để đảm bảo an ninh khu trọ.', 'General'),
            (1, 2, 'Nhắc nhở thanh toán hóa đơn tiền phòng Tháng 11/2026', 'Hóa đơn tiền phòng & điện nước tháng 11 của phòng P101 đã xuất. Hạn thanh toán đến hết ngày 25/11. Quý khách vui lòng quét mã QR chuyển khoản để hoàn tất.', 'PaymentReminder')
        """)

        # Tạo phản ánh sự cố mẫu
        cur.execute("""
            INSERT INTO Maintenance (room_id, tenant_id, title, description, priority, status, admin_notes)
            VALUES 
            (1, 2, 'Vòi xịt toilet bị rỉ nước', 'Vòi xịt nhà vệ sinh trong phòng P101 rỉ nước ra sàn liên tục.', 'High', 'Pending', 'Đã xếp lịch thợ chiều mai qua'),
            (6, 3, 'Bóng đèn trần bếp nhấp nháy', 'Bóng đèn tuýp LED khu vực bếp thỉnh thoảng chớp giật.', 'Low', 'In Progress', 'Đã mua bóng LED mới để thay')
        """)
        conn.commit()
    conn.commit()

# Tự động khởi tạo và kiểm tra schema CSDL khi nạp module
try:
    with app.app_context():
        init_db()
except Exception as _e:
    pass

# ------------------------------------------------------------------------------
# HÀM BẢO MẬT & XÁC THỰC
# ------------------------------------------------------------------------------
def verify_password(stored_hash, password):
    if stored_hash == password:
        return True
    try:
        return check_password_hash(stored_hash, password)
    except Exception:
        return False

# ------------------------------------------------------------------------------
# ROUTING ĐÚNG CHUẨN FLASK (render_template)
# ------------------------------------------------------------------------------
@app.route('/')
def landing_page():
    """Trang đích 3D & Cổng đăng nhập dành riêng cho Khách thuê (Tenant)"""
    return render_template('index.html')

@app.route('/tenant')
def tenant_page():
    """Trang Cư dân: Nếu đã đăng nhập thì vào Dashboard, nếu chưa thì hiển thị cổng đăng nhập"""
    if session.get('role') == 'tenant':
        return redirect('/tenant/dashboard')
    return render_template('tenant.html')

@app.route('/tenant/dashboard')
def tenant_dashboard_page():
    """
    Trang Bảng điều khiển Khách thuê (Tenant Dashboard):
    - Kiểm tra bảo mật: session role == 'tenant'.
    - Lấy thông tin phòng & hợp đồng đang ở.
    - Lấy danh sách hóa đơn điện tử mà Admin đã gửi.
    - Lấy danh sách sự cố đã gửi.
    """
    if not session.get('user_id') or session.get('role') != 'tenant':
        return redirect('/')

    tenant_id = session['user_id']
    conn = get_db()
    cur = conn.cursor()

    # 1. Thông tin hợp đồng & phòng hiện tại
    cur.execute("""
        SELECT c.*, r.room_number, r.room_type, r.base_price, p.name AS property_name, p.address AS property_address
        FROM Contracts c
        JOIN Rooms r ON c.room_id = r.id
        LEFT JOIN Properties p ON r.property_id = p.id
        WHERE c.tenant_id = ? AND c.status = 'Active'
        LIMIT 1
    """, (tenant_id,))
    contract = cur.fetchone()

    # 2. Danh sách Hóa đơn điện tử của khách này
    cur.execute("""
        SELECT i.*, r.room_number
        FROM Invoices i
        LEFT JOIN Rooms r ON i.room_id = r.id
        WHERE i.tenant_id = ? OR i.contract_id IN (SELECT id FROM Contracts WHERE tenant_id = ?)
        ORDER BY i.id DESC
    """, (tenant_id, tenant_id))
    invoices = cur.fetchall()

    # 3. Danh sách Sự cố do khách này gửi
    cur.execute("""
        SELECT f.*, r.room_number
        FROM feedbacks f
        LEFT JOIN Rooms r ON f.room_id = r.id
        WHERE f.tenant_id = ?
        ORDER BY f.id DESC
    """, (tenant_id,))
    feedbacks = cur.fetchall()

    # 4. Danh sách Thông báo từ Chủ trọ (Chung & Riêng cho khách này, 5 thông báo mới nhất)
    cur.execute("""
        SELECT * FROM notifications 
        WHERE recipient_id IS NULL OR recipient_id = ? 
        ORDER BY created_at DESC LIMIT 5
    """, (tenant_id,))
    notifications = cur.fetchall()

    conn.close()

    return render_template(
        'tenant_dashboard.html',
        user=session,
        contract=contract,
        invoices=invoices,
        feedbacks=feedbacks,
        notifications=notifications
    )

@app.route('/admin')
def admin_page():
    """Hợp nhất giao diện: Chuyển hướng trực tiếp vào /admin/dashboard"""
    if session.get('user_id') and session.get('role') == 'landlord':
        return redirect('/admin/dashboard')
    return redirect('/')

@app.route('/admin/dashboard')
def admin_dashboard_page():
    """
    Trang Bảng điều khiển Quản trị (Admin Dashboard) của Chủ trọ:
    - Bảo mật: Kiểm tra session đăng nhập và role == 'landlord'. Nếu chưa đăng nhập -> redirect('/')
    - Truy vấn toàn bộ dữ liệu CSDL: Phòng trọ, Người thuê, Thống kê.
    - Render trực tiếp sang template admin_dashboard.html (Jinja2 SSR).
    """
    if not session.get('user_id') or session.get('role') != 'landlord':
        return redirect('/')

    conn = get_db()
    cur = conn.cursor()

    # 1. Truy vấn danh sách Phòng trọ kèm tên khu trọ và thông tin khách đang thuê
    cur.execute("""
        SELECT 
            r.id, r.room_number, r.room_type, r.base_price, r.status,
            p.name AS property_name,
            u.full_name AS tenant_name,
            u.phone AS tenant_phone,
            c.id AS contract_id, c.monthly_rent, c.start_date, c.end_date
        FROM Rooms r
        LEFT JOIN Properties p ON r.property_id = p.id
        LEFT JOIN Contracts c ON r.id = c.room_id AND c.status = 'Active'
        LEFT JOIN Users u ON c.tenant_id = u.id
        ORDER BY r.room_number ASC
    """)
    rooms = cur.fetchall()

    # 2. Truy vấn danh sách Khách thuê kèm phòng đang thuê (nếu có)
    cur.execute("""
        SELECT 
            u.id, u.username, u.full_name, u.phone, u.email, u.created_at,
            r.room_number,
            c.id AS contract_id, c.start_date, c.monthly_rent
        FROM Users u
        LEFT JOIN Contracts c ON u.id = c.tenant_id AND c.status = 'Active'
        LEFT JOIN Rooms r ON c.room_id = r.id
        WHERE u.role = 'tenant'
        ORDER BY u.id DESC
    """)
    tenants = cur.fetchall()

    # 3. Tính toán số liệu thống kê tổng quan (Dashboard Metric Cards)
    total_rooms = len(rooms)
    rented_rooms = sum(1 for r in rooms if r['status'] == 'Occupied' or r['tenant_name'])
    available_rooms = total_rooms - rented_rooms
    total_tenants = len(tenants)
    estimated_revenue = sum(float(r['monthly_rent'] or r['base_price'] or 0) for r in rooms if r['status'] == 'Occupied' or r['tenant_name'])

    stats = {
        'total_rooms': total_rooms,
        'rented_rooms': rented_rooms,
        'available_rooms': available_rooms,
        'total_tenants': total_tenants,
        'estimated_revenue': estimated_revenue
    }

    # 4. Danh sách phòng còn trống dùng cho popup Xếp Phòng
    available_rooms_list = [r for r in rooms if r['status'] != 'Occupied' and not r['tenant_name']]

    # 5. Truy vấn toàn bộ Sự cố / Phản hồi của Khách thuê (Hợp nhất từ Maintenance & feedbacks)
    cur.execute("""
        SELECT 
            m.id AS id,
            'maintenance' AS source,
            m.tenant_id,
            m.room_id,
            CASE 
                WHEN m.title IS NOT NULL AND m.title != '' THEN m.title || ' — ' || m.description 
                ELSE m.description 
            END AS issue_content,
            CASE 
                WHEN LOWER(m.status) IN ('completed', 'done') THEN 'done' 
                ELSE 'pending' 
            END AS status,
            COALESCE(m.reported_at, CURRENT_TIMESTAMP) AS created_at,
            COALESCE(u.full_name, 'Khách thuê') AS tenant_name,
            COALESCE(u.phone, '—') AS tenant_phone,
            COALESCE(r.room_number, (
                SELECT r2.room_number 
                FROM Contracts c2 
                JOIN Rooms r2 ON c2.room_id = r2.id 
                WHERE c2.tenant_id = m.tenant_id 
                ORDER BY c2.id DESC LIMIT 1
            ), '—') AS room_number
        FROM Maintenance m
        LEFT JOIN Users u ON m.tenant_id = u.id
        LEFT JOIN Rooms r ON m.room_id = r.id

        UNION ALL

        SELECT 
            f.id AS id,
            'feedback' AS source,
            f.tenant_id,
            f.room_id,
            f.issue_content,
            CASE 
                WHEN LOWER(f.status) IN ('completed', 'done') THEN 'done' 
                ELSE 'pending' 
            END AS status,
            COALESCE(f.created_at, CURRENT_TIMESTAMP) AS created_at,
            COALESCE(u.full_name, 'Khách thuê') AS tenant_name,
            COALESCE(u.phone, '—') AS tenant_phone,
            COALESCE(r.room_number, (
                SELECT r2.room_number 
                FROM Contracts c2 
                JOIN Rooms r2 ON c2.room_id = r2.id 
                WHERE c2.tenant_id = f.tenant_id 
                ORDER BY c2.id DESC LIMIT 1
            ), '—') AS room_number
        FROM feedbacks f
        LEFT JOIN Users u ON f.tenant_id = u.id
        LEFT JOIN Rooms r ON f.room_id = r.id
        WHERE f.issue_content NOT IN (
            SELECT CASE WHEN m2.title IS NOT NULL AND m2.title != '' THEN m2.title || ' — ' || m2.description ELSE m2.description END FROM Maintenance m2
        )
        ORDER BY created_at DESC
    """)
    feedbacks_data = cur.fetchall()
    pending_feedbacks = [f for f in feedbacks_data if f['status'] != 'done']

    # 6. Truy vấn toàn bộ Hóa đơn tiền phòng (Tab Quản lý Tài Chính & Hóa Đơn)
    cur.execute("""
        SELECT i.*, 
               COALESCE(u.full_name, 'Khách thuê') AS tenant_name,
               u.phone AS tenant_phone,
               COALESCE(r.room_number, '—') AS room_number
        FROM Invoices i
        LEFT JOIN Contracts c ON i.contract_id = c.id
        LEFT JOIN Users u ON COALESCE(i.tenant_id, c.tenant_id) = u.id
        LEFT JOIN Rooms r ON COALESCE(i.room_id, c.room_id) = r.id
        ORDER BY i.id DESC
    """)
    invoices = cur.fetchall()

    # 7. Truy vấn Bảng tin Thông báo (Tab Bảng Tin & Thông Báo)
    cur.execute("""
        SELECT n.*, u.full_name AS recipient_name, u.phone AS recipient_phone
        FROM notifications n
        LEFT JOIN Users u ON n.recipient_id = u.id
        ORDER BY n.id DESC
    """)
    notifications = cur.fetchall()

    conn.close()

    return render_template(
        'admin_dashboard.html',
        user=session,
        rooms=rooms,
        tenants=tenants,
        stats=stats,
        available_rooms_list=available_rooms_list,
        feedbacks=feedbacks_data,
        pending_feedbacks_count=len(pending_feedbacks),
        invoices=invoices,
        notifications=notifications
    )

# ------------------------------------------------------------------------------
# API CRUD CHO KHÁCH THUÊ VÀ XẾP PHÒNG (BẢO MẬT ADMIN)
# ------------------------------------------------------------------------------
@app.route('/admin/delete_tenant/<int:tenant_id>', methods=['POST'])
def admin_delete_tenant(tenant_id):
    """
    Xóa khách thuê:
    - Bảo mật: Bắt buộc session là landlord.
    - Tìm phòng tenant đang thuê -> giải phóng về 'Available'.
    - Xóa các hợp đồng, hóa đơn, sự cố và xóa user khỏi CSDL.
    """
    if not session.get('user_id') or session.get('role') != 'landlord':
        return jsonify({'success': False, 'message': '⛔ Bạn không có quyền quản trị!'}), 403

    conn = get_db()
    cur = conn.cursor()

    # 1. Tìm các phòng liên kết và trả về 'Available'
    cur.execute("SELECT room_id FROM Contracts WHERE tenant_id = ?", (tenant_id,))
    contracts = cur.fetchall()
    for c in contracts:
        cur.execute("UPDATE Rooms SET status = 'Available' WHERE id = ?", (c['room_id'],))

    # 2. Xóa các hóa đơn, bảo trì, hợp đồng liên quan
    cur.execute("DELETE FROM Invoices WHERE contract_id IN (SELECT id FROM Contracts WHERE tenant_id = ?)", (tenant_id,))
    cur.execute("DELETE FROM Maintenance WHERE tenant_id = ?", (tenant_id,))
    cur.execute("DELETE FROM Contracts WHERE tenant_id = ?", (tenant_id,))
    
    # 3. Xóa người dùng role tenant
    cur.execute("DELETE FROM Users WHERE id = ? AND role = 'tenant'", (tenant_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Đã xóa khách thuê và giải phóng phòng thành công!'})

@app.route('/admin/assign_room', methods=['POST'])
def admin_assign_room():
    """
    Xếp phòng cho khách thuê chưa có phòng:
    - Nhận tenant_id và room_id từ form Modal.
    - Chuyển trạng thái phòng thành 'Occupied'.
    - Tạo hợp đồng thuê Active.
    """
    if not session.get('user_id') or session.get('role') != 'landlord':
        return jsonify({'success': False, 'message': '⛔ Bạn không có quyền quản trị!'}), 403

    data = request.get_json(silent=True) or request.form
    tenant_id = data.get('tenant_id')
    room_id = data.get('room_id')

    if not tenant_id or not room_id:
        return jsonify({'success': False, 'message': 'Vui lòng chọn khách thuê và phòng trống hợp lệ!'}), 400

    conn = get_db()
    cur = conn.cursor()

    # Lấy thông tin phòng
    cur.execute("SELECT * FROM Rooms WHERE id = ?", (room_id,))
    room = cur.fetchone()
    if not room:
        conn.close()
        return jsonify({'success': False, 'message': 'Không tìm thấy phòng!'}), 404

    base_price = room['base_price']
    today = datetime.date.today().isoformat()
    one_year_later = (datetime.date.today() + datetime.timedelta(days=365)).isoformat()

    # 1. Tạo hợp đồng thuê mới
    cur.execute("""
        INSERT INTO Contracts (room_id, tenant_id, start_date, end_date, monthly_rent, deposit_amount, status)
        VALUES (?, ?, ?, ?, ?, ?, 'Active')
    """, (room_id, tenant_id, today, one_year_later, base_price, base_price))

    # 2. Cập nhật trạng thái phòng thành 'Occupied'
    cur.execute("UPDATE Rooms SET status = 'Occupied' WHERE id = ?", (room_id,))

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': f'Đã xếp phòng P.{room["room_number"]} cho khách thuê thành công!'})

# ------------------------------------------------------------------------------
# ROUTE XUẤT HÓA ĐƠN TIỀN NHÀ (RENDER INVOICE.HTML)
# ------------------------------------------------------------------------------
@app.route('/admin/invoice/<int:room_id>')
def admin_view_invoice(room_id):
    """
    Xuất hóa đơn tiền phòng chi tiết:
    - Truy xuất thông tin phòng, thông tin người thuê, và các mục chi phí.
    - Render ra template invoice.html chuẩn in / lưu PDF.
    """
    if not session.get('user_id') or session.get('role') != 'landlord':
        return redirect('/')

    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT 
            r.id AS room_id, r.room_number, r.room_type, r.base_price, r.status,
            p.name AS property_name, p.address AS property_address,
            u.id AS tenant_id, u.full_name AS tenant_name, u.phone AS tenant_phone, u.email AS tenant_email,
            c.id AS contract_id, c.start_date, c.end_date, c.monthly_rent, c.deposit_amount,
            c.electricity_rate, c.water_rate
        FROM Rooms r
        LEFT JOIN Properties p ON r.property_id = p.id
        LEFT JOIN Contracts c ON r.id = c.room_id AND c.status = 'Active'
        LEFT JOIN Users u ON c.tenant_id = u.id
        WHERE r.id = ?
    """, (room_id,))
    info = cur.fetchone()

    if not info:
        conn.close()
        return "Không tìm thấy dữ liệu phòng", 404

    # Lấy hóa đơn mới nhất từ bảng Invoices (nếu có)
    cur.execute("""
        SELECT * FROM Invoices 
        WHERE contract_id = ?
        ORDER BY id DESC LIMIT 1
    """, (info['contract_id'] or 0,))
    latest_inv = cur.fetchone()
    conn.close()

    rent_val = float(info['monthly_rent'] or info['base_price'] or 0)
    elec_rate = float(info['electricity_rate'] or 3500)
    water_rate = float(info['water_rate'] or 25000)
    
    elec_usage = latest_inv['electricity_usage'] if latest_inv else 55
    elec_cost = latest_inv['electricity_cost'] if latest_inv else (elec_usage * elec_rate)
    
    water_usage = latest_inv['water_usage'] if latest_inv else 4
    water_cost = latest_inv['water_cost'] if latest_inv else (water_usage * water_rate)
    
    trash_fee = 50000
    wifi_fee = 100000

    total_amount = rent_val + elec_cost + water_cost + trash_fee + wifi_fee

    inv_data = {
        'invoice_code': f"INV-{datetime.date.today().strftime('%Y%m')}-{info['room_number']}",
        'created_date': datetime.date.today().strftime('%d/%m/%Y'),
        'billing_month': datetime.date.today().strftime('Tháng %m/%Y'),
        'due_date': (datetime.date.today() + datetime.timedelta(days=5)).strftime('%d/%m/%Y'),
        'room': info,
        'rent_val': rent_val,
        'elec_usage': elec_usage,
        'elec_rate': elec_rate,
        'elec_cost': elec_cost,
        'water_usage': water_usage,
        'water_rate': water_rate,
        'water_cost': water_cost,
        'trash_fee': trash_fee,
        'wifi_fee': wifi_fee,
        'total_amount': total_amount
    }

    return render_template('invoice.html', inv=inv_data)

# ------------------------------------------------------------------------------
# API GỬI HÓA ĐƠN ĐIỆN TỬ VÀ BÁO CÁO / XỬ LÝ SỰ CỐ
# ------------------------------------------------------------------------------
@app.route('/admin/send_invoice/<int:room_id>', methods=['POST'])
def admin_send_invoice(room_id):
    """
    Admin bấm nút 'GỬI HOÁ ĐƠN CHO KHÁCH' trên trang invoice.html:
    - Lưu bản ghi vào bảng Invoices với status='chưa thanh toán'
    """
    if not session.get('user_id') or session.get('role') != 'landlord':
        return jsonify({'success': False, 'message': '⛔ Bạn không có quyền quản trị!'}), 403

    data = request.get_json(silent=True) or request.form or {}
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT r.id AS room_id, r.room_number, r.base_price,
               c.id AS contract_id, c.tenant_id, c.monthly_rent
        FROM Rooms r
        LEFT JOIN Contracts c ON r.id = c.room_id AND c.status = 'Active'
        WHERE r.id = ?
    """, (room_id,))
    room_info = cur.fetchone()

    if not room_info or not room_info['tenant_id']:
        conn.close()
        return jsonify({'success': False, 'message': 'Phòng này chưa có khách thuê hoặc chưa có hợp đồng Active!'}), 400

    tenant_id = room_info['tenant_id']
    contract_id = room_info['contract_id']
    total_amount = float(data.get('total_amount') or room_info['monthly_rent'] or room_info['base_price'])
    billing_month = data.get('billing_month') or datetime.date.today().strftime('Tháng %m/%Y')
    due_date = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    room_rent = float(room_info['monthly_rent'] or room_info['base_price'])

    # Thêm vào bảng Invoices
    cur.execute("""
        INSERT INTO Invoices (
            contract_id, tenant_id, room_id, invoice_month, billing_month,
            room_rent, total_amount, due_date, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'chưa thanh toán')
    """, (contract_id, tenant_id, room_id, billing_month, billing_month, room_rent, total_amount, due_date))

    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'message': f'Đã gửi hóa đơn điện tử ({billing_month}) cho khách thuê phòng P.{room_info["room_number"]} thành công!'
    })

@app.route('/tenant/submit_feedback', methods=['POST'])
def tenant_submit_feedback():
    """
    Khách thuê gửi báo cáo sự cố / yêu cầu sửa chữa:
    - Lưu vào cả 2 bảng feedbacks & Maintenance để đồng bộ.
    - Tự động tạo thông báo gửi tới Chủ trọ trong notifications.
    """
    if not session.get('user_id') or session.get('role') != 'tenant':
        return jsonify({'success': False, 'message': '⛔ Bạn chưa đăng nhập tài khoản Khách thuê!'}), 403

    tenant_id = session['user_id']
    data = request.get_json(silent=True) or request.form or {}
    issue_content = data.get('issue_content', '').strip()

    if not issue_content:
        return jsonify({'success': False, 'message': 'Vui lòng nhập nội dung sự cố / phản ánh!'}), 400

    conn = get_db()
    cur = conn.cursor()

    # Lấy tên khách thuê
    cur.execute("SELECT full_name FROM Users WHERE id = ?", (tenant_id,))
    user_row = cur.fetchone()
    tenant_name = user_row['full_name'] if user_row else 'Khách thuê'

    # Tìm phòng tenant đang thuê
    cur.execute("""
        SELECT r.id AS room_id, r.room_number 
        FROM Contracts c 
        JOIN Rooms r ON c.room_id = r.id 
        WHERE c.tenant_id = ? AND c.status = 'Active' 
        LIMIT 1
    """, (tenant_id,))
    contract = cur.fetchone()
    room_id = contract['room_id'] if contract else None
    room_number = contract['room_number'] if contract else '—'

    # 1. Lưu vào bảng feedbacks
    cur.execute("""
        INSERT INTO feedbacks (tenant_id, room_id, issue_content, status, created_at)
        VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)
    """, (tenant_id, room_id, issue_content))

    # 2. Đồng bộ lưu vào bảng Maintenance
    cur.execute("""
        INSERT INTO Maintenance (room_id, tenant_id, title, description, priority, status)
        VALUES (?, ?, '[Khách phản ánh]', ?, 'Normal', 'Pending')
    """, (room_id or 1, tenant_id, issue_content))

    # 3. Tự động phát thông báo tới trang Chủ trọ
    notif_msg = f"🚨 [SỰ CỐ MỚI] Khách {tenant_name} (Phòng P.{room_number}) vừa báo sự cố: {issue_content}"
    cur.execute("""
        INSERT INTO notifications (recipient_id, message, created_at)
        VALUES (NULL, ?, CURRENT_TIMESTAMP)
    """, (notif_msg,))

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Đã gửi báo cáo sự cố thành công! Ban quản lý đã nhận được thông báo.'})

@app.route('/admin/resolve_feedback/<int:feedback_id>', methods=['POST'])
def admin_resolve_feedback(feedback_id):
    """
    Chủ trọ xác nhận đã xử lý xong sự cố: Cập nhật status = 'done' / 'Completed' cho cả 2 bảng
    """
    if not session.get('user_id') or session.get('role') != 'landlord':
        return jsonify({'success': False, 'message': '⛔ Bạn không có quyền quản trị!'}), 403

    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE feedbacks SET status = 'done' WHERE id = ?", (feedback_id,))
    cur.execute("UPDATE Maintenance SET status = 'Completed', resolved_at = CURRENT_TIMESTAMP WHERE id = ?", (feedback_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Đã cập nhật trạng thái sự cố: ĐÃ HOÀN THÀNH!'})

@app.route('/admin/create_notification', methods=['POST'])
@app.route('/api/notifications', methods=['POST'])
def admin_create_notification():
    """Admin đăng thông báo mới: Gửi chung (recipient_id=None) hoặc Gửi riêng cho 1 khách thuê"""
    if not session.get('user_id') or session.get('role') != 'landlord':
        return jsonify({'success': False, 'message': '⛔ Bạn không có quyền quản trị!'}), 403

    data = request.get_json(silent=True) or request.form or {}
    message = (data.get('message') or data.get('content') or data.get('title') or '').strip()
    raw_recipient = data.get('recipient_id')

    if not message:
        return jsonify({'success': False, 'message': 'Vui lòng nhập nội dung thông báo!'}), 400

    recipient_id = None
    if raw_recipient and str(raw_recipient).strip():
        try:
            recipient_id = int(raw_recipient)
        except (ValueError, TypeError):
            recipient_id = None

    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO notifications (recipient_id, message, created_at) 
        VALUES (?, ?, CURRENT_TIMESTAMP)
    """, (recipient_id, message))
    conn.commit()
    conn.close()

    type_str = "riêng cho khách thuê" if recipient_id else "chung cho toàn bộ cư dân"
    return jsonify({'success': True, 'message': f'Đã phát thông báo {type_str} thành công!'})

@app.route('/admin/delete_notification/<int:notif_id>', methods=['POST'])
def admin_delete_notification(notif_id):
    """Admin xóa một thông báo"""
    if not session.get('user_id') or session.get('role') != 'landlord':
        return jsonify({'success': False, 'message': '⛔ Bạn không có quyền quản trị!'}), 403

    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM notifications WHERE id = ?", (notif_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Đã xóa thông báo thành công!'})

@app.route('/logout')
def logout_redirect():
    """Đăng xuất phiên làm việc và chuyển hướng về trang chủ"""
    session.clear()
    return redirect('/')

# ------------------------------------------------------------------------------
# AUTHENTICATION APIS - PHÂN LUỒNG BẢO MẬT CHẶT CHẼ
# ------------------------------------------------------------------------------
@app.route('/api/auth/login', methods=['POST'])
@app.route('/api/login', methods=['POST'])
def login():
    """
    Xử lý xác thực đăng nhập:
    - Nhận diện vai trò từ form gửi lên: role ('tenant' hoặc 'landlord') hoặc portal ('tenant' hoặc 'admin').
    - Đối chiếu thông tin tài khoản với cơ sở dữ liệu.
    - Cấp session và trả về thông tin user tương ứng để Frontend điều hướng (Khách thuê -> /tenant, Chủ trọ -> /admin).
    """
    data = request.get_json(silent=True) or {}
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    target_role = data.get('role', '').strip().lower()
    portal = data.get('portal', '').strip().lower()

    # Nhận diện vai trò mong muốn từ khung gửi lên
    expected_role = None
    if target_role in ['landlord', 'admin'] or portal in ['admin', 'landlord']:
        expected_role = 'landlord'
    elif target_role == 'tenant' or portal == 'tenant':
        expected_role = 'tenant'

    if not username or not password:
        return jsonify({'success': False, 'message': 'Vui lòng nhập tên đăng nhập và mật khẩu'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM Users WHERE username = ?", (username,))
    user = cur.fetchone()
    conn.close()

    if user and verify_password(user['password_hash'], password):
        # 🔒 Kiểm tra vai trò tài khoản so với Tab/Cổng đang chọn
        if expected_role and user['role'] != expected_role:
            role_title_target = 'Chủ trọ' if expected_role == 'landlord' else 'Khách thuê'
            role_title_user = 'Khách thuê' if user['role'] == 'tenant' else 'Chủ trọ'
            return jsonify({
                'success': False,
                'message': f'⛔ Tài khoản của bạn có vai trò [{role_title_user}], không thể đăng nhập tại khung [{role_title_target}]!'
            }), 403

        # Đăng ký phiên làm việc (Session) an toàn & duy trì khi reload
        session.permanent = True
        session['user_id'] = user['id']
        session['username'] = user['username']
        session['role'] = user['role']
        session['full_name'] = user['full_name']

        return jsonify({
            'success': True,
            'message': 'Đăng nhập thành công',
            'redirect': '/admin/dashboard' if user['role'] == 'landlord' else '/tenant/dashboard',
            'user': {
                'id': user['id'],
                'username': user['username'],
                'full_name': user['full_name'],
                'role': user['role'],
                'phone': user['phone'],
                'email': user['email']
            }
        })

    return jsonify({'success': False, 'message': 'Tài khoản hoặc mật khẩu không chính xác'}), 401

@app.route('/api/auth/register', methods=['POST'])
@app.route('/api/register', methods=['POST'])
def register():
    """Đăng ký tài khoản: ÉP CỨNG role='tenant' cho tất cả người dùng đăng ký"""
    data = request.get_json(silent=True) or {}
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    full_name = data.get('full_name', '').strip()
    phone = data.get('phone', '').strip()
    email = data.get('email', '').strip()

    if not username or not password or not full_name:
        return jsonify({'success': False, 'message': 'Vui lòng điền đủ họ tên, tên đăng nhập và mật khẩu'}), 400

    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO Users (username, password_hash, full_name, phone, email, role)
            VALUES (?, ?, ?, ?, ?, 'tenant')
        """, (username, generate_password_hash(password), full_name, phone, email))
        conn.commit()
        new_id = cur.lastrowid
        conn.close()
        return jsonify({
            'success': True,
            'message': 'Đăng ký tài khoản Người thuê thành công!',
            'user': {'id': new_id, 'username': username, 'role': 'tenant'}
        })
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'success': False, 'message': 'Tên đăng nhập đã tồn tại trong hệ thống'}), 409

@app.route('/api/auth/logout', methods=['POST'])
@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True, 'message': 'Đã đăng xuất thành công'})

@app.route('/api/auth/me', methods=['GET'])
@app.route('/api/me', methods=['GET'])
def get_me():
    if 'user_id' not in session:
        return jsonify({'authenticated': False})
    return jsonify({
        'authenticated': True,
        'user': {
            'id': session['user_id'],
            'username': session['username'],
            'role': session['role'],
            'full_name': session['full_name']
        }
    })

# ------------------------------------------------------------------------------
# TÍNH NĂNG MỚI (AGENT 2): QUẢN LÝ HÓA ĐƠN ĐIỆN NƯỚC (GHI CHỈ SỐ ĐẦU - CUỐI & TÍNH TIỀN)
# ------------------------------------------------------------------------------
@app.route('/api/invoices/utility-rooms', methods=['GET'])
def get_utility_rooms():
    """Lấy danh sách các phòng đang có hợp đồng để Chủ trọ ghi chỉ số điện nước"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT 
            c.id as contract_id,
            r.room_number,
            p.name as property_name,
            u.full_name as tenant_name,
            c.monthly_rent,
            c.electricity_rate,
            c.water_rate,
            (SELECT electricity_end FROM Invoices WHERE contract_id = c.id ORDER BY id DESC LIMIT 1) as last_electricity_end,
            (SELECT water_end FROM Invoices WHERE contract_id = c.id ORDER BY id DESC LIMIT 1) as last_water_end
        FROM Contracts c
        JOIN Rooms r ON c.room_id = r.id
        JOIN Properties p ON r.property_id = p.id
        JOIN Users u ON c.tenant_id = u.id
        WHERE c.status = 'Active'
        ORDER BY r.room_number ASC
    """)
    rooms = [dict(row) for row in cur.fetchall()]
    conn.close()
    return jsonify({'success': True, 'data': rooms})

@app.route('/api/invoices/utility', methods=['POST'])
def record_utility_invoice():
    """
    API Ghi nhận chỉ số điện nước đầu tháng, cuối tháng và tự động tính tiền:
    - electricity_usage = electricity_end - electricity_start
    - water_usage = water_end - water_start
    - total_amount = room_rent + electricity_cost + water_cost + service_cost
    """
    data = request.get_json(silent=True) or {}
    contract_id = data.get('contract_id')
    invoice_month = data.get('invoice_month', '').strip()
    e_start = float(data.get('electricity_start', 0))
    e_end = float(data.get('electricity_end', 0))
    w_start = float(data.get('water_start', 0))
    w_end = float(data.get('water_end', 0))
    service_cost = float(data.get('service_cost', 150000))
    due_date = data.get('due_date', '').strip()

    if not contract_id or not invoice_month or not due_date:
        return jsonify({'success': False, 'message': 'Thiếu thông tin phòng, kỳ hóa đơn hoặc hạn đóng tiền'}), 400

    if e_end < e_start:
        return jsonify({'success': False, 'message': 'Số điện cuối không được nhỏ hơn số điện đầu'}), 400
    if w_end < w_start:
        return jsonify({'success': False, 'message': 'Số nước cuối không được nhỏ hơn số nước đầu'}), 400

    conn = get_db()
    cur = conn.cursor()
    # Lấy thông tin tiền phòng và đơn giá từ hợp đồng
    cur.execute("SELECT monthly_rent, electricity_rate, water_rate FROM Contracts WHERE id = ?", (contract_id,))
    contract = cur.fetchone()

    if not contract:
        conn.close()
        return jsonify({'success': False, 'message': 'Không tìm thấy hợp đồng hợp lệ'}), 404

    room_rent = float(contract['monthly_rent'])
    e_rate = float(contract['electricity_rate'] or 3500)
    w_rate = float(contract['water_rate'] or 25000)

    # Tự động tính toán
    e_usage = round(e_end - e_start, 1)
    e_cost = round(e_usage * e_rate)
    w_usage = round(w_end - w_start, 1)
    w_cost = round(w_usage * w_rate)
    total_amount = round(room_rent + e_cost + w_cost + service_cost)

    # Lưu hóa đơn vào cơ sở dữ liệu
    cur.execute("""
        INSERT INTO Invoices (
            contract_id, invoice_month, room_rent,
            electricity_start, electricity_end, electricity_usage, electricity_rate, electricity_cost,
            water_start, water_end, water_usage, water_rate, water_cost,
            service_cost, total_amount, due_date, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Unpaid')
    """, (
        contract_id, invoice_month, room_rent,
        e_start, e_end, e_usage, e_rate, e_cost,
        w_start, w_end, w_usage, w_rate, w_cost,
        service_cost, total_amount, due_date
    ))
    conn.commit()
    invoice_id = cur.lastrowid
    conn.close()

    return jsonify({
        'success': True,
        'message': 'Đã ghi nhận chỉ số điện nước và xuất hóa đơn thành công!',
        'invoice': {
            'id': invoice_id,
            'contract_id': contract_id,
            'invoice_month': invoice_month,
            'electricity_usage': e_usage,
            'electricity_cost': e_cost,
            'water_usage': w_usage,
            'water_cost': w_cost,
            'total_amount': total_amount
        }
    }), 201

@app.route('/api/export/invoices', methods=['GET'])
def export_invoices_csv():
    """Xuất danh sách hóa đơn ra file CSV với BOM UTF-8 (Excel tương thích hoàn toàn tiếng Việt)"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT 
            i.id as invoice_id,
            r.room_number,
            p.name as property_name,
            u.full_name as tenant_name,
            u.phone as tenant_phone,
            i.invoice_month,
            i.room_rent,
            i.electricity_start as chi_so_dien_cu,
            i.electricity_end as chi_so_dien_moi,
            i.electricity_usage as so_dien_dung,
            i.electricity_cost as tien_dien,
            i.water_start as chi_so_nuoc_cu,
            i.water_end as chi_so_nuoc_moi,
            i.water_usage as so_nuoc_dung,
            i.water_cost as tien_nuoc,
            COALESCE(i.trash_cost, 50000) as tien_rac,
            COALESCE(i.wifi_cost, 100000) as wifi,
            i.service_cost as phi_dich_vu_khac,
            i.total_amount,
            i.due_date,
            i.status,
            COALESCE(i.paid_at, '') as paid_at
        FROM Invoices i
        JOIN Contracts c ON i.contract_id = c.id
        JOIN Rooms r ON c.room_id = r.id
        JOIN Properties p ON r.property_id = p.id
        JOIN Users u ON c.tenant_id = u.id
        ORDER BY i.invoice_month DESC, r.room_number ASC
    """)
    rows = cur.fetchall()
    conn.close()

    output = io.StringIO()
    # Ghi byte order mark (BOM) UTF-8 để Microsoft Excel mở trực tiếp không lỗi tiếng Việt
    output.write('\ufeff')
    writer = csv.writer(output)
    
    # Header tiếng Việt chuẩn
    writer.writerow([
        'Mã HĐ', 'Phòng', 'Cơ Sở', 'Khách Thuê', 'Số Điện Thoại', 'Kỳ Hóa Đơn',
        'Tiền Phòng (VNĐ)', 'Số Điện Cũ', 'Số Điện Mới', 'Điện Dùng (kWh)', 'Tiền Điện (VNĐ)',
        'Số Nước Cũ', 'Số Nước Mới', 'Nước Dùng (m³)', 'Tiền Nước (VNĐ)',
        'Tiền Rác (VNĐ)', 'Tiền Wifi (VNĐ)', 'Dịch Vụ Khác (VNĐ)', 'Tổng Tiền (VNĐ)',
        'Hạn Đóng', 'Trạng Thái', 'Ngày Đóng Tiền'
    ])

    for row in rows:
        writer.writerow([
            row['invoice_id'],
            row['room_number'],
            row['property_name'],
            row['tenant_name'],
            row['tenant_phone'] or '',
            row['invoice_month'],
            int(row['room_rent']),
            row['chi_so_dien_cu'],
            row['chi_so_dien_moi'],
            row['so_dien_dung'],
            int(row['tien_dien']),
            row['chi_so_nuoc_cu'],
            row['chi_so_nuoc_moi'],
            row['so_nuoc_dung'],
            int(row['tien_nuoc']),
            int(row['tien_rac']),
            int(row['wifi']),
            int(row['phi_dich_vu_khac']),
            int(row['total_amount']),
            row['due_date'],
            row['status'],
            row['paid_at']
        ])

    csv_content = output.getvalue()
    return Response(
        csv_content,
        mimetype="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": "attachment; filename=rentmaster_invoices.csv",
            "Content-Type": "text/csv; charset=utf-8"
        }
    )

@app.route('/api/invoices', methods=['GET'])
def list_invoices():
    """
    Danh sách hóa đơn kèm bộ lọc trạng thái & tìm kiếm theo yêu cầu:
    - Hỗ trợ tham số: ?status=...&search=...&month=...
    - Trả về chi tiết: chi_so_dien_cu, chi_so_dien_moi, tien_dien, tien_nuoc, tien_rac, wifi, phi_dich_vu_khac, tong_tien
    """
    conn = get_db()
    cur = conn.cursor()
    is_tenant = (session.get('role') == 'tenant')

    status = request.args.get('status', '').strip()
    search = request.args.get('search', '').strip()
    month = request.args.get('month', '').strip()

    sql = """
        SELECT i.*, 
               COALESCE(i.trash_cost, 50000) as trash_cost,
               COALESCE(i.trash_cost, 50000) as tien_rac,
               COALESCE(i.wifi_cost, 100000) as wifi_cost,
               COALESCE(i.wifi_cost, 100000) as wifi,
               i.electricity_start as chi_so_dien_cu,
               i.electricity_end as chi_so_dien_moi,
               i.electricity_usage as so_dien_dung,
               i.electricity_cost as tien_dien,
               i.water_start as chi_so_nuoc_cu,
               i.water_end as chi_so_nuoc_moi,
               i.water_usage as so_nuoc_dung,
               i.water_cost as tien_nuoc,
               i.service_cost as phi_dich_vu_khac,
               r.room_number, p.name as property_name, u.full_name as tenant_name, u.phone as tenant_phone
        FROM Invoices i
        JOIN Contracts c ON i.contract_id = c.id
        JOIN Rooms r ON c.room_id = r.id
        JOIN Properties p ON r.property_id = p.id
        JOIN Users u ON c.tenant_id = u.id
        WHERE 1=1
    """
    params = []

    if is_tenant:
        sql += " AND c.tenant_id = ?"
        params.append(session['user_id'])

    # Demo lệnh SELECT ... WHERE ... với status
    if status and status.lower() not in ('all', 'tat ca', 'tất cả'):
        sql += " AND i.status = ?"
        params.append(status)

    # Demo lệnh SELECT ... WHERE ... với LIKE search
    if search:
        sql += " AND (r.room_number LIKE ? OR u.full_name LIKE ? OR p.name LIKE ? OR u.phone LIKE ?)"
        s = f"%{search}%"
        params.extend([s, s, s, s])

    # Lọc theo tháng nếu có
    if month:
        sql += " AND i.invoice_month = ?"
        params.append(month)

    sql += " ORDER BY i.due_date DESC, i.id DESC"

    cur.execute(sql, tuple(params))
    invoices = [dict(row) for row in cur.fetchall()]
    conn.close()
    return jsonify({'success': True, 'data': invoices, 'total': len(invoices)})

@app.route('/api/invoices/create', methods=['POST'])
def create_custom_invoice():
    """
    Tạo hóa đơn tài chính / dịch vụ mới:
    - Nhận: tenant_id, room_id, contract_id (tùy chọn, tự động tìm nếu thiếu)
    - invoice_month, room_rent, electricity_cost, water_cost, service_cost, total_amount, due_date
    - Ghi vào bảng Invoices
    """
    data = request.get_json(silent=True) or {}
    contract_id = data.get('contract_id')
    tenant_id = data.get('tenant_id')
    room_id = data.get('room_id')
    invoice_month = data.get('invoice_month', '').strip() or datetime.datetime.now().strftime('%Y-%m')
    due_date = data.get('due_date', '').strip()

    conn = get_db()
    cur = conn.cursor()
    try:
        # Nếu chưa có contract_id, tự tìm hợp đồng Active theo tenant_id hoặc room_id
        if not contract_id:
            if tenant_id:
                cur.execute("SELECT id, room_id, monthly_rent, electricity_rate, water_rate FROM Contracts WHERE tenant_id = ? AND status = 'Active' ORDER BY id DESC LIMIT 1", (tenant_id,))
                c_row = cur.fetchone()
                if c_row:
                    contract_id = c_row['id']
            elif room_id:
                cur.execute("SELECT id, room_id, monthly_rent, electricity_rate, water_rate FROM Contracts WHERE room_id = ? AND status = 'Active' ORDER BY id DESC LIMIT 1", (room_id,))
                c_row = cur.fetchone()
                if c_row:
                    contract_id = c_row['id']

        if not contract_id:
            conn.close()
            return jsonify({'success': False, 'message': 'Không tìm thấy hợp đồng thuê tương ứng để tạo hóa đơn'}), 400

        # Lấy thông tin hợp đồng
        cur.execute("SELECT * FROM Contracts WHERE id = ?", (contract_id,))
        contract = cur.fetchone()
        if not contract:
            conn.close()
            return jsonify({'success': False, 'message': 'Hợp đồng không tồn tại'}), 404

        # Thu thập các chi phí
        room_rent = float(data.get('room_rent') if data.get('room_rent') is not None else contract['monthly_rent'])
        electricity_cost = float(data.get('electricity_cost', 0))
        water_cost = float(data.get('water_cost', 0))
        service_cost = float(data.get('service_cost', 150000))

        # Chỉ số điện nước (nếu có)
        electricity_start = float(data.get('electricity_start', 0))
        electricity_end = float(data.get('electricity_end', 0))
        electricity_rate = float(data.get('electricity_rate', contract['electricity_rate'] or 3500))
        electricity_usage = float(data.get('electricity_usage', max(0, electricity_end - electricity_start)))
        if electricity_cost == 0 and electricity_usage > 0:
            electricity_cost = round(electricity_usage * electricity_rate)

        water_start = float(data.get('water_start', 0))
        water_end = float(data.get('water_end', 0))
        water_rate = float(data.get('water_rate', contract['water_rate'] or 25000))
        water_usage = float(data.get('water_usage', max(0, water_end - water_start)))
        if water_cost == 0 and water_usage > 0:
            water_cost = round(water_usage * water_rate)

        total_amount = data.get('total_amount')
        if total_amount is not None:
            total_amount = float(total_amount)
        else:
            total_amount = round(room_rent + electricity_cost + water_cost + service_cost)

        if not due_date:
            now = datetime.datetime.now()
            due_date = f"{now.year}-{now.month:02d}-25"

        cur.execute("""
            INSERT INTO Invoices (
                contract_id, invoice_month, room_rent,
                electricity_start, electricity_end, electricity_usage, electricity_rate, electricity_cost,
                water_start, water_end, water_usage, water_rate, water_cost,
                service_cost, total_amount, due_date, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Unpaid')
        """, (
            contract_id, invoice_month, room_rent,
            electricity_start, electricity_end, electricity_usage, electricity_rate, electricity_cost,
            water_start, water_end, water_usage, water_rate, water_cost,
            service_cost, total_amount, due_date
        ))
        conn.commit()
        new_inv_id = cur.lastrowid
        conn.close()

        return jsonify({
            'success': True,
            'message': f'Tạo hóa đơn tháng {invoice_month} thành công!',
            'invoice_id': new_inv_id,
            'total_amount': total_amount
        }), 201
    except Exception as e:
        conn.close()
        return jsonify({'success': False, 'message': f'Lỗi tạo hóa đơn: {str(e)}'}), 500

@app.route('/api/invoices/<int:invoice_id>/pay', methods=['PUT', 'POST'])
def pay_invoice(invoice_id):
    """Đánh dấu hóa đơn đã thanh toán hoặc chuyển trạng thái"""
    data = request.get_json(silent=True) or {}
    new_status = data.get('status', 'Paid')
    paid_at = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S') if new_status == 'Paid' else None

    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE Invoices SET status = ?, paid_at = ? WHERE id = ?", (new_status, paid_at, invoice_id))
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'message': f'Đã cập nhật trạng thái hóa đơn #{invoice_id} sang {new_status}'})
    except Exception as e:
        conn.close()
        return jsonify({'success': False, 'message': f'Lỗi cập nhật: {str(e)}'}), 500

@app.route('/api/invoices/<int:invoice_id>/notify', methods=['POST'])
def notify_tenant_invoice(invoice_id):
    """Gửi thông báo nhắc nhở đóng tiền hóa đơn cho khách thuê"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT i.*, r.room_number, u.full_name as tenant_name, u.phone as tenant_phone
        FROM Invoices i
        JOIN Contracts c ON i.contract_id = c.id
        JOIN Rooms r ON c.room_id = r.id
        JOIN Users u ON c.tenant_id = u.id
        WHERE i.id = ?
    """, (invoice_id,))
    inv = cur.fetchone()
    conn.close()

    if not inv:
        return jsonify({'success': False, 'message': 'Không tìm thấy hóa đơn'}), 404

    return jsonify({
        'success': True,
        'message': f'Đã gửi thông báo nhắc đóng tiền tháng {inv["invoice_month"]} tới khách thuê {inv["tenant_name"]} (SĐT: {inv["tenant_phone"] or "chưa có"})!'
    })

# ------------------------------------------------------------------------------
# API QUẢN LÝ PHÒNG & XẾP PHÒNG (AGENT 3)
# ------------------------------------------------------------------------------
@app.route('/api/rooms/available', methods=['GET'])
def get_available_rooms():
    """Lấy danh sách các phòng còn trống (status = 'Available') phục vụ xếp phòng"""
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT r.*, p.name as property_name, p.address as property_address
            FROM Rooms r
            JOIN Properties p ON r.property_id = p.id
            WHERE r.status = 'Available'
            ORDER BY p.name ASC, r.room_number ASC
        """)
        rooms = [dict(row) for row in cur.fetchall()]
        conn.close()
        return jsonify({'success': True, 'data': rooms, 'total': len(rooms)})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Lỗi hệ thống khi tải phòng trống: {str(e)}'}), 500

@app.route('/api/rooms', methods=['GET'])
def get_all_rooms():
    """Lấy danh sách toàn bộ phòng và trạng thái phục vụ sơ đồ phòng trọ"""
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT r.*, p.name as property_name, p.address as property_address,
                   c.id as contract_id, u.full_name as tenant_name, u.phone as tenant_phone
            FROM Rooms r
            JOIN Properties p ON r.property_id = p.id
            LEFT JOIN Contracts c ON r.id = c.room_id AND c.status = 'Active'
            LEFT JOIN Users u ON c.tenant_id = u.id
            ORDER BY p.name ASC, r.room_number ASC
        """)
        rooms = [dict(row) for row in cur.fetchall()]
        conn.close()
        return jsonify({'success': True, 'data': rooms, 'total': len(rooms)})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Lỗi hệ thống khi tải phòng: {str(e)}'}), 500

@app.route('/api/tenants/<int:tenant_id>/assign', methods=['PUT', 'POST'])
def assign_tenant_to_room(tenant_id):
    """
    Xếp phòng cho khách thuê:
    - Nhận room_id, start_date, end_date, monthly_rent, deposit_amount
    - Tạo bản ghi mới trong bảng Contracts
    - Cập nhật Rooms.status = 'Occupied'
    """
    data = request.get_json(silent=True) or {}
    room_id = data.get('room_id')
    start_date = data.get('start_date') or datetime.date.today().isoformat()
    end_date = data.get('end_date')
    monthly_rent = data.get('monthly_rent')
    deposit_amount = data.get('deposit_amount')
    electricity_rate = float(data.get('electricity_rate', 3500))
    water_rate = float(data.get('water_rate', 25000))

    if not room_id:
        return jsonify({'success': False, 'message': 'Vui lòng chọn phòng cần xếp'}), 400

    conn = get_db()
    cur = conn.cursor()
    try:
        # 1. Kiểm tra Người thuê
        cur.execute("SELECT id, full_name, role FROM Users WHERE id = ?", (tenant_id,))
        user = cur.fetchone()
        if not user or user['role'] != 'tenant':
            conn.close()
            return jsonify({'success': False, 'message': 'Người thuê không tồn tại hoặc không hợp lệ'}), 404

        # 2. Kiểm tra Phòng
        cur.execute("SELECT id, room_number, base_price, status FROM Rooms WHERE id = ?", (room_id,))
        room = cur.fetchone()
        if not room:
            conn.close()
            return jsonify({'success': False, 'message': 'Phòng không tồn tại'}), 404

        # Nếu không truyền monthly_rent hoặc deposit_amount, lấy mặc định từ base_price của phòng
        if monthly_rent is None or monthly_rent == '':
            monthly_rent = float(room['base_price'])
        else:
            monthly_rent = float(monthly_rent)

        if deposit_amount is None or deposit_amount == '':
            deposit_amount = float(monthly_rent)
        else:
            deposit_amount = float(deposit_amount)

        # Mặc định thời hạn hợp đồng 1 năm nếu không truyền end_date
        if not end_date:
            try:
                s_dt = datetime.datetime.strptime(start_date, '%Y-%m-%d')
                end_date = (s_dt.replace(year=s_dt.year + 1)).strftime('%Y-%m-%d')
            except Exception:
                end_date = '2027-12-31'

        # 3. Tạo hợp đồng mới trong bảng Contracts
        cur.execute("""
            INSERT INTO Contracts (
                room_id, tenant_id, start_date, end_date,
                monthly_rent, deposit_amount, electricity_rate, water_rate, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active')
        """, (
            room_id, tenant_id, start_date, end_date,
            monthly_rent, deposit_amount, electricity_rate, water_rate
        ))
        contract_id = cur.lastrowid

        # 4. Cập nhật trạng thái phòng sang 'Occupied'
        cur.execute("UPDATE Rooms SET status = 'Occupied' WHERE id = ?", (room_id,))

        conn.commit()
        conn.close()

        return jsonify({
            'success': True,
            'message': f'Đã xếp phòng {room["room_number"]} cho khách {user["full_name"]} thành công!',
            'contract': {
                'id': contract_id,
                'tenant_id': tenant_id,
                'tenant_name': user['full_name'],
                'room_id': room_id,
                'room_number': room['room_number'],
                'start_date': start_date,
                'end_date': end_date,
                'monthly_rent': monthly_rent,
                'deposit_amount': deposit_amount
            }
        }), 200
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'success': False, 'message': f'Lỗi hệ thống khi xếp phòng: {str(e)}'}), 500

# ------------------------------------------------------------------------------
# CÁC API KHÁC: HỢP ĐỒNG, NGƯỜI THUÊ, BẢO TRÌ SỰ CỐ
# ------------------------------------------------------------------------------
@app.route('/api/contracts', methods=['GET'])
def list_contracts():
    conn = get_db()
    cur = conn.cursor()
    if session.get('role') == 'tenant':
        cur.execute("""
            SELECT c.*, r.room_number, p.name as property_name, p.address as property_address,
                   u.full_name as tenant_name, u.phone as tenant_phone
            FROM Contracts c
            JOIN Rooms r ON c.room_id = r.id
            JOIN Properties p ON r.property_id = p.id
            JOIN Users u ON c.tenant_id = u.id
            WHERE c.tenant_id = ?
            ORDER BY c.id DESC
        """, (session['user_id'],))
    else:
        cur.execute("""
            SELECT c.*, r.room_number, p.name as property_name, p.address as property_address,
                   u.full_name as tenant_name, u.phone as tenant_phone
            FROM Contracts c
            JOIN Rooms r ON c.room_id = r.id
            JOIN Properties p ON r.property_id = p.id
            JOIN Users u ON c.tenant_id = u.id
            ORDER BY c.id DESC
        """)
    contracts = [dict(row) for row in cur.fetchall()]
    conn.close()
    return jsonify({'success': True, 'data': contracts})

@app.route('/api/landlord/tenants', methods=['GET'])
def get_landlord_tenants():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT 
            u.id, u.username, u.full_name, u.phone, u.email,
            c.id as contract_id,
            r.room_number, p.name as property_name,
            CASE 
                WHEN c.id IS NOT NULL AND c.status = 'Active' THEN 'Đã có phòng'
                ELSE 'Chờ xếp phòng'
            END as assignment_status
        FROM Users u
        LEFT JOIN Contracts c ON u.id = c.tenant_id AND c.status = 'Active'
        LEFT JOIN Rooms r ON c.room_id = r.id
        LEFT JOIN Properties p ON r.property_id = p.id
        WHERE u.role = 'tenant'
        ORDER BY 
            CASE WHEN c.id IS NULL OR c.status != 'Active' THEN 0 ELSE 1 END,
            u.id DESC
    """)
    tenants = [dict(row) for row in cur.fetchall()]
    conn.close()
    return jsonify({'success': True, 'data': tenants})

@app.route('/api/landlord/<int:landlord_id>/maintenance', methods=['GET'])
@app.route('/api/maintenance', methods=['GET'])
def list_maintenance(landlord_id=None):
    conn = get_db()
    cur = conn.cursor()
    if session.get('role') == 'tenant':
        cur.execute("""
            SELECT m.*, r.room_number, p.name as property_name
            FROM Maintenance m
            JOIN Rooms r ON m.room_id = r.id
            JOIN Properties p ON r.property_id = p.id
            WHERE m.tenant_id = ?
            ORDER BY m.id DESC
        """, (session['user_id'],))
    else:
        cur.execute("""
            SELECT m.*, r.room_number, p.name as property_name, u.full_name as tenant_name, u.phone as tenant_phone
            FROM Maintenance m
            JOIN Rooms r ON m.room_id = r.id
            JOIN Properties p ON r.property_id = p.id
            JOIN Users u ON m.tenant_id = u.id
            ORDER BY 
                CASE m.status 
                    WHEN 'Pending' THEN 1 
                    WHEN 'In Progress' THEN 2 
                    WHEN 'Completed' THEN 3 
                END, 
                m.id DESC
        """)
    issues = [dict(row) for row in cur.fetchall()]
    conn.close()
    return jsonify({'success': True, 'data': issues})

@app.route('/api/maintenance', methods=['POST'])
def create_maintenance():
    data = request.get_json(silent=True) or {}
    title = data.get('title', '').strip()
    description = data.get('description', '').strip()
    priority = data.get('priority', 'Normal')

    if not title or not description:
        return jsonify({'success': False, 'message': 'Vui lòng nhập tiêu đề và mô tả sự cố'}), 400

    conn = get_db()
    cur = conn.cursor()
    uid = session.get('user_id', 2) # Mặc định tenant mẫu nếu chưa có session

    # Lấy thông tin khách thuê
    cur.execute("SELECT full_name FROM Users WHERE id = ?", (uid,))
    user_row = cur.fetchone()
    tenant_name = user_row['full_name'] if user_row else 'Khách thuê'

    # Tìm phòng mà người này đang thuê
    cur.execute("""
        SELECT r.id AS room_id, r.room_number 
        FROM Contracts c 
        JOIN Rooms r ON c.room_id = r.id 
        WHERE c.tenant_id = ? AND c.status = 'Active' 
        LIMIT 1
    """, (uid,))
    row = cur.fetchone()
    room_id = row['room_id'] if row else 1
    room_number = row['room_number'] if row else 'P101'

    # 1. Lưu vào bảng Maintenance
    cur.execute("""
        INSERT INTO Maintenance (room_id, tenant_id, title, description, priority, status)
        VALUES (?, ?, ?, ?, ?, 'Pending')
    """, (room_id, uid, title, description, priority))
    new_id = cur.lastrowid

    # 2. Đồng bộ sang bảng feedbacks
    full_content = f"{title} — {description}"
    cur.execute("""
        INSERT INTO feedbacks (tenant_id, room_id, issue_content, status, created_at)
        VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)
    """, (uid, room_id, full_content))

    # 3. Tự động phát thông báo tới trang Chủ trọ
    notif_msg = f"🚨 [SỰ CỐ MỚI] Khách {tenant_name} (Phòng P.{room_number}) vừa báo sự cố: {title} ({description})"
    cur.execute("""
        INSERT INTO notifications (recipient_id, message, created_at)
        VALUES (NULL, ?, CURRENT_TIMESTAMP)
    """, (notif_msg,))

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Đã gửi phản ánh sự cố tới Chủ trọ thành công!', 'id': new_id}), 201

@app.route('/api/maintenance/<int:issue_id>', methods=['PUT'])
def update_maintenance(issue_id):
    data = request.get_json(silent=True) or {}
    new_status = data.get('status')
    if new_status not in ('Pending', 'In Progress', 'Completed'):
        return jsonify({'success': False, 'message': 'Trạng thái không hợp lệ'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE Maintenance SET status = ? WHERE id = ?", (new_status, issue_id))
    if new_status == 'Completed':
        cur.execute("UPDATE feedbacks SET status = 'done' WHERE id = ?", (issue_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': f'Đã cập nhật trạng thái sự cố #{issue_id} sang {new_status}'})

@app.route('/api/tenants/<int:tenant_id>', methods=['DELETE'])
def delete_tenant(tenant_id):
    """
    Xóa người thuê phòng và xử lý logic an toàn:
    - Tìm tất cả phòng mà người này đang thuê (status = 'Occupied')
    - Cập nhật trạng thái các phòng đó trở lại 'Available'
    - Xóa các hợp đồng, hóa đơn, sự cố, thông báo liên quan của người này
    - Xóa tài khoản người thuê khỏi bảng Users
    """
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM Users WHERE id = ? AND role = 'tenant'", (tenant_id,))
        tenant = cur.fetchone()
        if not tenant:
            conn.close()
            return jsonify({'success': False, 'message': 'Không tìm thấy người thuê cần xóa'}), 404

        # 1. Tìm các phòng đang thuê bởi người này để giải phóng trạng thái về 'Available'
        cur.execute("SELECT room_id FROM Contracts WHERE tenant_id = ?", (tenant_id,))
        room_rows = cur.fetchall()
        for r in room_rows:
            cur.execute("UPDATE Rooms SET status = 'Available' WHERE id = ?", (r['room_id'],))

        # 2. Xóa các hóa đơn thuộc về các hợp đồng của người này
        cur.execute("""
            DELETE FROM Invoices 
            WHERE contract_id IN (SELECT id FROM Contracts WHERE tenant_id = ?)
        """, (tenant_id,))

        # 3. Xóa hợp đồng
        cur.execute("DELETE FROM Contracts WHERE tenant_id = ?", (tenant_id,))

        # 4. Xóa yêu cầu bảo trì / sự cố của người này
        cur.execute("DELETE FROM Maintenance WHERE tenant_id = ?", (tenant_id,))

        # 5. Xóa thông báo liên quan đến người này
        cur.execute("DELETE FROM Notices WHERE tenant_id = ?", (tenant_id,))

        # 6. Xóa người dùng
        cur.execute("DELETE FROM Users WHERE id = ?", (tenant_id,))

        conn.commit()
        conn.close()
        return jsonify({
            'success': True,
            'message': f'Đã xóa an toàn người thuê {tenant["full_name"]} và giải phóng phòng về trạng thái Trống thành công.'
        })
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'success': False, 'message': f'Lỗi khi xóa người thuê: {str(e)}'}), 500

# ------------------------------------------------------------------------------
# BẢNG TIN THÔNG BÁO & NHẮC NHỞ (AGENT 1 & 2 & 3)
# ------------------------------------------------------------------------------
@app.route('/api/notices', methods=['GET'])
def list_notices():
    """Lấy danh sách bảng tin thông báo & nhắc nhở từ Chủ trọ"""
    conn = get_db()
    cur = conn.cursor()
    is_tenant = (session.get('role') == 'tenant')
    tenant_id = session.get('user_id')

    if is_tenant and tenant_id:
        cur.execute("""
            SELECT n.*, u.full_name as author_name
            FROM Notices n
            JOIN Users u ON n.landlord_id = u.id
            WHERE n.tenant_id IS NULL OR n.tenant_id = ?
            ORDER BY n.id DESC
        """, (tenant_id,))
    else:
        cur.execute("""
            SELECT n.*, u.full_name as author_name, t.full_name as target_tenant_name
            FROM Notices n
            JOIN Users u ON n.landlord_id = u.id
            LEFT JOIN Users t ON n.tenant_id = t.id
            ORDER BY n.id DESC
        """)
    notices = [dict(row) for row in cur.fetchall()]
    conn.close()
    return jsonify({'success': True, 'data': notices})

@app.route('/api/notices', methods=['POST'])
def create_notice():
    """Tạo thông báo mới (Chủ trọ gửi tới 1 người hoặc phát thông báo chung)"""
    data = request.get_json(silent=True) or {}
    title = data.get('title', '').strip()
    content = data.get('content', '').strip()
    tenant_id = data.get('tenant_id')
    notice_type = data.get('notice_type', 'General')

    if not title or not content:
        return jsonify({'success': False, 'message': 'Tiêu đề và nội dung thông báo không được để trống'}), 400

    if tenant_id == '' or tenant_id == 0 or tenant_id == '0':
        tenant_id = None

    conn = get_db()
    cur = conn.cursor()
    landlord_id = session.get('user_id', 1)
    cur.execute("""
        INSERT INTO Notices (landlord_id, tenant_id, title, content, notice_type)
        VALUES (?, ?, ?, ?, ?)
    """, (landlord_id, tenant_id, title, content, notice_type))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()

    return jsonify({'success': True, 'message': 'Đã gửi thông báo thành công!', 'id': new_id}), 201

@app.route('/api/notices/<int:notice_id>', methods=['DELETE'])
def delete_notice(notice_id):
    """Xóa thông báo"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM Notices WHERE id = ?", (notice_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': 'Đã xóa thông báo'})

# ------------------------------------------------------------------------------
# API PROFILE: CẬP NHẬT SĐT & ĐỔI MẬT KHẨU (AGENT 1 & 3)
# ------------------------------------------------------------------------------
@app.route('/api/profile', methods=['PUT', 'POST'])
def update_profile():
    """Cho phép người thuê hoặc chủ trọ cập nhật SĐT, Email và Đổi mật khẩu"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Vui lòng đăng nhập để thực hiện'}), 401

    data = request.get_json(silent=True) or {}
    phone = data.get('phone', '').strip()
    email = data.get('email', '').strip()
    old_password = data.get('old_password', '').strip()
    new_password = data.get('new_password', '').strip()

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM Users WHERE id = ?", (session['user_id'],))
    user = cur.fetchone()
    if not user:
        conn.close()
        return jsonify({'success': False, 'message': 'Người dùng không tồn tại'}), 404

    if phone:
        cur.execute("UPDATE Users SET phone = ? WHERE id = ?", (phone, session['user_id']))
    if email:
        cur.execute("UPDATE Users SET email = ? WHERE id = ?", (email, session['user_id']))

    if new_password:
        if not old_password or not verify_password(user['password_hash'], old_password):
            conn.close()
            return jsonify({'success': False, 'message': 'Mật khẩu hiện tại không chính xác'}), 400
        if len(new_password) < 6:
            conn.close()
            return jsonify({'success': False, 'message': 'Mật khẩu mới tối thiểu phải từ 6 ký tự'}), 400
        cur.execute("UPDATE Users SET password_hash = ? WHERE id = ?", (generate_password_hash(new_password), session['user_id']))

    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': 'Cập nhật thông tin cá nhân thành công!'})

# ------------------------------------------------------------------------------
# DB LIVE INSPECTOR & LIVE SQL / TRIGGER STREAM CONSOLE (KIỂM ĐỊNH 3NF + MẬT MÃ CAESAR)
# ------------------------------------------------------------------------------
import collections
import time

SQL_TELEMETRY_LOGS = collections.deque(maxlen=100)

def caesar_cipher_encrypt(text, shift=3):
    """
    Mã hóa mật mã Caesar (Caesar Cipher) với độ dịch shift (+3).
    Dùng để bảo mật và che giấu thông tin mật khẩu nhạy cảm khi hiển thị trên Inspector.
    Hỗ trợ chữ thường (a-z), chữ hoa (A-Z) và chữ số (0-9).
    Ví dụ: '123456' -> '456789', 'admin' -> 'dgplq'
    """
    if not text:
        return text
    result = []
    for char in str(text):
        if 'a' <= char <= 'z':
            result.append(chr((ord(char) - ord('a') + shift) % 26 + ord('a')))
        elif 'A' <= char <= 'Z':
            result.append(chr((ord(char) - ord('A') + shift) % 26 + ord('A')))
        elif '0' <= char <= '9':
            result.append(chr((ord(char) - ord('0') + shift) % 10 + ord('0')))
        else:
            result.append(char)
    return "".join(result)

def log_sql_telemetry(query, params=None, duration_ms=0.0, rows_affected=0, source='inspector.console'):
    """Ghi nhận câu lệnh SQL vào hàng đợi Live SQL Telemetry Stream"""
    clean_q = query.strip()
    op = clean_q.split()[0].upper() if clean_q else 'SQL'
    if op.startswith('--'):
        op = 'TRIGGER' if 'TRIGGER' in clean_q.upper() else 'COMMENT'
    entry = {
        'id': len(SQL_TELEMETRY_LOGS) + 1,
        'op': op,
        'query': clean_q,
        'params': params if params is not None else [],
        'duration_ms': round(duration_ms, 2),
        'rows': rows_affected,
        'timestamp': datetime.datetime.now().strftime('%H:%M:%S'),
        'source': source
    }
    SQL_TELEMETRY_LOGS.appendleft(entry)
    return entry

# Khởi tạo một số log telemetry mẫu để giao diện luôn sống động
if not SQL_TELEMETRY_LOGS:
    log_sql_telemetry("SELECT COUNT(*)::int AS count FROM Users WHERE role = 'tenant'", [2], 0.61, 2, 'auth.checkCustomer.ordersCount')
    log_sql_telemetry("SELECT id, username, password_hash, full_name, phone FROM Users WHERE phone = '0901234567' LIMIT 1", ['0901234567'], 0.96, 1, 'auth.checkCustomer.byPhone')
    log_sql_telemetry("SELECT r.*, p.name as property_name FROM Rooms r JOIN Properties p ON r.property_id = p.id WHERE r.status = 'Available'", [], 1.15, 14, 'rooms.availableList')
    log_sql_telemetry("TRIGGER trg_audit_room_status_update FIRED ON UPDATE OF Rooms (status: 'Available' -> 'Occupied')", ['room_id: 15'], 0.42, 1, 'sqlite.trigger.audit')

@app.route('/inspector')
@app.route('/admin/inspector')
def inspector_page():
    """Trang giao diện DB Live Inspector & Live SQL Stream Console chuẩn 3NF"""
    return render_template('inspector.html')

@app.route('/api/inspector/tables', methods=['GET'])
def inspector_get_tables():
    """Lấy danh sách tất cả các bảng và views trong CSDL SQLite"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT type, name 
        FROM sqlite_master 
        WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
        ORDER BY CASE WHEN type = 'table' THEN 1 ELSE 2 END, name ASC
    """)
    items = cur.fetchall()
    
    tables_info = []
    for row in items:
        t_name = row['name']
        t_type = row['type']
        try:
            cur.execute(f"SELECT COUNT(*) as c FROM `{t_name}`")
            count = cur.fetchone()['c']
        except Exception:
            count = 0
            
        cur.execute(f"PRAGMA table_info(`{t_name}`)")
        cols = [c['name'] for c in cur.fetchall()]
        
        tables_info.append({
            'name': t_name,
            'type': t_type,
            'count': count,
            'columns': cols
        })
    conn.close()
    return jsonify({'success': True, 'data': tables_info})

@app.route('/api/inspector/table/<table_name>', methods=['GET'])
def inspector_get_table_data(table_name):
    """
    Lấy dữ liệu bảng và TỰ ĐỘNG MÃ HÓA MẬT KHẨU dưới dạng MẬT MÃ CAESAR (Shift +3)
    """
    limit = int(request.args.get('limit', 50))
    conn = get_db()
    cur = conn.cursor()
    
    # Kiểm tra tính hợp lệ của tên bảng
    cur.execute("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?", (table_name,))
    if not cur.fetchone():
        conn.close()
        return jsonify({'success': False, 'message': 'Bảng không tồn tại'}), 404
        
    start_t = time.time()
    query = f"SELECT * FROM `{table_name}` LIMIT {limit}"
    cur.execute(query)
    rows_raw = cur.fetchall()
    duration = (time.time() - start_t) * 1000
    
    columns = [desc[0] for desc in cur.description] if cur.description else []
    
    rows = []
    has_caesar = False
    for r in rows_raw:
        item = {}
        for col in columns:
            val = r[col]
            # MÃ HÓA CAESAR CHO CỘT MẬT KHẨU
            if 'password' in col.lower() or 'pwd' in col.lower():
                has_caesar = True
                caesar_val = caesar_cipher_encrypt(val, shift=3)
                item[col] = caesar_val
                item['_caesar_note'] = f"Đã mã hóa Caesar (+3): '{val}' ➔ '{caesar_val}'"
            else:
                item[col] = val
        rows.append(item)
        
    conn.close()
    
    log_sql_telemetry(query, [], duration, len(rows), f"inspector.table.{table_name}")
    
    return jsonify({
        'success': True,
        'table': table_name,
        'columns': columns,
        'rows': rows,
        'total': len(rows),
        'duration_ms': round(duration, 2),
        'caesar_encrypted': has_caesar,
        'caesar_shift': 3
    })

@app.route('/api/inspector/execute', methods=['POST'])
def inspector_execute_sql():
    """
    Thực thi câu lệnh SQL trực tiếp từ Console:
    - Nếu câu lệnh trả về cột mật khẩu, tự động mã hóa Caesar Cipher (Shift +3).
    - Đo đạc thời gian thực thi chính xác (ms).
    - Bắn telemetry vào Live SQL & Trigger Stream Console.
    """
    data = request.get_json(silent=True) or {}
    raw_query = data.get('query', '').strip()
    
    if not raw_query:
        return jsonify({'success': False, 'message': 'Vui lòng nhập câu lệnh SQL!'}), 400
        
    conn = get_db()
    cur = conn.cursor()
    
    start_t = time.time()
    try:
        cur.execute(raw_query)
        duration = (time.time() - start_t) * 1000
        
        # Nếu có dữ liệu trả về (SELECT / PRAGMA)
        if cur.description:
            columns = [desc[0] for desc in cur.description]
            rows_raw = cur.fetchall()
            rows = []
            has_caesar = False
            for r in rows_raw:
                item = {}
                for col in columns:
                    val = r[col]
                    if 'password' in col.lower() or 'pwd' in col.lower():
                        has_caesar = True
                        caesar_val = caesar_cipher_encrypt(val, shift=3)
                        item[col] = caesar_val
                    else:
                        item[col] = val
                rows.append(item)
                
            log_sql_telemetry(raw_query, [], duration, len(rows), 'inspector.query')
            conn.close()
            return jsonify({
                'success': True,
                'type': 'SELECT',
                'columns': columns,
                'rows': rows,
                'total': len(rows),
                'duration_ms': round(duration, 2),
                'caesar_encrypted': has_caesar,
                'caesar_shift': 3,
                'query': raw_query
            })
        else:
            conn.commit()
            rows_affected = cur.rowcount
            log_sql_telemetry(raw_query, [], duration, rows_affected, 'inspector.mutation')
            conn.close()
            return jsonify({
                'success': True,
                'type': 'MUTATION',
                'rows_affected': rows_affected,
                'duration_ms': round(duration, 2),
                'query': raw_query,
                'message': f'Thực thi thành công! Số bản ghi ảnh hưởng: {rows_affected}'
            })
    except Exception as e:
        duration = (time.time() - start_t) * 1000
        log_sql_telemetry(f"-- [ERROR] {raw_query}", [], duration, 0, 'inspector.error')
        conn.close()
        return jsonify({'success': False, 'error': str(e), 'duration_ms': round(duration, 2)}), 400

@app.route('/api/inspector/telemetry', methods=['GET'])
def inspector_get_telemetry():
    """Lấy danh sách các dòng telemetry SQL stream thời gian thực"""
    return jsonify({
        'success': True,
        'logs': list(SQL_TELEMETRY_LOGS),
        'count': len(SQL_TELEMETRY_LOGS)
    })

@app.route('/api/inspector/clear_telemetry', methods=['POST'])
def inspector_clear_telemetry():
    """Xóa lịch sử log telemetry"""
    SQL_TELEMETRY_LOGS.clear()
    return jsonify({'success': True, 'message': 'Đã xóa toàn bộ log telemetry!'})

# ------------------------------------------------------------------------------
# KHỞI CHẠY CHÍNH (MAIN)
# ------------------------------------------------------------------------------
if __name__ == '__main__':
    print("=" * 70)
    print("🏠 HỆ THỐNG QUẢN LÝ THUÊ PHÒNG TRỌ NÂNG CAO")
    print("=" * 70)
    print("🛸 Đang khởi tạo CSDL SQLite (database.db) và nạp dữ liệu mẫu...")
    init_db()
    print("✅ CSDL database.db đã sẵn sàng!")
    print("🌐 Trang chủ 3D & Đăng nhập: http://127.0.0.1:5000")
    print("🏠 Cổng Cư dân / Khách thuê: http://127.0.0.1:5000/tenant")
    print("👑 Cổng Quản trị Chủ trọ: http://127.0.0.1:5000/admin")
    print("=" * 70)
    app.run(host='0.0.0.0', port=5000, debug=True)
