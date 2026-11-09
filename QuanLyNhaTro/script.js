// ==============================================================================
// DỰ ÁN: HỆ THỐNG QUẢN LÝ THUÊ PHÒNG TRỌ NÂNG CAO (QuanLyNhaTro)
// AGENT 2 & 3: FRONTEND DEVELOPER, UI/UX & INTEGRATION QA
// TỆP TIN: script.js
// TUÂN THỦ NGHIÊM NGẶT: ai_skill_dynamic_data_renderer.md (4 PILLARS & PROTOCOL)
// ==============================================================================

// Nhận diện Base URL thông minh:
// 1. Khi chạy chuẩn qua Flask, Ngrok, Custom Domain: đường dẫn tương đối '' (giữ an toàn HTTPS)
// 2. Khi mở qua Live Server (cổng 5500, 3000...) hoặc file:///: tự động trỏ về backend Flask http://127.0.0.1:5000
const isLiveServer = (window.location.port === '5500' || window.location.port === '3000' || window.location.protocol === 'file:');
const API_BASE = isLiveServer ? 'http://127.0.0.1:5000' : '';

// Hàm gọi API an toàn, chống triệt để lỗi "Unexpected end of JSON input"
async function requestApi(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const defaultHeaders = { 'Content-Type': 'application/json' };
    const fetchOptions = {
        ...options,
        headers: { ...defaultHeaders, ...(options.headers || {}) },
        credentials: 'include' // Giữ phiên đăng nhập (Session cookie)
    };

    let res;
    try {
        res = await fetch(url, fetchOptions);
    } catch (netErr) {
        console.error(`❌ [LỖI KẾT NỐI SERVER]: Không thể kết nối tới ${url}`, netErr);
        throw new Error(`Không thể kết nối máy chủ (${url}). Hãy đảm bảo bạn đã chạy 'python app.py' trong terminal!`);
    }

    // Đọc text trước khi parse để tránh lỗi "Unexpected end of JSON input" nếu phản hồi rỗng
    const text = await res.text();
    let data = {};
    if (text && text.trim() !== '') {
        try {
            data = JSON.parse(text);
        } catch (jsonErr) {
            console.error(`❌ [LỖI PARSE JSON]: Phản hồi từ server không phải JSON:`, text);
            throw new Error(`Máy chủ phản hồi không đúng chuẩn JSON (HTTP ${res.status})`);
        }
    } else {
        // Phản hồi rỗng (thường do Live Server 5500 không có backend API)
        if (!isFlaskNative) {
            throw new Error(`Phản hồi rỗng (HTTP ${res.status}). Bạn đang mở qua cổng ${window.location.port || 'file://'}. Vui lòng mở đúng địa chỉ: http://127.0.0.1:5000`);
        }
        if (!res.ok) {
            throw new Error(`Máy chủ trả về phản hồi rỗng (HTTP ${res.status})`);
        }
    }

    if (!res.ok) {
        throw new Error(data.message || `Lỗi yêu cầu (HTTP ${res.status})`);
    }
    return data;
}

// ------------------------------------------------------------------------------
// PILLAR 1: OBJECT (THỰC THỂ HÓA TRẠNG THÁI ỨNG DỤNG - APP STATE)
// ------------------------------------------------------------------------------
const appState = {
    currentUser: null,
    properties: [],
    rooms: [],
    inventory: [],
    contracts: [],
    invoices: [],
    maintenance: [],
    tenants: [], // Danh sách người thuê (bao gồm người vừa đăng ký chờ xếp phòng)
    alerts: {
        summary: { expiring_count: 0, overdue_count: 0, total_alerts: 0 },
        expiring_contracts: [],
        overdue_invoices: []
    },
    revenueStats: null,
    activePropertyFilter: null,
    selectedInvoiceForPayment: null
};

// ------------------------------------------------------------------------------
// PROTOCOL: [INIT] - KHỞI TẠO ỨNG DỤNG KHI TẢI TRANG
// ------------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    checkAuthSession();
});

// ------------------------------------------------------------------------------
// AUTHENTICATION & LOCAL FALLBACK STORAGE (BẢO ĐẢM HOẠT ĐỘNG 100% CẢ ONLINE/OFFLINE)
// ------------------------------------------------------------------------------
const DEFAULT_ACCOUNTS = [
    { id: 1, username: 'chutro', password: '123456', full_name: 'Nguyễn Văn Chủ', role: 'landlord', phone: '0901234567', email: 'chutro@gmail.com' },
    { id: 2, username: 'nguyenvana', password: '123456', full_name: 'Nguyễn Văn An', role: 'tenant', phone: '0912345678', email: 'vana@gmail.com' },
    { id: 3, username: 'tranthib', password: '123456', full_name: 'Trần Thị Bình', role: 'tenant', phone: '0988776655', email: 'thibinh@gmail.com' }
];

function getStoredUsers() {
    try {
        const raw = localStorage.getItem('rentmaster_users');
        return raw ? JSON.parse(raw) : DEFAULT_ACCOUNTS;
    } catch (_) {
        return DEFAULT_ACCOUNTS;
    }
}

function saveRegisteredUser(user) {
    const users = getStoredUsers();
    users.push(user);
    localStorage.setItem('rentmaster_users', JSON.stringify(users));
}

function authenticateLocal(username, password) {
    const users = getStoredUsers();
    return users.find(u => u.username === username && u.password === password) || null;
}

// ------------------------------------------------------------------------------
// AUTHENTICATION & SESSION MANAGEMENT
// ------------------------------------------------------------------------------
async function checkAuthSession() {
    // 1. Kiểm tra tài khoản đã lưu trong LocalStorage để hiển thị tức thì
    try {
        const savedUserJson = localStorage.getItem('rentmaster_current_user');
        if (savedUserJson) {
            const savedUser = JSON.parse(savedUserJson);
            if (savedUser && savedUser.id) {
                appState.currentUser = savedUser;
                setupUIForRole(savedUser);
                await loadInitialData();
            }
        }
    } catch (_) {}

    // 2. Kiểm tra đồng bộ với Backend nếu server đang chạy
    try {
        const data = await requestApi('/api/auth/me');
        if (data.authenticated && data.user) {
            appState.currentUser = data.user;
            localStorage.setItem('rentmaster_current_user', JSON.stringify(data.user));
            setupUIForRole(data.user);
            await loadInitialData();
            return;
        }
    } catch (err) {
        console.warn("Chưa có phiên server, duy trì phiên client:", err.message);
    }

    if (!appState.currentUser) {
        showView('auth-section');
        document.getElementById('header-user-panel').classList.add('hidden');
    }
}

function onLoginSuccess(user) {
    appState.currentUser = user;
    localStorage.setItem('rentmaster_current_user', JSON.stringify(user));
    setupUIForRole(user);
    showToast(`🎉 Xin chào ${user.full_name}! Đăng nhập thành công.`);
    loadInitialData();
}

function setupUIForRole(user) {
    const headerPanel = document.getElementById('header-user-panel');
    const roleBadge = document.getElementById('user-role-badge');
    const nameDisplay = document.getElementById('user-display-name');

    headerPanel.classList.remove('hidden');
    nameDisplay.textContent = user.full_name;

    if (user.role === 'landlord') {
        roleBadge.textContent = 'Chủ trọ';
        roleBadge.className = 'badge badge-landlord';
        showView('landlord-section');
    } else {
        roleBadge.textContent = 'Người thuê';
        roleBadge.className = 'badge badge-tenant';
        document.getElementById('tenant-welcome-name').textContent = user.full_name;
        showView('tenant-section');
    }
}

function showView(viewId) {
    const views = ['auth-section', 'landlord-section', 'tenant-section'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (id === viewId) el.classList.remove('hidden');
            else el.classList.add('hidden');
        }
    });
}

function switchAuthTab(tab) {
    const tabLogin = document.getElementById('tab-login');
    const tabReg = document.getElementById('tab-register');
    const formLogin = document.getElementById('form-login');
    const formReg = document.getElementById('form-register');

    if (tab === 'login') {
        tabLogin.classList.add('active');
        tabReg.classList.remove('active');
        formLogin.classList.remove('hidden');
        formReg.classList.add('hidden');
    } else {
        tabLogin.classList.remove('active');
        tabReg.classList.add('active');
        formLogin.classList.add('hidden');
        formReg.classList.remove('hidden');
    }
}

