// ==============================================================================
// RENTMASTER ADMIN CONSOLE LOGIC (admin.js)
// Aesthetic: Paper-White Minimalist (#efece6, IBM Plex Mono, Schibsted Grotesk)
// API Base: Tự động thích ứng (Localhost, Ngrok HTTPS hoặc Live Server)
// ==============================================================================

// Tự động nhận diện môi trường:
// 1. Chạy chuẩn qua Flask / Ngrok / Domain: dùng relative path '/api' (an toàn HTTPS, không lo Mixed Content)
// 2. Chạy qua Live Server (cổng 5500, 3000) hoặc file://: fallback sang 'http://127.0.0.1:5000/api'
const isLiveServer = (window.location.port === '5500' || window.location.port === '3000' || window.location.protocol === 'file:');
const API_BASE = isLiveServer ? 'http://127.0.0.1:5000/api' : '/api';
let currentAdmin = null;
let allRoomsData = [];
let availableRoomsData = [];
let allTenantsData = [];
let activeContractsData = [];
let allInvoicesData = [];
let utilityRoomsData = [];
let searchTimeout = null;

// ------------------------------------------------------------------------------
// 1. AUTHENTICATION & LOGIN LOGIC
// ------------------------------------------------------------------------------
async function handleAdminLogin(event) {
    event.preventDefault();
    const username = document.getElementById('admin-login-username').value.trim();
    const password = document.getElementById('admin-login-password').value.trim();

    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, portal: 'admin' })
        });
        const data = await res.json();

        if (res.status === 403) {
            alert("⛔ " + (data.message || "Bạn không có quyền truy cập trang quản trị"));
            return;
        }

        if (data.success && data.user) {
            if (data.user.role !== 'landlord') {
                alert("⛔ Bạn không có quyền truy cập trang quản trị!");
                return;
            }
            currentAdmin = data.user;
            showAdminDashboardUI();
            await loadAdminData();
            showToast(`👋 Chào mừng Quản trị viên ${currentAdmin.full_name}!`);
        } else {
            alert(`❌ Đăng nhập thất bại: ${data.message || 'Sai tài khoản hoặc mật khẩu'}`);
        }
    } catch (err) {
        console.error("Lỗi đăng nhập:", err);
        alert("❌ Lỗi kết nối tới máy chủ API. Hãy kiểm tra server Flask hoặc đường truyền mạng!");
    }
}

document.getElementById('btn-admin-logout')?.addEventListener('click', async () => {
    try {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
    } catch (_) {}
    currentAdmin = null;
    document.getElementById('admin-auth-section').classList.remove('hidden');
    document.getElementById('admin-dashboard-section').classList.add('hidden');
    document.getElementById('header-admin-panel').classList.add('hidden');
    showToast('👋 Đã đăng xuất khỏi trang quản trị.');
});

function showAdminDashboardUI() {
    document.getElementById('admin-auth-section').classList.add('hidden');
    document.getElementById('admin-dashboard-section').classList.remove('hidden');
    document.getElementById('header-admin-panel').classList.remove('hidden');
    document.getElementById('admin-display-name').textContent = currentAdmin.full_name;
    document.getElementById('admin-name').textContent = currentAdmin.full_name;

    // Thiết lập ngày mặc định
    const today = new Date();
    const curMonth = today.toISOString().slice(0, 7);
    const dueDate = new Date(today.getFullYear(), today.getMonth(), 25).toISOString().slice(0, 10);
    const startDate = today.toISOString().slice(0, 10);
    const endDate = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()).toISOString().slice(0, 10);

    const monthInput = document.getElementById('util-month');
    const dueInput = document.getElementById('util-due-date');
    if (monthInput && !monthInput.value) monthInput.value = curMonth;
    if (dueInput && !dueInput.value) dueInput.value = dueDate;

    const createMonthInput = document.getElementById('create-inv-month');
    const createDueInput = document.getElementById('create-inv-due-date');
    if (createMonthInput && !createMonthInput.value) createMonthInput.value = curMonth;
    if (createDueInput && !createDueInput.value) createDueInput.value = dueDate;

    const assignStart = document.getElementById('assign-start-date');
    const assignEnd = document.getElementById('assign-end-date');
    if (assignStart && !assignStart.value) assignStart.value = startDate;
    if (assignEnd && !assignEnd.value) assignEnd.value = endDate;
}

// ------------------------------------------------------------------------------
// 2. CHUYỂN TAB NAVIGATION
// ------------------------------------------------------------------------------
function switchAdminTab(tabId) {
    const tabs = ['tab-rooms', 'tab-tenants', 'tab-invoices', 'tab-notices', 'tab-utilities', 'tab-maintenance'];
    tabs.forEach(t => {
        const pane = document.getElementById(`admin-${t}`);
        if (pane) pane.classList.add('hidden');
    });

    const activePane = document.getElementById(`admin-${tabId}`);
    if (activePane) activePane.classList.remove('hidden');

    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
        if (btn.getAttribute('onclick')?.includes(tabId)) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    if (tabId === 'tab-rooms') loadRoomsAndFloors();
    if (tabId === 'tab-tenants') loadTenantsList();
    if (tabId === 'tab-invoices') applyInvoiceFilters();
    if (tabId === 'tab-notices') loadNoticesList();
    if (tabId === 'tab-utilities') loadUtilityModule();
    if (tabId === 'tab-maintenance') loadMaintenanceList();
}

// ------------------------------------------------------------------------------
// 3. TẢI TẤT CẢ DỮ LIỆU
// ------------------------------------------------------------------------------
async function loadAdminData() {
    await Promise.all([
        loadRoomsAndFloors(),
        loadTenantsList(),
        applyInvoiceFilters(),
        loadNoticesList(),
        loadUtilityModule(),
        loadMaintenanceList()
    ]);
}

