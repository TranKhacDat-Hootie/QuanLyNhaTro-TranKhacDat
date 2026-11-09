# 🏠 ỨNG DỤNG QUẢN LÝ THUÊ PHÒNG TRỌ NÂNG CAO (QuanLyNhaTro) - SQL SERVER EDITION
> **Kiến trúc:** Multi-Agent Framework (Orchestrator + 3 Specialized Agents)  
> **Hệ quản trị CSDL:** Microsoft SQL Server (T-SQL, Identity, Constraints, pyodbc)  
> **Backend & Frontend:** Python (Flask), HTML5, CSS3, JavaScript thuần (Dynamic Data Renderer) & VietQR Payment.

---

## 👥 PHÂN CÔNG ĐIỀU PHỐI ĐA TÁC NHÂN (MULTI-AGENT ARCHITECTURE)

Hệ thống được chuyển đổi và vận hành song song bởi 3 Agent chuyên biệt:

| Tác nhân (Agent) | Vai trò | Tệp tin đảm nhiệm | Nhiệm vụ hoàn thành |
| :--- | :--- | :--- | :--- |
| **Agent 1** | Kiến trúc sư CSDL & Backend Developer | `schema.sql`<br>`app.py` | • Thiết kế lược đồ CSDL chuẩn mực T-SQL cho **Microsoft SQL Server** (khóa chính `INT IDENTITY(1,1)`, `NVARCHAR`, `DECIMAL(18,2)`, chống lỗi cycle cascade paths 1785).<br>• Viết lại backend Flask sử dụng `pyodbc`, hỗ trợ cả Windows Authentication và SQL Server Authentication.<br>• Chuyển đổi truy vấn sang cú pháp SQL Server (`DATEDIFF`, `OUTPUT INSERTED.id`, `SELECT TOP 1`). |
| **Agent 2** | Kỹ sư Frontend & UI/UX | `index.html`<br>`style.css`<br>`script.js` | • Đảm bảo giao diện và các luồng chức năng (Đăng nhập, Đăng ký, Cảnh báo đỏ, Doanh thu đa cơ sở, Quản lý nội thất, Báo cáo sự cố, VietQR) tương thích mượt mà 100% với backend SQL Server.<br>• Giữ nguyên cơ chế render dữ liệu động Dynamic Data Renderer và bảo vệ giao diện trước sự cố mạng. |
| **Agent 3** | Kỹ sư Hướng dẫn & Tích hợp CSDL | `README.md`<br>`requirements.txt` | • Cung cấp hướng dẫn chi tiết từng bước bằng tiếng Việt cấu hình Microsoft SQL Server, SSMS, cài đặt thư viện `pyodbc`.<br>• Hướng dẫn kiểm tra và cấu hình chuỗi kết nối (`SQL_SERVER_CONFIG`) trong `app.py`. |

---

## 🗄️ CẤU TRÚC LƯỢC ĐỒ CƠ SỞ DỮ LIỆU MICROSOFT SQL SERVER

Hệ thống gồm 7 bảng quan hệ chuẩn hóa:
1. `Users`: Quản lý tài khoản và phân quyền (`role`: `'landlord'`, `'tenant'`).
2. `Properties`: Hỗ trợ quản lý mở rộng đa cơ sở (Multi-property Scaling), lưu cấu hình tài khoản ngân hàng để sinh VietQR.
3. `Rooms`: Quản lý phòng trọ theo từng cơ sở, giá thuê và trạng thái (`Available`, `Occupied`, `Maintenance`).
4. `Inventory`: Quản lý danh mục tài sản/nội thất bàn giao, theo dõi tình trạng lúc Check-in và Check-out.
5. `Contracts`: Hợp đồng thuê phòng, thời hạn bắt đầu/kết thúc để tính toán cảnh báo sắp hết hạn (15-30 ngày).
6. `Invoices`: Hóa đơn định kỳ, tính toán số điện, nước, dịch vụ và trạng thái thanh toán (`Unpaid`, `Paid`, `Overdue`).
7. `Maintenance`: Tiếp nhận và xử lý sự cố kỹ thuật từ người thuê (`Pending` ➔ `In Progress` ➔ `Completed`).

---

## 🛠️ HƯỚNG DẪN CẤU HÌNH VÀ KHỞI CHẠY VỚI SQL SERVER

### Bước 1: Tạo Cơ sở dữ liệu trong SQL Server Management Studio (SSMS)
1. Mở **SQL Server Management Studio (SSMS)** và đăng nhập vào SQL Server của máy bạn.
2. Mở cửa sổ **New Query** và thực thi câu lệnh tạo database:
   ```sql
   CREATE DATABASE QuanLyPhongTro;
   ```
3. (Tùy chọn) Mở tệp `schema.sql` trong SSMS và bấm **Execute (F5)** để khởi tạo trước các bảng.  
   *(Nếu bạn không chạy thủ công, file `app.py` sẽ tự động đọc `schema.sql` và tạo bảng + nạp dữ liệu mẫu khi khởi động)*.

### Bước 2: Cài đặt thư viện Python cần thiết
Mở Terminal / PowerShell và chạy lệnh:
```bash
cd d:\QuanLyPhongTro\QuanLyNhaTro
pip install -r requirements.txt
```
*(Trong đó bao gồm: `Flask`, `Werkzeug`, `Flask-Cors`, và `pyodbc`)*.

### Bước 3: Cấu hình chuỗi kết nối trong `app.py`
Mở file `app.py` và kiểm tra mục `SQL_SERVER_CONFIG` ở phần đầu file:
```python
SQL_SERVER_CONFIG = {
    'driver': 'ODBC Driver 17 for SQL Server',
    'server': 'localhost\\SQLEXPRESS',  # Hoặc 'localhost', '.', hoặc 'TÊN_MÁY\\SQLEXPRESS'
    'database': 'QuanLyPhongTro',
    'use_windows_auth': True,           # True: Dùng Windows Authentication
    'uid': 'sa',                        # Dùng nếu use_windows_auth = False
    'pwd': '123456',
}
```
*💡 **Mẹo tìm tên Server:** Trong SSMS khi đăng nhập, dòng "Server name" chính là giá trị cần điền vào mục `'server'`.*

### Bước 4: Khởi chạy ứng dụng
```bash
python app.py
```
Khi thấy thông báo:
```
======================================================================
🏢 HỆ THỐNG QUẢN LÝ THUÊ PHÒNG TRỌ NÂNG CAO (SQL SERVER EDITION)
======================================================================
🛸 Đang kiểm tra cấu trúc bảng trên Microsoft SQL Server...
🌱 Bảng Users đang trống, tiến hành nạp dữ liệu mẫu (Seed Data)...
✅ Đã nạp thành công bộ dữ liệu mẫu vào SQL Server!
🚀 Khởi chạy máy chủ tại: http://127.0.0.1:5000
======================================================================
```
Bạn đã hoàn tất kết nối SQL Server thành công!

### Bước 5: Truy cập ứng dụng trên trình duyệt
Mở trình duyệt truy cập:
```
http://127.0.0.1:5000
```
Bạn có thể dùng ngay các nút **1-Click Demo** (`Chủ trọ`, `Khách A`, `Khách B`) để trải nghiệm toàn bộ hệ thống!