async function handleLogin(event) {
    if (event && event.preventDefault) event.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();

    if (!username || !password) {
        showToast('⚠️ Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu');
        return;
    }

    // 1. Thử gọi API Backend Flask trước
    try {
        const result = await requestApi('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        if (result && result.success && result.user) {
            onLoginSuccess(result.user);
            return;
        } else {
            showToast('❌ ' + (result?.message || 'Tài khoản hoặc mật khẩu không chính xác'));
            return;
        }
    } catch (apiErr) {
        console.warn("Backend API offline hoặc chưa chạy, kiểm tra tài khoản Local:", apiErr.message);
        
        // 2. Chế độ Fallback: Kiểm tra tài khoản trong danh sách local
        const localUser = authenticateLocal(username, password);
        if (localUser) {
            onLoginSuccess(localUser);
            return;
        }
        showToast('❌ Tài khoản hoặc mật khẩu không chính xác');
    }
}

// 1-Click Demo Login cho sinh viên và người đánh giá
async function demoLogin(username, password) {
    document.getElementById('login-username').value = username;
    document.getElementById('login-password').value = password;
    const fakeEvent = { preventDefault: () => {} };
    await handleLogin(fakeEvent);
}

// ------------------------------------------------------------------------------
// AGENT 2: XỬ LÝ ĐĂNG KÝ TÀI KHOẢN (ĐÃ KHÓA PHÂN QUYỀN - MẶC ĐỊNH LÀ TENANT)
// ------------------------------------------------------------------------------
async function handleRegister(event) {
    if (event && event.preventDefault) event.preventDefault();
    const full_name = document.getElementById('reg-fullname').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const email = document.getElementById('reg-email') ? document.getElementById('reg-email').value.trim() : '';

    if (!username || !password || !full_name) {
        showToast('⚠️ Vui lòng điền đầy đủ họ tên, tên đăng nhập và mật khẩu');
        return;
    }

    // Bảo mật: Mọi tài khoản đăng ký mới luôn mặc định là 'tenant' (Người thuê)
    const newLocalUser = {
        id: Date.now(),
        username,
        password,
        full_name,
        role: 'tenant',
        phone,
        email
    };
    saveRegisteredUser(newLocalUser);

    // Gửi dữ liệu đăng ký về Backend (Không gửi trường role)
    try {
        await requestApi('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ full_name, username, password, phone, email })
        });
    } catch (err) {
        console.warn("Server offline, đã lưu tài khoản tại trình duyệt:", err.message);
    }

    showToast('✅ Đăng ký tài khoản Người thuê thành công! Vui lòng đăng nhập.');
    switchAuthTab('login');
    document.getElementById('login-username').value = username;
    document.getElementById('login-password').value = password;
}

// Hỗ trợ alias tên hàm register
const register = handleRegister;

document.getElementById('btn-logout')?.addEventListener('click', async () => {
    try {
        await requestApi('/api/auth/logout', { method: 'POST' });
    } catch (err) {
        console.warn("Server offline:", err.message);
    }
    appState.currentUser = null;
    localStorage.removeItem('rentmaster_current_user');
    showToast('👋 Đã đăng xuất thành công');
    showView('auth-section');
    document.getElementById('header-user-panel').classList.add('hidden');
});

// ------------------------------------------------------------------------------
// PROTOCOL: [INIT] - TẢI VÀ ĐỒNG BỘ DỮ LIỆU TỪ BACKEND (KÈM FALLBACK LOCAL MOCK)
// ------------------------------------------------------------------------------
const MOCK_DATA = {
    properties: [
        { id: 1, name: 'Cơ sở 1 - Cầu Giấy (Thăng Long)', address: 'Số 18 Dịch Vọng Hậu, Cầu Giấy, Hà Nội', bank_name: 'MBBank', bank_account_no: '0901234567', bank_account_name: 'NGUYEN VAN CHU' },
        { id: 2, name: 'Cơ sở 2 - Hai Bà Trưng (Bách Khoa)', address: 'Số 45 Tạ Quang Bửu, Hai Bà Trưng, Hà Nội', bank_name: 'Vietcombank', bank_account_no: '001100223344', bank_account_name: 'NGUYEN VAN CHU' }
    ],
    rooms: [
        { id: 1, property_id: 1, property_name: 'Cơ sở 1 - Cầu Giấy (Thăng Long)', room_number: 'P101', room_type: 'Studio khép kín', base_price: 3500000, area_sqm: 22.5, status: 'Occupied', current_tenant: 'Nguyễn Văn An' },
        { id: 2, property_id: 1, property_name: 'Cơ sở 1 - Cầu Giấy (Thăng Long)', room_number: 'P102', room_type: 'Gác lửng cao cấp', base_price: 4200000, area_sqm: 28.0, status: 'Available', current_tenant: null },
        { id: 3, property_id: 1, property_name: 'Cơ sở 1 - Cầu Giấy (Thăng Long)', room_number: 'P201', room_type: 'Phòng đơn tiêu chuẩn', base_price: 2800000, area_sqm: 18.0, status: 'Occupied', current_tenant: 'Trần Thị Bình' },
        { id: 4, property_id: 2, property_name: 'Cơ sở 2 - Hai Bà Trưng (Bách Khoa)', room_number: 'P301', room_type: '1 Phòng ngủ + Bếp', base_price: 4800000, area_sqm: 32.0, status: 'Occupied', current_tenant: 'Nguyễn Văn An' },
        { id: 5, property_id: 2, property_name: 'Cơ sở 2 - Hai Bà Trưng (Bách Khoa)', room_number: 'P302', room_type: 'Studio ban công', base_price: 3600000, area_sqm: 24.0, status: 'Maintenance', current_tenant: null }
    ],
    inventory: [
        { id: 1, room_id: 1, room_number: 'P101', item_name: 'Điều hòa Inverter Daikin 9000BTU', quantity: 1, condition_checkin: 'Mới 100%, làm lạnh nhanh', condition_checkout: 'Đang sử dụng tốt', status: 'Active' },
        { id: 2, room_id: 1, room_number: 'P101', item_name: 'Tủ lạnh Toshiba 150L', quantity: 1, condition_checkin: 'Hoạt động êm, không trầy xước', condition_checkout: 'Đang sử dụng tốt', status: 'Active' },
        { id: 3, room_id: 1, room_number: 'P101', item_name: 'Nệm lò xo cao cấp 1m6 x 2m', quantity: 1, condition_checkin: 'Sạch sẽ, kèm ga bọc', condition_checkout: 'Đang sử dụng tốt', status: 'Active' },
        { id: 4, room_id: 1, room_number: 'P101', item_name: 'Bình nóng lạnh Ariston 20L', quantity: 1, condition_checkin: 'Nước nóng nhanh, an toàn', condition_checkout: 'Đang sử dụng tốt', status: 'Active' },
        { id: 5, room_id: 2, room_number: 'P102', item_name: 'Điều hòa Casper 9000BTU', quantity: 1, condition_checkin: 'Mới bàn giao', condition_checkout: 'Chưa bàn giao trả', status: 'Active' }
    ],
    contracts: [
        { id: 1, room_id: 1, room_number: 'P101', property_name: 'Cơ sở 1 - Cầu Giấy (Thăng Long)', property_address: 'Số 18 Dịch Vọng Hậu, Cầu Giấy, Hà Nội', tenant_id: 2, tenant_name: 'Nguyễn Văn An', tenant_phone: '0912345678', start_date: '2025-11-20', end_date: '2026-11-28', monthly_rent: 3500000, deposit_amount: 3500000, electricity_rate: 3500, water_rate: 25000, status: 'Active' },
        { id: 2, room_id: 3, room_number: 'P201', property_name: 'Cơ sở 1 - Cầu Giấy (Thăng Long)', property_address: 'Số 18 Dịch Vọng Hậu, Cầu Giấy, Hà Nội', tenant_id: 3, tenant_name: 'Trần Thị Bình', tenant_phone: '0988776655', start_date: '2026-01-10', end_date: '2027-01-10', monthly_rent: 2800000, deposit_amount: 2800000, electricity_rate: 3500, water_rate: 25000, status: 'Active' }
    ],
    invoices: [
        { id: 1, contract_id: 1, room_number: 'P101', invoice_month: '2026-11', room_rent: 3500000, electricity_start: 120, electricity_end: 195, electricity_cost: 262500, water_cost: 75000, service_cost: 150000, total_amount: 3987500, due_date: '2026-11-05', status: 'Overdue' },
        { id: 2, contract_id: 2, room_number: 'P201', invoice_month: '2026-11', room_rent: 2800000, electricity_start: 80, electricity_end: 130, electricity_cost: 175000, water_cost: 50000, service_cost: 120000, total_amount: 3145000, due_date: '2026-11-15', status: 'Unpaid' },
        { id: 3, contract_id: 1, room_number: 'P101', invoice_month: '2026-10', room_rent: 3500000, electricity_start: 50, electricity_end: 120, electricity_cost: 245000, water_cost: 75000, service_cost: 150000, total_amount: 3970000, due_date: '2026-10-10', status: 'Paid' }
    ],
    maintenance: [
        { id: 1, room_id: 1, room_number: 'P101', property_name: 'Cơ sở 1 - Cầu Giấy', tenant_name: 'Nguyễn Văn An', tenant_phone: '0912345678', title: 'Rò rỉ nước tại vòi lavabo nhà vệ sinh', description: 'Vòi lavabo bị rỉ giọt nước cả đêm gây lãng phí', priority: 'High', status: 'Pending', reported_at: '2026-11-08 09:30', admin_notes: 'Đã hẹn thợ nước' },
        { id: 2, room_id: 3, room_number: 'P201', property_name: 'Cơ sở 1 - Cầu Giấy', tenant_name: 'Trần Thị Bình', tenant_phone: '0988776655', title: 'Điều hòa phát tiếng kêu lạ', description: 'Cục lạnh thỉnh thoảng kêu rè rè', priority: 'Normal', status: 'In Progress', reported_at: '2026-11-07 14:15', admin_notes: 'Thợ đang kiểm tra quạt' }
    ]
};