// ------------------------------------------------------------------------------
// 4. MODULE 1: SƠ ĐỒ 20 PHÒNG & XẾP PHÒNG
// ------------------------------------------------------------------------------
async function loadRoomsAndFloors() {
    try {
        const [roomsRes, availRes, tenantsRes] = await Promise.all([
            fetch(`${API_BASE}/rooms`),
            fetch(`${API_BASE}/rooms/available`),
            fetch(`${API_BASE}/landlord/tenants`)
        ]);

        const roomsData = await roomsRes.json();
        const availData = await availRes.json();
        const tenantsData = await tenantsRes.json();

        allRoomsData = roomsData.data || [];
        availableRoomsData = availData.data || [];
        allTenantsData = tenantsData.data || [];

        // 1. Cập nhật strip số liệu
        const totalRooms = allRoomsData.length;
        const availRooms = availableRoomsData.length;
        const occupiedRooms = totalRooms - availRooms;
        const unassignedTenants = allTenantsData.filter(t => t.assignment_status === 'Chờ xếp phòng');

        document.getElementById('stat-rooms-total').textContent = totalRooms;
        document.getElementById('stat-rooms-available').textContent = availRooms;
        document.getElementById('stat-rooms-occupied').textContent = occupiedRooms;
        document.getElementById('stat-tenants-unassigned').textContent = unassignedTenants.length;
        document.getElementById('badge-unassigned-count').textContent = `${unassignedTenants.length} khách chờ`;

        // 2. Render danh sách khách chờ xếp phòng
        const tbodyUnassigned = document.getElementById('table-unassigned-tenants');
        if (tbodyUnassigned) {
            if (unassignedTenants.length === 0) {
                tbodyUnassigned.innerHTML = `<tr><td colspan="6" class="text-center text-muted p-3">Tất cả khách thuê hiện đã có phòng trọ hợp lệ.</td></tr>`;
            } else {
                tbodyUnassigned.innerHTML = unassignedTenants.map(t => `
                    <tr>
                        <td><strong class="font-mono">#${t.id}</strong></td>
                        <td><strong>${escapeHtml(t.full_name)}</strong></td>
                        <td><code>${escapeHtml(t.username)}</code></td>
                        <td><span class="font-mono">${escapeHtml(t.phone || 'Chưa cập nhật')}</span></td>
                        <td><span class="badge badge-warning">⏳ Chờ xếp phòng</span></td>
                        <td>
                            <button class="btn btn-primary btn-sm" onclick="openAssignModalForTenant(${t.id}, '${escapeHtml(t.full_name)}')">
                                [ XẾP PHÒNG NGAY ➔ ]
                            </button>
                        </td>
                    </tr>
                `).join('');
            }
        }

        // 3. Render danh sách 20 thẻ phòng trực quan
        const grid = document.getElementById('grid-admin-rooms');
        if (grid) {
            if (allRoomsData.length === 0) {
                grid.innerHTML = `<div class="text-center text-muted p-4">Chưa có thông tin phòng nào trong hệ thống.</div>`;
            } else {
                grid.innerHTML = allRoomsData.map(r => {
                    const isAvail = (r.status === 'Available');
                    const statusClass = isAvail ? 'status-available' : 'status-occupied';
                    const statusBadge = isAvail 
                        ? `<span class="badge badge-success">● TRỐNG</span>` 
                        : `<span class="badge badge-primary">● ĐANG THUÊ</span>`;

                    const tenantInfo = r.tenant_name 
                        ? `<div class="font-bold" style="font-size: 0.85rem; margin-bottom: 4px;">Khách: ${escapeHtml(r.tenant_name)}</div>` 
                        : `<div class="text-muted" style="font-size: 0.82rem; margin-bottom: 4px;">Chưa có người thuê</div>`;

                    const actionBtn = isAvail
                        ? `<button class="btn btn-outline btn-sm btn-block" onclick="openAssignModalForRoom(${r.id}, '${escapeHtml(r.room_number)}', ${r.base_price})">[ XẾP PHÒNG ]</button>`
                        : `<button class="btn btn-secondary btn-sm btn-block" disabled style="opacity: 0.7;">[ ĐÃ CÓ HỢP ĐỒNG ]</button>`;

                    return `
                        <div class="room-card ${statusClass}">
                            <div class="room-card-header">
                                <span class="room-code">PHÒNG ${escapeHtml(r.room_number)}</span>
                                ${statusBadge}
                            </div>
                            <div class="room-details">
                                <div class="mono-label">${escapeHtml(r.property_name || 'Cơ sở')}</div>
                                <div>Loại: ${escapeHtml(r.room_type || 'Tiêu chuẩn')}</div>
                                ${tenantInfo}
                            </div>
                            <div class="room-price">${formatMoney(r.base_price)} / tháng</div>
                            ${actionBtn}
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (err) {
        console.error("Lỗi tải danh sách phòng:", err);
    }
}

function openAssignModalForTenant(tenantId, tenantName) {
    populateAssignModalDropdowns();
    const selTenant = document.getElementById('assign-tenant-id');
    if (selTenant) selTenant.value = tenantId;
    openModal('modal-assign-room');
}

function openAssignModalForRoom(roomId, roomNumber, basePrice) {
    populateAssignModalDropdowns();
    const selRoom = document.getElementById('assign-room-id');
    if (selRoom) {
        selRoom.value = roomId;
        document.getElementById('assign-monthly-rent').value = basePrice;
        document.getElementById('assign-deposit').value = basePrice;
    }
    openModal('modal-assign-room');
}

function populateAssignModalDropdowns() {
    const selTenant = document.getElementById('assign-tenant-id');
    if (selTenant) {
        const unassigned = allTenantsData.filter(t => t.assignment_status === 'Chờ xếp phòng');
        const assigned = allTenantsData.filter(t => t.assignment_status !== 'Chờ xếp phòng');
        
        let html = `<option value="">-- Chọn khách thuê --</option>`;
        if (unassigned.length > 0) {
            html += `<optgroup label="Khách chờ xếp phòng:">`;
            unassigned.forEach(t => {
                html += `<option value="${t.id}">${t.full_name} (@${t.username}) - ${t.phone || 'Chưa SĐT'}</option>`;
            });
            html += `</optgroup>`;
        }
        if (assigned.length > 0) {
            html += `<optgroup label="Khách đã có phòng:">`;
            assigned.forEach(t => {
                html += `<option value="${t.id}">${t.full_name} (@${t.username})</option>`;
            });
            html += `</optgroup>`;
        }
        selTenant.innerHTML = html;
    }

    const selRoom = document.getElementById('assign-room-id');
    if (selRoom) {
        if (availableRoomsData.length === 0) {
            selRoom.innerHTML = `<option value="">-- Hiện không có phòng trống --</option>`;
        } else {
            selRoom.innerHTML = `<option value="">-- Chọn phòng còn trống --</option>` +
                availableRoomsData.map(r => `
                    <option value="${r.id}" data-price="${r.base_price}">
                        Phòng ${r.room_number} (${r.property_name}) - ${formatMoney(r.base_price)}/tháng
                    </option>
                `).join('');
        }
    }
}

function handleSelectAssignRoom(event) {
    const opt = event.target.selectedOptions[0];
    if (!opt || !opt.dataset.price) return;
    const price = parseFloat(opt.dataset.price) || 0;
    document.getElementById('assign-monthly-rent').value = price;
    document.getElementById('assign-deposit').value = price;
}

async function handleConfirmAssignRoom(event) {
    event.preventDefault();
    const tenant_id = parseInt(document.getElementById('assign-tenant-id').value);
    const room_id = parseInt(document.getElementById('assign-room-id').value);
    const start_date = document.getElementById('assign-start-date').value;
    const end_date = document.getElementById('assign-end-date').value;
    const monthly_rent = parseFloat(document.getElementById('assign-monthly-rent').value);
    const deposit_amount = parseFloat(document.getElementById('assign-deposit').value);
    const electricity_rate = parseFloat(document.getElementById('assign-elec-rate').value) || 3500;
    const water_rate = parseFloat(document.getElementById('assign-water-rate').value) || 25000;

    if (!tenant_id || !room_id || !start_date || !monthly_rent) {
        alert("⚠️ Vui lòng điền đầy đủ người thuê, phòng, ngày bắt đầu và giá thuê!");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/tenants/${tenant_id}/assign`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                room_id,
                start_date,
                end_date,
                monthly_rent,
                deposit_amount,
                electricity_rate,
                water_rate
            })
        });
        const data = await res.json();

        if (data.success) {
            alert(`✅ ${data.message}`);
            showToast('✅ Đã xếp phòng và lập hợp đồng thành công!');
            closeModal('modal-assign-room');
            await loadAdminData();
        } else {
            alert(`❌ Không thể xếp phòng: ${data.message}`);
        }
    } catch (err) {
        console.error("Lỗi xếp phòng:", err);
        alert("❌ Lỗi kết nối tới máy chủ.");
    }
}