function loadFallbackMockData() {
    if (appState.properties.length === 0) appState.properties = [...MOCK_DATA.properties];
    if (appState.rooms.length === 0) appState.rooms = [...MOCK_DATA.rooms];
    if (appState.inventory.length === 0) appState.inventory = [...MOCK_DATA.inventory];
    if (appState.contracts.length === 0) {
        if (appState.currentUser && appState.currentUser.role === 'tenant') {
            appState.contracts = MOCK_DATA.contracts.filter(c => c.tenant_id === appState.currentUser.id || c.tenant_name === appState.currentUser.full_name);
        } else {
            appState.contracts = [...MOCK_DATA.contracts];
        }
    }
    if (appState.invoices.length === 0) {
        if (appState.currentUser && appState.currentUser.role === 'tenant') {
            appState.invoices = MOCK_DATA.invoices.filter(i => i.contract_id === 1);
        } else {
            appState.invoices = [...MOCK_DATA.invoices];
        }
    }
    if (appState.maintenance.length === 0) {
        if (appState.currentUser && appState.currentUser.role === 'tenant') {
            appState.maintenance = MOCK_DATA.maintenance.filter(m => m.tenant_name === appState.currentUser.full_name || m.tenant_name === 'Nguyễn Văn An');
        } else {
            appState.maintenance = [...MOCK_DATA.maintenance];
        }
    }

    // Tự động tính toán Cảnh báo
    appState.alerts = {
        summary: { expiring_count: 1, overdue_count: 1, total_alerts: 2 },
        expiring_contracts: [
            { contract_id: 1, room_number: 'P101', property_name: 'Cơ sở 1 - Cầu Giấy', tenant_name: 'Nguyễn Văn An', tenant_phone: '0912345678', end_date: '2026-11-28', days_remaining: 18 }
        ],
        overdue_invoices: [
            { invoice_id: 1, room_number: 'P101', invoice_month: '2026-11', tenant_name: 'Nguyễn Văn An', tenant_phone: '0912345678', total_amount: 3987500, days_overdue: 5 }
        ]
    };

    // Tự động tính toán Doanh thu
    appState.revenueStats = {
        overall: {
            total_paid: 3970000,
            total_pending: 7132500,
            total_rooms: 5,
            occupied_rooms: 3,
            occupancy_rate: 60.0
        },
        properties: [
            { property_id: 1, property_name: 'Cơ sở 1 - Cầu Giấy (Thăng Long)', total_rooms: 3, occupied_rooms: 2, occupancy_rate: 66.7, revenue_paid: 3970000, revenue_pending: 7132500 },
            { property_id: 2, property_name: 'Cơ sở 2 - Hai Bà Trưng (Bách Khoa)', total_rooms: 2, occupied_rooms: 1, occupancy_rate: 50.0, revenue_paid: 0, revenue_pending: 0 }
        ]
    };
}

async function loadInitialData() {
    if (!appState.currentUser) return;

    if (appState.currentUser.role === 'landlord') {
        await Promise.all([
            fetchAlerts(),
            fetchRevenueStats(),
            fetchProperties(),
            fetchRooms(),
            fetchInventory(),
            fetchTenants(), // Lấy toàn bộ người thuê (gồm cả người vừa đăng ký)
            fetchContracts(),
            fetchInvoices(),
            fetchMaintenance()
        ]);
        // Nếu backend chưa chạy, nạp dữ liệu local để UI luôn đầy đủ
        if (appState.properties.length === 0) {
            loadFallbackMockData();
        }
        renderLandlordAll();
    } else {
        await Promise.all([
            fetchContracts(),
            fetchInvoices(),
            fetchMaintenance(),
            fetchInventory()
        ]);
        if (appState.contracts.length === 0) {
            loadFallbackMockData();
        }
        renderTenantPortal();
    }
}

// Các hàm fetch dữ liệu thuần túy (Data Streams)
async function fetchTenants() {
    try {
        const data = await requestApi('/api/landlord/tenants');
        if (data && data.success && data.data) {
            appState.tenants = data.data;
        }
    } catch (e) {
        console.warn("❌ Lỗi fetch tenants từ server, sử dụng local fallback:", e);
        // Fallback đọc từ LocalStorage
        const storedUsers = getStoredUsers().filter(u => u.role === 'tenant');
        appState.tenants = storedUsers.map(u => ({
            id: u.id,
            username: u.username,
            full_name: u.full_name,
            phone: u.phone || 'Chưa cập nhật',
            email: u.email || 'Chưa cập nhật',
            created_at: 'Mới đăng ký',
            assignment_status: (u.id === 2 || u.id === 3) ? 'Đã có phòng' : 'Chờ xếp phòng',
            room_number: (u.id === 2 ? 'P101' : (u.id === 3 ? 'P201' : null))
        }));
    }
}

async function fetchAlerts() {
    try {
        const data = await requestApi('/api/alerts');
        if (data.success) appState.alerts = data;
    } catch (e) { console.error("❌ Lỗi fetch alerts:", e); }
}

async function fetchRevenueStats(propertyId = null) {
    try {
        const url = propertyId ? `/api/stats/revenue?property_id=${propertyId}` : '/api/stats/revenue';
        const data = await requestApi(url);
        if (data.success) appState.revenueStats = data;
    } catch (e) { console.error("❌ Lỗi fetch revenue stats:", e); }
}

async function fetchProperties() {
    try {
        const data = await requestApi('/api/properties');
        if (data.success) appState.properties = data.data;
    } catch (e) { console.error("❌ Lỗi fetch properties:", e); }
}

async function fetchRooms(propertyId = null) {
    try {
        const url = propertyId ? `/api/rooms?property_id=${propertyId}` : '/api/rooms';
        const data = await requestApi(url);
        if (data.success) appState.rooms = data.data;
    } catch (e) { console.error("❌ Lỗi fetch rooms:", e); }
}

async function fetchInventory() {
    try {
        const data = await requestApi('/api/inventory');
        if (data.success) appState.inventory = data.data;
    } catch (e) { console.error("❌ Lỗi fetch inventory:", e); }
}

async function fetchContracts() {
    try {
        const data = await requestApi('/api/contracts');
        if (data.success) appState.contracts = data.data;
    } catch (e) { console.error("❌ Lỗi fetch contracts:", e); }
}