// ------------------------------------------------------------------------------
// 5. MODULE 2: DANH SÁCH CƯ DÂN & NÚT XÓA MÀU ĐỎ VIỀN 1PX
// ------------------------------------------------------------------------------
async function loadTenantsList() {
    const tbody = document.getElementById('table-admin-tenants');
    const badge = document.getElementById('badge-tenant-count');
    try {
        const res = await fetch(`${API_BASE}/landlord/tenants`);
        const data = await res.json();
        const tenants = data.data || [];
        allTenantsData = tenants;
        if (badge) badge.textContent = `${tenants.length} người thuê`;

        if (tenants.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted p-3">Chưa có người thuê nào trong hệ thống.</td></tr>`;
            return;
        }

        tbody.innerHTML = tenants.map(t => {
            const isPending = (t.assignment_status === 'Chờ xếp phòng');
            const statusBadge = isPending 
                ? `<span class="badge badge-warning">⏳ Chờ xếp phòng</span>` 
                : `<span class="badge badge-success">✅ Đã có phòng</span>`;

            const roomDisplay = t.room_number 
                ? `<strong>Phòng ${escapeHtml(t.room_number)}</strong> (${escapeHtml(t.property_name || '')})` 
                : `<span class="text-muted font-italic">Chưa xếp phòng</span>`;

            const assignBtn = isPending
                ? `<button class="btn btn-primary btn-sm" onclick="openAssignModalForTenant(${t.id}, '${escapeHtml(t.full_name)}')">[ XẾP PHÒNG ]</button>`
                : `<span class="mono-label text-muted" style="margin-right: 8px;">HĐ #${t.contract_id || 'OK'}</span>`;

            // Nút "Xóa người thuê" màu đỏ (viền 1px) theo yêu cầu đặc tả
            const deleteBtn = `<button class="btn btn-danger-outline btn-sm" onclick="handleDeleteTenant(${t.id}, '${escapeHtml(t.full_name)}', '${escapeHtml(t.room_number || '')}')" title="Xóa người thuê và giải phóng phòng">[ ✕ XÓA ]</button>`;

            return `
                <tr>
                    <td><strong class="font-mono">#${t.id}</strong></td>
                    <td><strong>${escapeHtml(t.full_name)}</strong></td>
                    <td><code>${escapeHtml(t.username)}</code></td>
                    <td><span class="font-mono">${escapeHtml(t.phone || 'Chưa cập nhật')}</span></td>
                    <td>${roomDisplay}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <div style="display: flex; gap: 6px; align-items: center;">
                            ${assignBtn}
                            ${deleteBtn}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-danger p-3">Lỗi tải danh sách người thuê: ${err.message}</td></tr>`;
    }
}

// Xử lý Xóa người thuê an toàn kèm xác nhận
async function handleDeleteTenant(tenantId, tenantName, roomNumber) {
    const roomMsg = roomNumber ? ` đang thuê phòng ${roomNumber}` : '';
    const isConfirmed = confirm(
        `⚠️ CẢNH BÁO BẢO TOÀN DỮ LIỆU:\n` +
        `Bạn có chắc chắn muốn xóa Người thuê: "${tenantName}"${roomMsg} không?\n\n` +
        `Hành động này sẽ:\n` +
        `- Hủy hợp đồng thuê và trả phòng về trạng thái TRỐNG (Available).\n` +
        `- Xóa toàn bộ hóa đơn, sự cố và thông báo liên quan đến người này.\n\n` +
        `Bấm OK để thực hiện xóa an toàn.`
    );

    if (!isConfirmed) return;

    try {
        const res = await fetch(`${API_BASE}/tenants/${tenantId}`, {
            method: 'DELETE'
        });
        const data = await res.json();

        if (data.success) {
            alert(`✅ ${data.message}`);
            showToast(`✅ Đã xóa người thuê ${tenantName} thành công`);
            await loadAdminData();
        } else {
            alert(`❌ Không thể xóa người thuê: ${data.message}`);
        }
    } catch (err) {
        console.error("Lỗi xóa người thuê:", err);
        alert("❌ Lỗi kết nối tới máy chủ.");
    }
}

// ------------------------------------------------------------------------------
// 6. MODULE 3: QUẢN LÝ TÀI CHÍNH & HÓA ĐƠN (SEARCH, FILTER & CẢNH BÁO ĐỎ QUÁ HẠN)
// ------------------------------------------------------------------------------
function debounceFilterInvoices() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        applyInvoiceFilters();
    }, 350);
}

async function applyInvoiceFilters() {
    const tbody = document.getElementById('table-admin-finance-invoices');
    if (!tbody) return;

    const search = document.getElementById('filter-invoice-search')?.value.trim() || '';
    const status = document.getElementById('filter-invoice-status')?.value || 'All';
    const month = document.getElementById('filter-invoice-month')?.value || '';

    // Xây dựng query params gửi xuống API để chứng minh lệnh SELECT ... WHERE ...
    const params = new URLSearchParams();
    if (status && status !== 'All') params.append('status', status);
    if (search) params.append('search', search);
    if (month) params.append('month', month);

    try {
        const [invRes, conRes] = await Promise.all([
            fetch(`${API_BASE}/invoices?${params.toString()}`),
            fetch(`${API_BASE}/contracts`)
        ]);

        const invData = await invRes.json();
        const conData = await conRes.json();

        allInvoicesData = invData.data || [];
        activeContractsData = conData.data || [];

        // Tính toán chỉ số tài chính
        let totalRevenue = 0;
        let totalPaid = 0;
        let totalUnpaid = 0;

        allInvoicesData.forEach(inv => {
            const amt = parseFloat(inv.total_amount) || 0;
            totalRevenue += amt;
            if (inv.status === 'Paid') totalPaid += amt;
            else totalUnpaid += amt;
        });

        document.getElementById('stat-finance-total').textContent = formatMoney(totalRevenue);
        document.getElementById('stat-finance-paid').textContent = formatMoney(totalPaid);
        document.getElementById('stat-finance-unpaid').textContent = formatMoney(totalUnpaid);
        document.getElementById('stat-finance-count').textContent = allInvoicesData.length;

        if (allInvoicesData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="12" class="text-center text-muted p-4">Không tìm thấy hóa đơn nào phù hợp với bộ lọc hiện tại.</td></tr>`;
            return;
        }

        tbody.innerHTML = allInvoicesData.map(inv => {
            const isOverdue = (inv.status === 'Overdue');
            const isPaid = (inv.status === 'Paid');
            const isPartial = (inv.status === 'Partially Paid');

            // ĐIỀU KIỆN QUAN TRỌNG: Nếu trạng thái là 'Quá hạn' (Overdue), dòng phải hiện viền/màu đỏ cảnh báo
            const rowClass = isOverdue ? 'class="row-overdue"' : '';

            let statusBadge = `<span class="badge badge-warning">! CHƯA THU</span>`;
            if (isPaid) statusBadge = `<span class="badge badge-success">✓ ĐÃ HOÀN TẤT</span>`;
            else if (isPartial) statusBadge = `<span class="badge badge-primary">⚡ ĐÓNG MỘT PHẦN</span>`;
            else if (isOverdue) statusBadge = `<span class="badge badge-danger">🚨 QUÁ HẠN</span>`;

            const eUsage = inv.electricity_usage || Math.max(0, (inv.electricity_end || 0) - (inv.electricity_start || 0));
            const wUsage = inv.water_usage || Math.max(0, (inv.water_end || 0) - (inv.water_start || 0));
            const trashWifi = (inv.trash_cost || 50000) + (inv.wifi_cost || 100000);

            // Nút "Xác nhận thu tiền"
            const payBtn = isPaid 
                ? `<button class="btn btn-outline btn-sm" onclick="handleTogglePayment(${inv.id}, 'Unpaid')">[ HỦY THU ]</button>`
                : `<button class="btn btn-primary btn-sm" onclick="handleTogglePayment(${inv.id}, 'Paid')">[ ✓ THU TIỀN ]</button>`;

            // Nút "Gửi nhắc nhở"
            const remindBtn = `<button class="btn btn-outline btn-sm" onclick="openQuickReminderModal(${inv.id}, '${escapeHtml(inv.tenant_name)}', '${escapeHtml(inv.room_number)}', '${escapeHtml(inv.invoice_month)}', ${inv.total_amount})" title="Gửi nhắc nhở xuống Cổng người thuê">[ 📢 NHẮC NỢ ]</button>`;

            // Nút "Xem chi tiết" (mở modal bóc tách tiền)
            const detailBtn = `<button class="btn btn-outline btn-sm" onclick="showInvoiceDetail(${inv.id})" title="Xem chi tiết bóc tách">[ 🔍 CHI TIẾT ]</button>`;

            return `
                <tr ${rowClass}>
                    <td><strong class="font-mono">#${inv.id}</strong></td>
                    <td><strong>Phòng ${escapeHtml(inv.room_number || '')}</strong><br><small class="text-muted">${escapeHtml(inv.property_name || '')}</small></td>
                    <td><strong>${escapeHtml(inv.tenant_name || '')}</strong></td>
                    <td><code class="font-mono">${escapeHtml(inv.invoice_month)}</code></td>
                    <td class="font-mono">${formatMoney(inv.room_rent)}</td>
                    <td>
                        <span class="font-mono">${eUsage.toFixed(1)} kWh</span><br>
                        <small>${formatMoney(inv.electricity_cost)}</small>
                    </td>
                    <td>
                        <span class="font-mono">${wUsage.toFixed(1)} m³</span><br>
                        <small>${formatMoney(inv.water_cost)}</small>
                    </td>
                    <td>
                        <small class="font-mono">${formatMoney(trashWifi)}</small>
                    </td>
                    <td><strong class="font-mono" style="font-size: 0.95rem;">${formatMoney(inv.total_amount)}</strong></td>
                    <td><small class="font-mono">${escapeHtml(inv.due_date || '')}</small></td>
                    <td>${statusBadge}</td>
                    <td style="white-space: nowrap;">
                        <div style="display: flex; gap: 4px;">
                            ${payBtn}
                            ${remindBtn}
                            ${detailBtn}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        populateCreateInvoiceDropdown();
    } catch (err) {
        console.error("Lỗi áp dụng bộ lọc hóa đơn:", err);
    }
}

// Xem chi tiết bóc tách hóa đơn trong Modal
function showInvoiceDetail(invoiceId) {
    const inv = allInvoicesData.find(i => i.id === invoiceId);
    if (!inv) return;

    const eUsage = inv.electricity_usage || Math.max(0, (inv.electricity_end || 0) - (inv.electricity_start || 0));
    const wUsage = inv.water_usage || Math.max(0, (inv.water_end || 0) - (inv.water_start || 0));
    const trash = inv.trash_cost || inv.tien_rac || 50000;
    const wifi = inv.wifi_cost || 100000;
    const service = inv.service_cost || 0;

    document.getElementById('inv-detail-title').textContent = `Bóc Tách Hóa Đơn #${inv.id} - Phòng ${inv.room_number}`;
    document.getElementById('inv-detail-content').innerHTML = `
        <div style="background: #ffffff; border: 1px solid var(--border); padding: 18px; border-radius: 2px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span class="mono-label">KHÁCH THUÊ:</span>
                <strong>${escapeHtml(inv.tenant_name)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span class="mono-label">KỲ HÓA ĐƠN:</span>
                <span class="font-mono">Tháng ${escapeHtml(inv.invoice_month)} (Hạn: ${escapeHtml(inv.due_date)})</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span class="mono-label">TRẠNG THÁI:</span>
                <span class="badge ${inv.status === 'Paid' ? 'badge-success' : (inv.status === 'Overdue' ? 'badge-danger' : 'badge-warning')}">${inv.status}</span>
            </div>
        </div>

        <div class="utility-preview-box">
            <div class="utility-preview-row">
                <span>1. Tiền thuê phòng trọ:</span>
                <strong>${formatMoney(inv.room_rent)}</strong>
            </div>
            <div class="utility-preview-row">
                <span>2. Tiền điện (${inv.electricity_start} ➔ ${inv.electricity_end} = ${eUsage.toFixed(1)} kWh x 3.500đ):</span>
                <strong>${formatMoney(inv.electricity_cost)}</strong>
            </div>
            <div class="utility-preview-row">
                <span>3. Tiền nước (${inv.water_start} ➔ ${inv.water_end} = ${wUsage.toFixed(1)} m³ x 25.000đ):</span>
                <strong>${formatMoney(inv.water_cost)}</strong>
            </div>
            <div class="utility-preview-row">
                <span>4. Tiền rác vệ sinh môi trường:</span>
                <strong>${formatMoney(trash)}</strong>
            </div>
            <div class="utility-preview-row">
                <span>5. Tiền mạng Internet / Wifi:</span>
                <strong>${formatMoney(wifi)}</strong>
            </div>
            ${service > 0 ? `
            <div class="utility-preview-row">
                <span>6. Chi phí dịch vụ khác:</span>
                <strong>${formatMoney(service)}</strong>
            </div>` : ''}
            <div class="utility-preview-row utility-preview-total">
                <span>TỔNG TIỀN PHẢI THANH TOÁN:</span>
                <strong style="font-size: 1.15rem; color: var(--text);">${formatMoney(inv.total_amount)}</strong>
            </div>
        </div>
    `;

    openModal('modal-invoice-detail');
}

// Mở modal nhắc nợ nhanh
function openQuickReminderModal(invoiceId, tenantName, roomNumber, month, totalAmount) {
    const selTarget = document.getElementById('notice-tenant-target');
    if (selTarget) {
        // Tìm tenant_id
        const inv = allInvoicesData.find(i => i.id === invoiceId);
        // Nạp danh sách tenant vào dropdown
        populateNoticeTenantDropdown();
        if (inv) selTarget.value = inv.tenant_id || '';
    }

    document.getElementById('notice-type-select').value = 'PaymentReminder';
    document.getElementById('notice-title-input').value = `Nhắc nhở đóng tiền trọ Tháng ${month} - Phòng ${roomNumber}`;
    document.getElementById('notice-content-input').value = `Chào bạn ${tenantName}, hóa đơn tiền phòng & điện nước tháng ${month} của phòng ${roomNumber} hiện có tổng tiền là ${formatMoney(totalAmount)}. Quý khách vui lòng quét mã QR trên cổng cư dân để hoàn tất thanh toán trước hạn.`;

    openModal('modal-send-notice');
}

async function handleTogglePayment(invoiceId, newStatus) {
    try {
        const res = await fetch(`${API_BASE}/invoices/${invoiceId}/pay`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`✅ ${data.message}`);
            await applyInvoiceFilters();
            await loadUtilityModule();
        } else {
            alert(`❌ Không thể cập nhật: ${data.message}`);
        }
    } catch (err) {
        alert("❌ Lỗi kết nối tới máy chủ.");
    }
}