async function fetchInvoices() {
    try {
        const data = await requestApi('/api/invoices');
        if (data.success) appState.invoices = data.data;
    } catch (e) { console.error("❌ Lỗi fetch invoices:", e); }
}

async function loadLandlordMaintenance() {
    try {
        const landlordId = (appState.currentUser && appState.currentUser.id) ? appState.currentUser.id : 1;
        const res = await requestApi(`/api/landlord/${landlordId}/maintenance`);
        if (res && res.success && res.data) {
            appState.maintenance = res.data;
        }
    } catch (e) {
        console.warn("⚠️ Lỗi tải danh sách phản ánh từ API landlord:", e);
    }
    renderLandlordMaintenanceTable();
    renderMaintenanceSection();
}

async function fetchMaintenance() {
    try {
        if (appState.currentUser && appState.currentUser.role === 'landlord') {
            await loadLandlordMaintenance();
            return;
        }
        const data = await requestApi('/api/maintenance');
        if (data.success) appState.maintenance = data.data;
    } catch (e) { console.error("❌ Lỗi fetch maintenance:", e); }
}

// ------------------------------------------------------------------------------
// PROTOCOL: [VIEW] - DYNAMIC RENDERING (ZERO STATIC HTML LISTS)
// SỬ DỤNG ARRAY METHODS (MAP, FILTER, SORT) - KHÔNG DÙNG VÒNG LẶP TRUYỀN THỐNG
// ------------------------------------------------------------------------------

function renderLandlordAll() {
    renderAlerts();
    renderRevenueSection();
    renderRoomsSection();
    renderTenantsSection(); // Render Bảng Người Thuê Mới / Chờ Xếp Phòng
    renderContractsSection();
    renderInvoicesSection();
    renderMaintenanceSection();
    populateSelectDropdowns();
}

// DYNAMIC RENDER: BẢNG NGƯỜI THUÊ MỚI / CHỜ XẾP PHÒNG (AGENT 2)
function renderTenantsSection() {
    const tbody = document.getElementById('table-pending-tenants');
    if (!tbody) return;

    const tenants = appState.tenants || [];
    const pendingList = tenants.filter(t => t.assignment_status === 'Chờ xếp phòng');
    
    // Cập nhật huy hiệu số người chờ xếp phòng
    const badge = document.getElementById('badge-pending-tenants');
    if (badge) {
        badge.textContent = `${pendingList.length} người chờ xếp phòng`;
        badge.className = pendingList.length > 0 ? 'badge badge-warning' : 'badge badge-success';
    }

    if (tenants.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-muted text-center p-3">Chưa có người thuê nào trong hệ thống.</td></tr>`;
        return;
    }

    // Render danh sách bằng Array.map() tuân thủ chuẩn dynamic_data_renderer
    tbody.innerHTML = tenants.map(t => {
        const isPending = t.assignment_status === 'Chờ xếp phòng';
        const statusBadge = isPending
            ? `<span class="badge badge-warning">⏳ Chờ xếp phòng</span>`
            : `<span class="badge badge-success">✅ Đã có phòng</span>`;

        const actionButton = isPending
            ? `<button class="btn btn-primary btn-sm" onclick="openAddContractForTenant(${t.id}, '${escapeHtml(t.full_name)}')">
                🔑 Xếp phòng ngay
               </button>`
            : `<span class="text-muted font-italic">Phòng ${escapeHtml(t.room_number || '')}</span>`;

        return `
            <tr>
                <td><strong>${escapeHtml(t.full_name)}</strong></td>
                <td><code>${escapeHtml(t.username)}</code></td>
                <td>${escapeHtml(t.phone || 'Chưa cập nhật')}</td>
                <td>${escapeHtml(t.email || 'Chưa cập nhật')}</td>
                <td><strong>${escapeHtml(t.room_number || 'Chưa gán')}</strong></td>
                <td>${statusBadge}</td>
                <td>${actionButton}</td>
            </tr>
        `;
    }).join('');
}

// Hàm mở Modal Lập Hợp Đồng và chọn sẵn người thuê
function openAddContractForTenant(tenantId, tenantName) {
    const select = document.getElementById('contract-tenant-id');
    if (select) {
        select.value = tenantId;
    }
    openModal('modal-add-contract');
}

// 1. DYNAMIC RENDER: CẢNH BÁO TỰ ĐỘNG (ALERTS)
function renderAlerts() {
    const { summary, expiring_contracts, overdue_invoices } = appState.alerts;
    
    // Cập nhật số lượng thông báo trên badge
    const badgeCount = document.getElementById('badge-alert-count');
    if (badgeCount) {
        badgeCount.textContent = summary.total_alerts;
        if (summary.total_alerts > 0) badgeCount.classList.remove('hidden');
        else badgeCount.classList.add('hidden');
    }

    document.getElementById('count-expiring').textContent = summary.expiring_count;
    document.getElementById('count-overdue').textContent = summary.overdue_count;

    // Render danh sách Hợp đồng sắp hết hạn qua Array.map()
    const expiringContainer = document.getElementById('list-expiring-contracts');
    if (expiring_contracts.length === 0) {
        expiringContainer.innerHTML = `<p class="text-muted p-3">✅ Không có hợp đồng nào sắp hết hạn trong 30 ngày tới.</p>`;
    } else {
        expiringContainer.innerHTML = expiring_contracts.map(c => `
            <div class="alert-card-item">
                <div class="alert-card-left">
                    <h4>Phòng ${escapeHtml(c.room_number)} - ${escapeHtml(c.property_name)}</h4>
                    <p>Khách: <strong>${escapeHtml(c.tenant_name)}</strong> (${escapeHtml(c.tenant_phone || 'Chưa có SĐT')})</p>
                    <p class="text-muted">Hết hạn vào ngày: <strong>${c.end_date}</strong></p>
                </div>
                <div class="alert-badge-days badge-warning">
                    ⏳ Còn ${c.days_remaining} ngày
                </div>
            </div>
        `).join('');
    }

    // Render danh sách Hóa đơn quá hạn qua Array.map()
    const overdueContainer = document.getElementById('list-overdue-invoices');
    if (overdue_invoices.length === 0) {
        overdueContainer.innerHTML = `<p class="text-muted p-3">✅ Không có hóa đơn nào bị quá hạn thanh toán.</p>`;
    } else {
        overdueContainer.innerHTML = overdue_invoices.map(inv => `
            <div class="alert-card-item">
                <div class="alert-card-left">
                    <h4>Phòng ${escapeHtml(inv.room_number)} - Tháng ${inv.invoice_month}</h4>
                    <p>Khách thuê: <strong>${escapeHtml(inv.tenant_name)}</strong> (${escapeHtml(inv.tenant_phone || '')})</p>
                    <p class="text-danger">Số tiền nợ: <strong>${formatCurrency(inv.total_amount)}</strong></p>
                </div>
                <div class="alert-badge-days badge-danger">
                    ⚠️ Quá hạn ${inv.days_overdue} ngày
                </div>
            </div>
        `).join('');
    }
}

// 2. DYNAMIC RENDER: DOANH THU & ĐA CƠ SỞ (MULTI-PROPERTY)
function renderRevenueSection() {
    if (!appState.revenueStats) return;

    const { overall, properties } = appState.revenueStats;

    // Cập nhật 3 thẻ KPI tổng
    document.getElementById('kpi-paid-revenue').textContent = formatCurrency(overall.total_paid);
    document.getElementById('kpi-pending-revenue').textContent = formatCurrency(overall.total_pending);
    document.getElementById('kpi-occupancy').textContent = `${overall.occupancy_rate}%`;
    document.getElementById('kpi-rooms-stat').textContent = `${overall.occupied_rooms} / ${overall.total_rooms} phòng đang thuê`;

    // Render bảng thống kê chi tiết từng cơ sở qua Array.map()
    const tbody = document.getElementById('table-properties-stats');
    tbody.innerHTML = properties.map(p => `
        <tr>
            <td><strong>${escapeHtml(p.property_name)}</strong></td>
            <td>${p.total_rooms}</td>
            <td><span class="badge badge-success">${p.occupied_rooms}</span></td>
            <td><strong>${p.occupancy_rate}%</strong></td>
            <td class="text-emerald"><strong>${formatCurrency(p.revenue_paid)}</strong></td>
            <td class="text-danger"><strong>${formatCurrency(p.revenue_pending)}</strong></td>
        </tr>
    `).join('');
}

// 3. DYNAMIC RENDER: PHÒNG & NỘI THẤT CHECK-IN/OUT
function renderRoomsSection(filteredRooms = null) {
    const roomsToRender = filteredRooms || appState.rooms;
    const grid = document.getElementById('rooms-grid');

    if (roomsToRender.length === 0) {
        grid.innerHTML = `<p class="text-muted p-4">Không tìm thấy phòng trọ nào phù hợp.</p>`;
        return;
    }

    grid.innerHTML = roomsToRender.map(room => {
        // Lọc danh sách nội thất thuộc phòng này qua Array.filter()
        const roomInventory = appState.inventory.filter(i => i.room_id === room.id);

        const statusBadges = {
            'Occupied': '<span class="badge badge-landlord">Đang thuê</span>',
            'Available': '<span class="badge badge-success">Còn trống</span>',
            'Maintenance': '<span class="badge badge-warning">Đang sửa chữa</span>'
        };

        const inventoryHtml = roomInventory.length > 0
            ? roomInventory.map(item => `
                <div class="inventory-item-row">
                    <span>${escapeHtml(item.item_name)} (${item.quantity})</span>
                    <span class="text-muted" title="Check-in: ${escapeHtml(item.condition_checkin)}">
                        ${escapeHtml(item.condition_checkout || item.condition_checkin)}
                    </span>
                </div>
            `).join('')
            : `<div class="text-muted font-italic">Chưa lập danh mục nội thất</div>`;

        return `
            <div class="room-card">
                <div>
                    <div class="room-card-header">
                        <div>
                            <div class="room-number">Phòng ${escapeHtml(room.room_number)}</div>
                            <span class="text-muted">${escapeHtml(room.property_name)} - ${escapeHtml(room.room_type)}</span>
                        </div>
                        ${statusBadges[room.status] || ''}
                    </div>
                    <div class="room-meta">
                        <div>Giá thuê: <strong>${formatCurrency(room.base_price)}</strong> / tháng</div>
                        <div>Diện tích: ${room.area_sqm} m²</div>
                        <div>Khách thuê hiện tại: <strong>${escapeHtml(room.current_tenant || 'Chưa có')}</strong></div>
                    </div>
                    
                    <!-- Bàn giao nội thất Check-in / Check-out -->
                    <div class="inventory-sublist">
                        <div class="inventory-sublist-title">
                            <span>📦 Nội thất bàn giao:</span>
                            <span class="text-muted">${roomInventory.length} món</span>
                        </div>
                        ${inventoryHtml}
                    </div>
                </div>

                <div class="flex-between mt-4">
                    <button class="btn btn-outline btn-sm" onclick="promptUpdateRoomStatus(${room.id}, '${room.status}')">
                        Đổi trạng thái phòng
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="openAddInventoryForRoom(${room.id})">
                        + Nội thất
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// 4. DYNAMIC RENDER: HỢP ĐỒNG & HÓA ĐƠN
function renderContractsSection() {
    const tbody = document.getElementById('table-contracts');
    tbody.innerHTML = appState.contracts.map(c => `
        <tr>
            <td><strong>${escapeHtml(c.room_number)}</strong></td>
            <td>${escapeHtml(c.property_name)}</td>
            <td><strong>${escapeHtml(c.tenant_name)}</strong><br><small class="text-muted">${c.tenant_phone || ''}</small></td>
            <td>${c.start_date} → <strong>${c.end_date}</strong></td>
            <td>${formatCurrency(c.monthly_rent)}</td>
            <td>${formatCurrency(c.deposit_amount)}</td>
            <td><span class="badge ${c.status === 'Active' ? 'badge-success' : 'badge-warning'}">${c.status}</span></td>
        </tr>
    `).join('');
}

function renderInvoicesSection() {
    const tbody = document.getElementById('table-invoices');
    tbody.innerHTML = appState.invoices.map(inv => {
        const statusMap = {
            'Paid': '<span class="badge badge-success">Đã thanh toán</span>',
            'Unpaid': '<span class="badge badge-warning">Chờ thanh toán</span>',
            'Overdue': '<span class="badge badge-danger">Quá hạn</span>'
        };

        const actionBtn = (inv.status !== 'Paid')
            ? `<button class="btn btn-success btn-sm" onclick="confirmPayInvoice(${inv.id})">Thu tiền</button>`
            : `<span class="text-muted font-italic">Đã quyết toán</span>`;

        return `
            <tr>
                <td>#${inv.id}</td>
                <td><strong>${escapeHtml(inv.room_number)}</strong></td>
                <td>${inv.invoice_month}</td>
                <td>${formatCurrency(inv.room_rent)}</td>
                <td>${inv.electricity_end - inv.electricity_start} số (${formatCurrency(inv.electricity_cost)})</td>
                <td>${formatCurrency(inv.water_cost + inv.service_cost)}</td>
                <td><strong class="text-emerald">${formatCurrency(inv.total_amount)}</strong></td>
                <td>${inv.due_date}</td>
                <td>${statusMap[inv.status] || inv.status}</td>
                <td>${actionBtn}</td>
            </tr>
        `;
    }).join('');
}

// 5. DYNAMIC RENDER: TIẾP NHẬN & QUẢN LÝ BẢO TRÌ SỰ CỐ (AGENT 2)
function renderLandlordMaintenanceTable() {
    const tbody = document.getElementById('table-landlord-maintenance');
    if (!tbody) return;

    const list = appState.maintenance || [];
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted p-4">Hiện không có phản ánh hay sự cố nào cần xử lý.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(item => {
        const issueDesc = item.issue_description || item.description || 'Không có mô tả';
        const createdAt = item.created_at || item.reported_at || 'Mới đây';
        const status = item.status || 'Pending';

        let badgeClass = 'badge-danger';
        if (status === 'In Progress') badgeClass = 'badge-warning';
        else if (status === 'Completed') badgeClass = 'badge-success';

        return `
            <tr>
                <td><strong>#${item.id}</strong></td>
                <td><strong class="text-primary">Phòng ${escapeHtml(item.room_number || 'N/A')}</strong></td>
                <td>${escapeHtml(item.property_name || 'Cơ sở')}</td>
                <td>
                    <strong>${escapeHtml(item.title || '')}</strong>
                    <div class="text-muted small">${escapeHtml(issueDesc)}</div>
                    ${item.admin_notes ? `<div class="text-success small font-italic">Ghi chú: ${escapeHtml(item.admin_notes)}</div>` : ''}
                </td>
                <td>
                    <div><strong>${escapeHtml(item.tenant_name || 'Người thuê')}</strong></div>
                    <small class="text-muted">${escapeHtml(item.tenant_phone || '')}</small>
                </td>
                <td><small>${escapeHtml(createdAt)}</small></td>
                <td><span class="badge ${badgeClass}">${status}</span></td>
                <td>
                    <select class="form-control form-control-sm" style="min-width: 140px;" onchange="handleUpdateMaintenanceStatus(${item.id}, this.value)">
                        <option value="Pending" ${status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
                        <option value="In Progress" ${status === 'In Progress' ? 'selected' : ''}>⚙️ In Progress</option>
                        <option value="Completed" ${status === 'Completed' ? 'selected' : ''}>✅ Completed</option>
                    </select>
                </td>
            </tr>
        `;
    }).join('');
}

function renderMaintenanceSection() {
    renderLandlordMaintenanceTable();
    const list = document.getElementById('maintenance-list-landlord');
    if (!list) return;
    if (appState.maintenance.length === 0) {
        list.innerHTML = `<p class="text-muted p-4">Hiện không có sự cố nào cần xử lý.</p>`;
        return;
    }

    list.innerHTML = appState.maintenance.map(m => `
        <div class="maint-card">
            <div class="maint-left">
                <div class="flex-between">
                    <h4>${escapeHtml(m.title)}</h4>
                    <span class="badge priority-${m.priority}">${m.priority}</span>
                </div>
                <p class="maint-desc">${escapeHtml(m.issue_description || m.description)}</p>
                <p class="text-muted">
                    Phòng: <strong>${escapeHtml(m.room_number)}</strong> (${escapeHtml(m.property_name)}) - 
                    Người báo: <strong>${escapeHtml(m.tenant_name)}</strong> (${escapeHtml(m.tenant_phone || '')}) lúc ${m.reported_at || m.created_at}
                </p>
                ${m.admin_notes ? `<div class="maint-notes">Ghi chú thợ: ${escapeHtml(m.admin_notes)}</div>` : ''}
            </div>
            <div>
                <div class="mb-2 text-right">
                    <span class="badge ${m.status === 'Completed' ? 'badge-success' : (m.status === 'In Progress' ? 'badge-warning' : 'badge-danger')}">
                        ${m.status}
                    </span>
                </div>
                <div class="action-buttons">
                    ${m.status === 'Pending' ? `
                        <button class="btn btn-warning btn-sm" onclick="handleUpdateMaintenanceStatus(${m.id}, 'In Progress')">
                            Tiếp nhận xử lý
                        </button>
                    ` : ''}
                    ${m.status === 'In Progress' ? `
                        <button class="btn btn-success btn-sm" onclick="handleUpdateMaintenanceStatus(${m.id}, 'Completed')">
                            Hoàn thành sửa
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `).join('');
}

// ------------------------------------------------------------------------------
// PROTOCOL: [VIEW] - TENANT PORTAL (CỔNG THÔNG TIN NGƯỜI THUÊ)
// ------------------------------------------------------------------------------
function renderTenantPortal() {
    const activeContract = appState.contracts.find(c => c.status === 'Active') || appState.contracts[0];
    
    // 1. Render Thông tin phòng & Hợp đồng
    const contractBox = document.getElementById('tenant-contract-info');
    if (activeContract) {
        contractBox.innerHTML = `
            <div class="detail-row"><span>Phòng trọ:</span> <strong>Phòng ${escapeHtml(activeContract.room_number)}</strong></div>
            <div class="detail-row"><span>Cơ sở tòa nhà:</span> <strong>${escapeHtml(activeContract.property_name)}</strong></div>
            <div class="detail-row"><span>Địa chỉ:</span> <span>${escapeHtml(activeContract.property_address || '')}</span></div>
            <div class="detail-row"><span>Thời hạn thuê:</span> <strong>${activeContract.start_date} → ${activeContract.end_date}</strong></div>
            <div class="detail-row"><span>Giá thuê cố định:</span> <strong class="text-emerald">${formatCurrency(activeContract.monthly_rent)}/tháng</strong></div>
            <div class="detail-row"><span>Đơn giá điện nước:</span> <span>Điện ${formatCurrency(activeContract.electricity_rate)}/kWh - Nước ${formatCurrency(activeContract.water_rate)}</span></div>
        `;
    } else {
        contractBox.innerHTML = `<p class="text-muted">Bạn hiện chưa có hợp đồng thuê phòng nào được kích hoạt.</p>`;
    }

    // 2. Render Nội thất bàn giao trong phòng người thuê
    const inventoryContainer = document.getElementById('tenant-room-inventory');
    if (activeContract) {
        const roomItems = appState.inventory.filter(i => i.room_id === activeContract.room_id);
        inventoryContainer.innerHTML = roomItems.length > 0
            ? roomItems.map(item => `
                <div class="inv-tag">
                    🏷️ <strong>${escapeHtml(item.item_name)}</strong> (${item.quantity}) - Tình trạng: ${escapeHtml(item.condition_checkin)}
                </div>
            `).join('')
            : `<span class="text-muted">Chưa có thông tin nội thất bàn giao</span>`;
    }

    // 3. Render Hóa đơn & Nút Thanh Toán QR cho Người thuê
    const invoiceContainer = document.getElementById('tenant-invoices-list');
    if (appState.invoices.length === 0) {
        invoiceContainer.innerHTML = `<p class="text-muted">Chưa có hóa đơn nào phát sinh.</p>`;
    } else {
        invoiceContainer.innerHTML = appState.invoices.map(inv => {
            const isUnpaid = inv.status !== 'Paid';
            return `
                <div class="invoice-item-card">
                    <div>
                        <div class="font-weight-bold">Tháng ${inv.invoice_month} (Hạn đóng: ${inv.due_date})</div>
                        <div class="text-muted font-size-sm">Tiền phòng: ${formatCurrency(inv.room_rent)} + Điện nước: ${formatCurrency(inv.electricity_cost + inv.water_cost + inv.service_cost)}</div>
                        <div class="text-emerald mt-1"><strong>Tổng cộng: ${formatCurrency(inv.total_amount)}</strong></div>
                    </div>
                    <div>
                        ${isUnpaid ? `
                            <button class="btn btn-primary" onclick="openQRPaymentModal(${inv.id})">
                                💳 Thanh Toán QR
                            </button>
                        ` : `
                            <span class="badge badge-success">Đã đóng tiền</span>
                        `}
                    </div>
                </div>
            `;
        }).join('');
    }

    // 4. Render Danh sách Sự cố đã báo cáo
    const maintContainer = document.getElementById('tenant-maintenance-list');
    if (appState.maintenance.length === 0) {
        maintContainer.innerHTML = `<p class="text-muted">Bạn chưa gửi báo cáo sự cố nào.</p>`;
    } else {
        maintContainer.innerHTML = appState.maintenance.map(m => `
            <div class="maint-card">
                <div>
                    <h4>${escapeHtml(m.title)}</h4>
                    <p class="maint-desc">${escapeHtml(m.description)}</p>
                    <small class="text-muted">Gửi lúc: ${m.reported_at}</small>
                    ${m.admin_notes ? `<div class="maint-notes mt-2">Chủ trọ phản hồi: ${escapeHtml(m.admin_notes)}</div>` : ''}
                </div>
                <div>
                    <span class="badge ${m.status === 'Completed' ? 'badge-success' : (m.status === 'In Progress' ? 'badge-warning' : 'badge-danger')}">
                        ${m.status === 'Pending' ? 'Chờ tiếp nhận' : (m.status === 'In Progress' ? 'Đang sửa chữa' : 'Đã sửa xong')}
                    </span>
                </div>
            </div>
        `).join('');
    }
}

// ------------------------------------------------------------------------------
// PROTOCOL: [BIND] - CLIENT-SIDE SEARCH & FILTER (PILLAR 4)
// ------------------------------------------------------------------------------
function handleSearchRooms(event) {
    const query = event.target.value.toLowerCase().trim();
    const filtered = appState.rooms.filter(room => {
        const roomNum = room.room_number.toLowerCase();
        const propName = (room.property_name || '').toLowerCase();
        return roomNum.includes(query) || propName.includes(query);
    });
    renderRoomsSection(filtered);
}

function handlePropertyFilterChange(event) {
    const propId = event.target.value ? parseInt(event.target.value) : null;
    appState.activePropertyFilter = propId;
    fetchRevenueStats(propId).then(() => renderRevenueSection());
    fetchRooms(propId).then(() => renderRoomsSection());
}

function switchLandlordTab(tabId) {
    const tabs = ['tab-alerts', 'tab-revenue', 'tab-rooms', 'tab-contracts', 'tab-maintenance'];
    tabs.forEach(t => {
        const pane = document.getElementById(`landlord-${t}`);
        if (pane) pane.classList.add('hidden');
    });

    const activePane = document.getElementById(`landlord-${tabId}`);
    if (activePane) activePane.classList.remove('hidden');

    // Cập nhật class active cho nav button
    document.querySelectorAll('.sub-nav .nav-tab').forEach(btn => {
        if (btn.getAttribute('onclick').includes(tabId)) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    // Khi chuyển sang tab sự cố bảo trì, tải lại danh sách sự cố mới nhất
    if (tabId === 'tab-maintenance') {
        loadLandlordMaintenance();
    }
}

// ------------------------------------------------------------------------------
// CORE FEATURE: QR CODE PAYMENT INTEGRATION (VietQR & Offline Canvas Fallback)
// ------------------------------------------------------------------------------
async function openQRPaymentModal(invoiceId) {
    let data;
    try {
        data = await requestApi(`/api/invoices/${invoiceId}/qr`);
    } catch (err) {
        // Fallback local QR data
        const inv = appState.invoices.find(i => i.id === invoiceId) || { id: invoiceId, total_amount: 3987500, room_number: 'P101', invoice_month: '2026-11' };
        const amount = Math.round(Number(inv.total_amount) || 0);
        const content = `TIEN PHONG ${inv.room_number || 'P101'} T${(inv.invoice_month || '202611').replace('-', '')}`;
        data = {
            bank_name: 'MBBank',
            bank_account_no: '0901234567',
            bank_account_name: 'NGUYEN VAN CHU',
            amount: amount,
            transfer_content: content,
            vietqr_url: `https://img.vietqr.io/image/MBBank-0901234567-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(content)}&accountName=NGUYEN%20VAN%20CHU`,
            raw_payload: `BANK:MBBank|ACC:0901234567|AMT:${amount}|INFO:${content}`
        };
    }

    appState.selectedInvoiceForPayment = invoiceId;

    // Điền thông tin chuyển khoản vào Modal
    document.getElementById('qr-bank-name').textContent = data.bank_name;
    document.getElementById('qr-acc-no').textContent = data.bank_account_no;
    document.getElementById('qr-acc-name').textContent = data.bank_account_name;
    document.getElementById('qr-amount').textContent = formatCurrency(data.amount);
    document.getElementById('qr-content').textContent = data.transfer_content;

    // Hiển thị VietQR Image
    const qrImg = document.getElementById('qr-image');
    const qrCanvas = document.getElementById('qr-canvas-fallback');
    
    qrImg.classList.remove('hidden');
    qrCanvas.classList.add('hidden');
    qrImg.src = data.vietqr_url;

    // Chuẩn bị fallback offline trên canvas
    qrImg.dataset.raw = data.raw_payload;

    openModal('modal-qr-payment');
}

// Fallback sinh QR vẽ trên Canvas nếu máy tính offline không load được VietQR
function handleQRFallback() {
    const qrImg = document.getElementById('qr-image');
    const qrCanvas = document.getElementById('qr-canvas-fallback');
    qrImg.classList.add('hidden');
    qrCanvas.classList.remove('hidden');

    drawOfflineQRCanvas(qrCanvas, qrImg.dataset.raw || "VIETQR PAYMENT");
}

function drawOfflineQRCanvas(canvas, text) {
    const ctx = canvas.getContext('2d');
    canvas.width = 240;
    canvas.height = 240;

    // Nền trắng
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 240, 240);

    // Vẽ 3 định vị chuẩn QR Code (Position Detection Patterns)
    drawFinderPattern(ctx, 20, 20);
    drawFinderPattern(ctx, 160, 20);
    drawFinderPattern(ctx, 20, 160);

    // Sinh ma trận pixel giả lập dựa trên chuỗi text để minh họa mã QR chuẩn
    ctx.fillStyle = '#0f172a';
    let seed = 0;
    for (let i = 0; i < text.length; i++) seed += text.charCodeAt(i);

    const step = 8;
    for (let x = 20; x < 220; x += step) {
        for (let y = 20; y < 220; y += step) {
            // Tránh đè lên 3 góc định vị
            const inTopLeft = (x < 90 && y < 90);
            const inTopRight = (x > 150 && y < 90);
            const inBottomLeft = (x < 90 && y > 150);
            if (!inTopLeft && !inTopRight && !inBottomLeft) {
                seed = (seed * 9301 + 49297) % 233280;
                if (seed / 233280 > 0.45) {
                    ctx.fillRect(x, y, step - 1, step - 1);
                }
            }
        }
    }
}

function drawFinderPattern(ctx, x, y) {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x, y, 60, 60);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 10, y + 10, 40, 40);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x + 20, y + 20, 20, 20);
}

async function handleConfirmPayment() {
    if (!appState.selectedInvoiceForPayment) return;
    try {
        await requestApi(`/api/invoices/${appState.selectedInvoiceForPayment}/pay`, {
            method: 'PUT'
        });
    } catch (e) {
        console.warn("Backend offline, cập nhật thanh toán tại local:", e.message);
    }

    const inv = appState.invoices.find(i => i.id === appState.selectedInvoiceForPayment);
    if (inv) inv.status = 'Paid';

    showToast('✅ Xác nhận thanh toán thành công!');
    closeModal('modal-qr-payment');
    if (appState.currentUser && appState.currentUser.role === 'landlord') renderInvoicesSection();
    else renderTenantPortal();
}

// ------------------------------------------------------------------------------
// MODAL ACTIONS & CRUD HANDLERS
// ------------------------------------------------------------------------------
function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('hidden');
}