function populateCreateInvoiceDropdown() {
    const sel = document.getElementById('create-inv-contract-id');
    if (!sel) return;

    if (activeContractsData.length === 0) {
        sel.innerHTML = `<option value="">-- Chưa có hợp đồng thuê hoạt động --</option>`;
        return;
    }

    sel.innerHTML = `<option value="">-- Chọn hợp đồng cần lập hóa đơn --</option>` +
        activeContractsData.map(c => `
            <option value="${c.id}" data-rent="${c.monthly_rent}" data-room="${c.room_number}" data-tenant="${c.tenant_name}">
                Phòng ${c.room_number} (${c.property_name}) - Khách: ${c.tenant_name} (${formatMoney(c.monthly_rent)}/tháng)
            </option>
        `).join('');
}

function handleSelectInvoiceContract(event) {
    const opt = event.target.selectedOptions[0];
    if (!opt || !opt.dataset.rent) return;
    const rent = parseFloat(opt.dataset.rent) || 0;
    document.getElementById('create-inv-rent').value = rent;
    calculateCustomInvoiceTotal();
}

function calculateCustomInvoiceTotal() {
    const rent = parseFloat(document.getElementById('create-inv-rent').value) || 0;
    const service = parseFloat(document.getElementById('create-inv-service').value) || 0;
    const elec = parseFloat(document.getElementById('create-inv-elec-cost').value) || 0;
    const water = parseFloat(document.getElementById('create-inv-water-cost').value) || 0;
    const trash = parseFloat(document.getElementById('create-inv-trash').value) || 50000;
    const wifi = parseFloat(document.getElementById('create-inv-wifi').value) || 100000;
    const total = rent + service + elec + water + trash + wifi;
    document.getElementById('create-inv-total-preview').textContent = formatMoney(total);
}