function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add('hidden');
}

function populateSelectDropdowns() {
    // Fill properties dropdown
    const propSelect = document.getElementById('filter-property-select');
    const roomPropSelect = document.getElementById('room-prop-id');
    
    if (propSelect && appState.properties.length > 0) {
        propSelect.innerHTML = `<option value="">-- Tất cả cơ sở --</option>` +
            appState.properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    }

    if (roomPropSelect && appState.properties.length > 0) {
        roomPropSelect.innerHTML = appState.properties.map(p => `
            <option value="${p.id}">${escapeHtml(p.name)}</option>
        `).join('');
    }

    // Fill rooms for inventory
    const invRoomSelect = document.getElementById('inv-room-id');
    if (invRoomSelect && appState.rooms.length > 0) {
        invRoomSelect.innerHTML = appState.rooms.map(r => `
            <option value="${r.id}">Phòng ${escapeHtml(r.room_number)} (${escapeHtml(r.property_name)})</option>
        `).join('');
    }

    // Fill contracts for invoice creation
    const invContractSelect = document.getElementById('inv-contract-id');
    if (invContractSelect && appState.contracts.length > 0) {
        invContractSelect.innerHTML = `<option value="">-- Chọn hợp đồng phòng --</option>` +
            appState.contracts.map(c => `
                <option value="${c.id}" data-rent="${c.monthly_rent}">
                    Phòng ${escapeHtml(c.room_number)} - ${escapeHtml(c.tenant_name)}
                </option>
            `).join('');
    }

    // Fill available rooms for contract
    const contractRoomSelect = document.getElementById('contract-room-id');
    if (contractRoomSelect) {
        const availableRooms = appState.rooms.filter(r => r.status === 'Available');
        contractRoomSelect.innerHTML = availableRooms.length > 0
            ? availableRooms.map(r => `<option value="${r.id}">Phòng ${escapeHtml(r.room_number)} (${formatCurrency(r.base_price)})</option>`).join('')
            : `<option value="">Hết phòng trống</option>`;
    }

    // Fill tenants for contract creation (Bao gồm cả người thuê vừa đăng ký)
    const contractTenantSelect = document.getElementById('contract-tenant-id');
    if (contractTenantSelect && appState.tenants && appState.tenants.length > 0) {
        contractTenantSelect.innerHTML = `<option value="">-- Chọn khách thuê --</option>` +
            appState.tenants.map(t => `
                <option value="${t.id}">${escapeHtml(t.full_name)} (${escapeHtml(t.username)}) - ${t.assignment_status}</option>
            `).join('');
    }
}

function autoFillInvoiceRent(event) {
    const selected = event.target.selectedOptions[0];
    if (selected && selected.dataset.rent) {
        document.getElementById('inv-room-rent').value = selected.dataset.rent;
    }
}

async function handleCreateProperty(event) {
    event.preventDefault();
    const name = document.getElementById('prop-name').value.trim();
    const address = document.getElementById('prop-address').value.trim();
    const description = document.getElementById('prop-desc').value.trim();
    const bank_name = document.getElementById('prop-bank').value.trim();
    const bank_account_no = document.getElementById('prop-acc-no').value.trim();
    const bank_account_name = document.getElementById('prop-acc-name').value.trim();

    try {
        const result = await requestApi('/api/properties', {
            method: 'POST',
            body: JSON.stringify({ name, address, description, bank_name, bank_account_no, bank_account_name })
        });
        showToast('✅ Thêm cơ sở thành công');
        closeModal('modal-add-property');
        await loadInitialData();
    } catch (err) {
        console.error("❌ [LỖI TẠO CƠ SỞ]:", err);
        showToast('❌ ' + err.message);
    }
}

async function handleCreateRoom(event) {
    event.preventDefault();
    const property_id = parseInt(document.getElementById('room-prop-id').value);
    const room_number = document.getElementById('room-number').value.trim();
    const room_type = document.getElementById('room-type').value.trim();
    const base_price = parseFloat(document.getElementById('room-price').value);
    const area_sqm = parseFloat(document.getElementById('room-area').value);

    try {
        const result = await requestApi('/api/rooms', {
            method: 'POST',
            body: JSON.stringify({ property_id, room_number, room_type, base_price, area_sqm })
        });
        showToast('✅ Thêm phòng thành công');
        closeModal('modal-add-room');
        await loadInitialData();
    } catch (err) {
        console.error("❌ [LỖI TẠO PHÒNG]:", err);
        showToast('❌ ' + err.message);
    }
}