async function handleCreateInvoiceSubmit(event) {
    event.preventDefault();
    const contract_id = parseInt(document.getElementById('create-inv-contract-id').value);
    const invoice_month = document.getElementById('create-inv-month').value.trim();
    const due_date = document.getElementById('create-inv-due-date').value.trim();
    const room_rent = parseFloat(document.getElementById('create-inv-rent').value) || 0;
    const service_cost = parseFloat(document.getElementById('create-inv-service').value) || 0;
    const electricity_cost = parseFloat(document.getElementById('create-inv-elec-cost').value) || 0;
    const water_cost = parseFloat(document.getElementById('create-inv-water-cost').value) || 0;
    const trash_cost = parseFloat(document.getElementById('create-inv-trash').value) || 50000;
    const wifi_cost = parseFloat(document.getElementById('create-inv-wifi').value) || 100000;
    const total_amount = room_rent + service_cost + electricity_cost + water_cost + trash_cost + wifi_cost;

    if (!contract_id || !invoice_month || !due_date) {
        alert("⚠️ Vui lòng chọn hợp đồng, kỳ hóa đơn và hạn đóng tiền!");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/invoices/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contract_id,
                invoice_month,
                due_date,
                room_rent,
                service_cost,
                electricity_cost,
                water_cost,
                trash_cost,
                wifi_cost,
                total_amount
            })
        });
        const data = await res.json();

        if (data.success) {
            alert(`✅ ${data.message}\nTổng tiền: ${formatMoney(total_amount)}`);
            showToast('✅ Đã xuất hóa đơn tài chính thành công!');
            closeModal('modal-create-invoice');
            await applyInvoiceFilters();
            await loadUtilityModule();
        } else {
            alert(`❌ Không thể tạo hóa đơn: ${data.message}`);
        }
    } catch (err) {
        console.error("Lỗi xuất hóa đơn:", err);
        alert("❌ Lỗi kết nối tới máy chủ.");
    }
}

// ------------------------------------------------------------------------------
// 7. MODULE 4: BẢNG TIN & THÔNG BÁO (NOTICES)
// ------------------------------------------------------------------------------
async function loadNoticesList() {
    const box = document.getElementById('admin-notices-container');
    if (!box) return;

    try {
        const res = await fetch(`${API_BASE}/notices`);
        const data = await res.json();
        const list = data.data || [];

        populateNoticeTenantDropdown();

        if (list.length === 0) {
            box.innerHTML = `<p class="text-muted p-3">Chưa có thông báo nào được đăng trên bảng tin.</p>`;
            return;
        }

        box.innerHTML = list.map(n => {
            const isReminder = (n.notice_type === 'PaymentReminder');
            const isMaint = (n.notice_type === 'Maintenance');
            let itemClass = '';
            let typeBadge = `<span class="badge badge-primary">📢 THÔNG BÁO CHUNG</span>`;

            if (isReminder) {
                itemClass = 'notice-reminder';
                typeBadge = `<span class="badge badge-danger">🚨 NHẮC NỢ / TIỀN PHÒNG</span>`;
            } else if (isMaint) {
                itemClass = 'notice-maintenance';
                typeBadge = `<span class="badge badge-warning">🛠️ BẢO TRÌ SỬA CHỮA</span>`;
            }

            const targetDisplay = n.target_tenant_name 
                ? `<span>Gửi riêng cho: <strong>${escapeHtml(n.target_tenant_name)}</strong></span>` 
                : `<span class="text-muted">Gửi tới: Tất cả cư dân</span>`;

            return `
                <div class="notice-item ${itemClass}">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                        <div>
                            ${typeBadge}
                            <strong style="font-size: 1rem; margin-left: 8px;">${escapeHtml(n.title)}</strong>
                        </div>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <small class="font-mono text-muted">${escapeHtml(n.created_at || '')}</small>
                            <button class="btn btn-danger-outline btn-sm" onclick="handleDeleteNotice(${n.id})" title="Xóa thông báo">[ XÓA ]</button>
                        </div>
                    </div>
                    <p style="font-size: 0.9rem; line-height: 1.6; margin-bottom: 8px;">${escapeHtml(n.content)}</p>
                    <div style="font-size: 0.8rem; display: flex; justify-content: space-between;">
                        ${targetDisplay}
                        <span class="text-muted">Người đăng: ${escapeHtml(n.author_name || 'Ban quản lý')}</span>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        box.innerHTML = `<p class="text-danger p-3">Lỗi tải thông báo: ${err.message}</p>`;
    }
}

function populateNoticeTenantDropdown() {
    const sel = document.getElementById('notice-tenant-target');
    if (!sel) return;

    let html = `<option value="">📢 Tất cả cư dân (Thông báo chung)</option>`;
    if (allTenantsData && allTenantsData.length > 0) {
        html += `<optgroup label="Gửi riêng cho từng người thuê:">`;
        allTenantsData.forEach(t => {
            const roomTxt = t.room_number ? ` - Phòng ${t.room_number}` : '';
            html += `<option value="${t.id}">${t.full_name} (@${t.username})${roomTxt}</option>`;
        });
        html += `</optgroup>`;
    }
    sel.innerHTML = html;
}

async function handleSendNoticeSubmit(event) {
    event.preventDefault();
    const tenant_id = document.getElementById('notice-tenant-target').value;
    const notice_type = document.getElementById('notice-type-select').value;
    const title = document.getElementById('notice-title-input').value.trim();
    const content = document.getElementById('notice-content-input').value.trim();

    if (!title || !content) {
        alert("⚠️ Vui lòng nhập tiêu đề và nội dung thông báo!");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/notices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenant_id: tenant_id || null,
                notice_type,
                title,
                content
            })
        });
        const data = await res.json();

        if (data.success) {
            showToast('✅ Đã phát thông báo thành công!');
            closeModal('modal-send-notice');
            document.getElementById('notice-title-input').value = '';
            document.getElementById('notice-content-input').value = '';
            await loadNoticesList();
        } else {
            alert(`❌ Không thể gửi thông báo: ${data.message}`);
        }
    } catch (err) {
        alert("❌ Lỗi kết nối tới máy chủ.");
    }
}

async function handleDeleteNotice(noticeId) {
    if (!confirm("Bạn có chắc chắn muốn xóa thông báo này không?")) return;
    try {
        const res = await fetch(`${API_BASE}/notices/${noticeId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Đã xóa thông báo thành công');
            await loadNoticesList();
        }
    } catch (err) {
        alert("❌ Lỗi khi xóa thông báo.");
    }
}

// ------------------------------------------------------------------------------
// 8. MODULE 5: GHI CHỈ SỐ ĐIỆN NƯỚC
// ------------------------------------------------------------------------------
async function loadUtilityModule() {
    try {
        const res = await fetch(`${API_BASE}/invoices/utility-rooms`);
        const data = await res.json();
        utilityRoomsData = data.data || [];

        const select = document.getElementById('util-contract-id');
        if (select) {
            select.innerHTML = `<option value="">-- Chọn phòng cần ghi số --</option>` +
                utilityRoomsData.map(r => `
                    <option value="${r.contract_id}" 
                            data-rent="${r.monthly_rent}"
                            data-elec-rate="${r.electricity_rate}"
                            data-water-rate="${r.water_rate}"
                            data-last-elec="${r.last_electricity_end || 0}"
                            data-last-water="${r.last_water_end || 0}">
                        Phòng ${r.room_number} (${r.property_name}) - Khách: ${r.tenant_name}
                    </option>
                `).join('');
        }
    } catch (err) {
        console.error("Lỗi tải danh sách phòng điện nước:", err);
    }

    await loadAdminInvoicesList();
}

function handleSelectRoomUtility(event) {
    const opt = event.target.selectedOptions[0];
    if (!opt || !opt.value) return;

    const lastElec = parseFloat(opt.dataset.lastElec) || 0;
    const lastWater = parseFloat(opt.dataset.lastWater) || 0;
    const elecRate = parseFloat(opt.dataset.elecRate) || 3500;
    const waterRate = parseFloat(opt.dataset.waterRate) || 25000;

    document.getElementById('util-elec-rate').textContent = `Đơn giá: ${formatMoney(elecRate)}/kWh`;
    document.getElementById('util-water-rate').textContent = `Đơn giá: ${formatMoney(waterRate)}/m³`;

    document.getElementById('util-elec-start').value = lastElec;
    document.getElementById('util-elec-end').value = lastElec;
    document.getElementById('util-water-start').value = lastWater;
    document.getElementById('util-water-end').value = lastWater;

    calculateUtilityPreview();
}

function calculateUtilityPreview() {
    const select = document.getElementById('util-contract-id');
    const opt = select ? select.selectedOptions[0] : null;

    const roomRent = opt ? (parseFloat(opt.dataset.rent) || 0) : 0;
    const elecRate = opt ? (parseFloat(opt.dataset.elecRate) || 3500) : 3500;
    const waterRate = opt ? (parseFloat(opt.dataset.waterRate) || 25000) : 25000;

    const eStart = parseFloat(document.getElementById('util-elec-start').value) || 0;
    const eEnd = parseFloat(document.getElementById('util-elec-end').value) || 0;
    const wStart = parseFloat(document.getElementById('util-water-start').value) || 0;
    const wEnd = parseFloat(document.getElementById('util-water-end').value) || 0;
    const trash = parseFloat(document.getElementById('util-trash-cost').value) || 50000;
    const wifi = parseFloat(document.getElementById('util-wifi-cost').value) || 100000;

    const eUsage = Math.max(0, eEnd - eStart);
    const eCost = eUsage * elecRate;
    const wUsage = Math.max(0, wEnd - wStart);
    const wCost = wUsage * waterRate;
    const totalAmount = roomRent + eCost + wCost + trash + wifi;

    document.getElementById('preview-room-rent').textContent = formatMoney(roomRent);
    document.getElementById('preview-elec-cost').textContent = `${formatMoney(eCost)} (${eUsage.toFixed(1)} kWh)`;
    document.getElementById('preview-water-cost').textContent = `${formatMoney(wCost)} (${wUsage.toFixed(1)} m³)`;
    document.getElementById('preview-trash-cost').textContent = formatMoney(trash);
    document.getElementById('preview-wifi-cost').textContent = formatMoney(wifi);
    document.getElementById('preview-total-amount').textContent = formatMoney(totalAmount);
}

async function handleSaveUtility(event) {
    event.preventDefault();
    const contract_id = parseInt(document.getElementById('util-contract-id').value);
    const invoice_month = document.getElementById('util-month').value;
    const due_date = document.getElementById('util-due-date').value;
    const electricity_start = parseFloat(document.getElementById('util-elec-start').value) || 0;
    const electricity_end = parseFloat(document.getElementById('util-elec-end').value) || 0;
    const water_start = parseFloat(document.getElementById('util-water-start').value) || 0;
    const water_end = parseFloat(document.getElementById('util-water-end').value) || 0;
    const trash_cost = parseFloat(document.getElementById('util-trash-cost').value) || 50000;
    const wifi_cost = parseFloat(document.getElementById('util-wifi-cost').value) || 100000;

    if (!contract_id || !invoice_month || !due_date) {
        alert("⚠️ Vui lòng điền đủ thông tin phòng, kỳ hóa đơn và hạn đóng tiền!");
        return;
    }

    if (electricity_end < electricity_start) {
        alert("⚠️ Số điện cuối không được nhỏ hơn số điện đầu!");
        return;
    }
    if (water_end < water_start) {
        alert("⚠️ Số nước cuối không được nhỏ hơn số nước đầu!");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/invoices/utility`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contract_id,
                invoice_month,
                due_date,
                electricity_start,
                electricity_end,
                water_start,
                water_end,
                trash_cost,
                wifi_cost,
                service_cost: 0
            })
        });
        const data = await res.json();

        if (data.success) {
            alert(`✅ Đã xuất hóa đơn điện nước tháng ${invoice_month} thành công!\nTổng tiền: ${formatMoney(data.invoice.total_amount)}`);
            showToast('✅ Đã lưu chỉ số điện nước thành công');
            await loadUtilityModule();
            await applyInvoiceFilters();
        } else {
            alert(`❌ Lỗi xuất hóa đơn: ${data.message}`);
        }
    } catch (err) {
        console.error("Lỗi lưu điện nước:", err);
        alert("❌ Lỗi kết nối tới máy chủ.");
    }
}

async function loadAdminInvoicesList() {
    const tbody = document.getElementById('table-admin-invoices');
    if (!tbody) return;

    try {
        const res = await fetch(`${API_BASE}/invoices`);
        const data = await res.json();
        const list = data.data || [];

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted p-3">Chưa có hóa đơn nào được lập.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(inv => {
            const eUsage = inv.electricity_usage || Math.max(0, (inv.electricity_end || 0) - (inv.electricity_start || 0));
            const wUsage = inv.water_usage || Math.max(0, (inv.water_end || 0) - (inv.water_start || 0));
            const statusBadge = inv.status === 'Paid' 
                ? `<span class="badge badge-success">✓ Đã thu</span>` 
                : (inv.status === 'Overdue' ? `<span class="badge badge-danger">🚨 Quá hạn</span>` : `<span class="badge badge-warning">! Chưa thu</span>`);

            return `
                <tr>
                    <td><strong>Phòng ${escapeHtml(inv.room_number || '')}</strong></td>
                    <td><code>${escapeHtml(inv.invoice_month)}</code></td>
                    <td>
                        <span class="font-mono">${inv.electricity_start} ➔ ${inv.electricity_end} (${eUsage.toFixed(1)} kWh)</span><br>
                        <strong>${formatMoney(inv.electricity_cost)}</strong>
                    </td>
                    <td>
                        <span class="font-mono">${inv.water_start} ➔ ${inv.water_end} (${wUsage.toFixed(1)} m³)</span><br>
                        <strong>${formatMoney(inv.water_cost)}</strong>
                    </td>
                    <td><strong class="font-mono">${formatMoney(inv.total_amount)}</strong></td>
                    <td>${statusBadge}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-danger p-3">Lỗi tải danh sách hóa đơn.</td></tr>`;
    }
}

// ------------------------------------------------------------------------------
// 9. MODULE 6: PHẢN ÁNH & SỰ CỐ
// ------------------------------------------------------------------------------
async function loadMaintenanceList() {
    const tbody = document.getElementById('table-admin-maintenance');
    const badge = document.getElementById('badge-maint-count');
    try {
        const landlordId = currentAdmin ? currentAdmin.id : 1;
        const res = await fetch(`${API_BASE}/landlord/${landlordId}/maintenance`);
        const data = await res.json();
        const list = data.data || [];
        if (badge) badge.textContent = `${list.length} sự cố`;

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted p-3">Hiện không có phản ánh sự cố nào.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(m => {
            const status = m.status || 'Pending';
            let badgeClass = 'badge-danger';
            if (status === 'In Progress') badgeClass = 'badge-warning';
            else if (status === 'Completed') badgeClass = 'badge-success';

            return `
                <tr>
                    <td><strong class="font-mono">#${m.id}</strong></td>
                    <td><strong>Phòng ${escapeHtml(m.room_number || 'N/A')}</strong></td>
                    <td>${escapeHtml(m.property_name || 'Cơ sở')}</td>
                    <td>
                        <strong>${escapeHtml(m.title || '')}</strong>
                        <div class="text-muted small">${escapeHtml(m.issue_description || m.description || '')}</div>
                    </td>
                    <td>
                        <strong>${escapeHtml(m.tenant_name || '')}</strong><br>
                        <small class="font-mono text-muted">${escapeHtml(m.tenant_phone || '')}</small>
                    </td>
                    <td><small class="font-mono">${escapeHtml(m.created_at || m.reported_at || '')}</small></td>
                    <td><span class="badge ${badgeClass}">${status}</span></td>
                    <td>
                        <select class="form-control" style="min-width: 140px; font-size: 0.8rem; padding: 4px 8px;" onchange="handleUpdateMaintenanceStatus(${m.id}, this.value)">
                            <option value="Pending" ${status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
                            <option value="In Progress" ${status === 'In Progress' ? 'selected' : ''}>⚙️ In Progress</option>
                            <option value="Completed" ${status === 'Completed' ? 'selected' : ''}>✅ Completed</option>
                        </select>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-danger p-3">Lỗi tải phản ánh sự cố.</td></tr>`;
    }
}

async function handleUpdateMaintenanceStatus(issueId, newStatus) {
    try {
        const res = await fetch(`${API_BASE}/maintenance/${issueId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();

        if (data.success) {
            showToast(`✅ Đã chuyển trạng thái sang ${newStatus}`);
            await loadMaintenanceList();
        } else {
            alert(`❌ Không thể cập nhật: ${data.message}`);
        }
    } catch (err) {
        alert("❌ Lỗi kết nối tới máy chủ.");
    }
}

// ------------------------------------------------------------------------------
// 10. MODAL & UTILITY HELPERS
// ------------------------------------------------------------------------------
function openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove('hidden');
}

function closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('hidden');
}

function formatMoney(amount) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount || 0);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg) {
    const box = document.getElementById('toast-container');
    if (!box) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    box.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// Khởi tạo kiểm tra phiên đăng nhập
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch(`${API_BASE}/auth/me`);
        const data = await res.json();
        if (data.authenticated && data.user && data.user.role === 'landlord') {
            currentAdmin = data.user;
            showAdminDashboardUI();
            await loadAdminData();
        }
    } catch (_) {}
});