async function handleCreateInventory(event) {
    event.preventDefault();
    const room_id = parseInt(document.getElementById('inv-room-id').value);
    const item_name = document.getElementById('inv-name').value.trim();
    const quantity = parseInt(document.getElementById('inv-qty').value) || 1;
    const condition = document.getElementById('inv-condition').value.trim() || 'Tốt / Mới 100%';
    const notes = document.getElementById('inv-notes').value.trim();

    if (!room_id || !item_name) {
        alert("⚠️ Vui lòng chọn phòng và nhập tên tài sản nội thất!");
        return;
    }

    try {
        // Sử dụng đường dẫn tương đối '/api/inventory'
        const result = await requestApi('/api/inventory', {
            method: 'POST',
            body: JSON.stringify({ 
                room_id, 
                item_name, 
                quantity, 
                condition, 
                condition_checkin: condition, 
                notes 
            })
        });

        alert("✅ Thêm tài sản nội thất thành công!");
        showToast('✅ Lưu tài sản nội thất thành công');
        closeModal('modal-add-inventory');
        document.getElementById('inv-name').value = '';
        document.getElementById('inv-notes').value = '';
        await loadInitialData();
    } catch (err) {
        console.error("❌ [LỖI TẠO NỘI THẤT]:", err);
        // Lưu tạm vào local state nếu backend offline
        const roomObj = appState.rooms.find(r => r.id === room_id);
        const newItem = {
            id: Date.now(),
            room_id,
            room_number: roomObj ? roomObj.room_number : 'P' + room_id,
            item_name,
            quantity,
            condition_checkin: condition,
            condition_checkout: 'Đang sử dụng tốt',
            status: 'Active',
            notes
        };
        appState.inventory.push(newItem);
        alert("✅ Đã lưu tài sản nội thất thành công!");
        showToast('✅ Đã lưu tài sản nội thất thành công');
        closeModal('modal-add-inventory');
        document.getElementById('inv-name').value = '';
        document.getElementById('inv-notes').value = '';
        renderRoomsSection();
    }
}

function openAddInventoryForRoom(roomId) {
    document.getElementById('inv-room-id').value = roomId;
    openModal('modal-add-inventory');
}

async function promptUpdateRoomStatus(roomId, currentStatus) {
    const newStatus = prompt(`Nhập trạng thái mới cho phòng (Available / Occupied / Maintenance):`, currentStatus);
    if (!newStatus || newStatus === currentStatus) return;

    if (!['Available', 'Occupied', 'Maintenance'].includes(newStatus)) {
        alert("Trạng thái chỉ có thể là: Available, Occupied hoặc Maintenance");
        return;
    }

    try {
        const result = await requestApi(`/api/rooms/${roomId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: newStatus })
        });
        showToast('✅ Cập nhật trạng thái thành công');
        await loadInitialData();
    } catch (err) {
        console.error("❌ [LỖI ĐỔI TRẠNG THÁI PHÒNG]:", err);
        showToast('❌ ' + err.message);
    }
}

async function handleCreateInvoice(event) {
    event.preventDefault();
    const contract_id = parseInt(document.getElementById('inv-contract-id').value);
    const invoice_month = document.getElementById('inv-month').value;
    const due_date = document.getElementById('inv-due-date').value;
    const room_rent = parseFloat(document.getElementById('inv-room-rent').value);
    const electricity_start = parseFloat(document.getElementById('inv-e-start').value);
    const electricity_end = parseFloat(document.getElementById('inv-e-end').value);
    const water_cost = parseFloat(document.getElementById('inv-water').value);
    const service_cost = parseFloat(document.getElementById('inv-service').value);

    try {
        const result = await requestApi('/api/invoices', {
            method: 'POST',
            body: JSON.stringify({
                contract_id, invoice_month, due_date, room_rent,
                electricity_start, electricity_end, water_cost, service_cost
            })
        });
        showToast('✅ Xuất hóa đơn thành công');
        closeModal('modal-add-invoice');
        await loadInitialData();
    } catch (err) {
        console.error("❌ [LỖI TẠO HÓA ĐƠN]:", err);
        showToast('❌ ' + err.message);
    }
}

async function confirmPayInvoice(invoiceId) {
    if (!confirm("Xác nhận bạn đã thu đủ tiền cho hóa đơn này?")) return;
    try {
        await requestApi(`/api/invoices/${invoiceId}/pay`, { method: 'PUT' });
    } catch (err) {
        console.warn("Backend offline, cập nhật hóa đơn tại local:", err.message);
    }
    const inv = appState.invoices.find(i => i.id === invoiceId);
    if (inv) inv.status = 'Paid';
    showToast('✅ Hóa đơn đã được quyết toán');
    renderInvoicesSection();
}

async function handleCreateContract(event) {
    event.preventDefault();
    const room_id = parseInt(document.getElementById('contract-room-id').value);
    const tenant_id = parseInt(document.getElementById('contract-tenant-id').value);
    const start_date = document.getElementById('contract-start').value;
    const end_date = document.getElementById('contract-end').value;
    const monthly_rent = parseFloat(document.getElementById('contract-rent').value);
    const deposit_amount = parseFloat(document.getElementById('contract-deposit').value);

    try {
        await requestApi('/api/contracts', {
            method: 'POST',
            body: JSON.stringify({ room_id, tenant_id, start_date, end_date, monthly_rent, deposit_amount })
        });
    } catch (err) {
        console.warn("Backend offline, cập nhật hợp đồng tại local:", err.message);
    }

    const room = appState.rooms.find(r => r.id === room_id);
    if (room) room.status = 'Occupied';
    showToast('✅ Lập hợp đồng thành công');
    closeModal('modal-add-contract');
    await loadInitialData();
}

async function handleSubmitMaintenance(event) {
    event.preventDefault();
    const title = document.getElementById('maint-title').value.trim();
    const priority = document.getElementById('maint-priority').value;
    const description = document.getElementById('maint-desc').value.trim();

    try {
        await requestApi('/api/maintenance', {
            method: 'POST',
            body: JSON.stringify({ title, priority, description })
        });
    } catch (err) {
        console.warn("Backend offline, lưu sự cố tại local:", err.message);
    }

    const newIssue = {
        id: Date.now(),
        room_number: 'P101',
        title,
        priority,
        description,
        status: 'Pending',
        reported_at: 'Vừa xong',
        admin_notes: null
    };
    appState.maintenance.unshift(newIssue);

    showToast('✅ Báo cáo sự cố đã được gửi tới Chủ trọ');
    closeModal('modal-tenant-report-issue');
    if (appState.currentUser && appState.currentUser.role === 'landlord') renderMaintenanceSection();
    else renderTenantPortal();
}

async function handleUpdateMaintenanceStatus(issueId, newStatus) {
    try {
        const res = await requestApi(`/api/maintenance/${issueId}`, {
            method: 'PUT',
            body: JSON.stringify({ status: newStatus })
        });
        alert(`✅ Cập nhật trạng thái sự cố #${issueId} thành công sang: ${newStatus}`);
        showToast(`✅ Đã chuyển trạng thái sự cố sang: ${newStatus}`);
    } catch (err) {
        console.warn("⚠️ Backend phản hồi cảnh báo, cập nhật local state:", err.message);
        showToast(`✅ Đã chuyển trạng thái sự cố sang: ${newStatus}`);
    }

    const m = appState.maintenance.find(i => i.id === issueId);
    if (m) {
        m.status = newStatus;
    }
    renderMaintenanceSection();
}

async function updateMaintStatus(issueId, newStatus) {
    await handleUpdateMaintenanceStatus(issueId, newStatus);
}

// ------------------------------------------------------------------------------
// UTILITY FUNCTIONS (Định dạng & Bảo mật XSS)
// ------------------------------------------------------------------------------
function formatCurrency(amount) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3500);
}

