// ==============================================================================
// RENTMASTER TENANT LOGIC (tenant.js)
// Aesthetic: Paper-White Minimalist (#efece6, IBM Plex Mono, Schibsted Grotesk)
// API Base: Tự động thích ứng (Localhost, Ngrok HTTPS hoặc Live Server)
// ==============================================================================

// Tự động nhận diện môi trường:
// 1. Chạy chuẩn qua Flask / Ngrok / Domain: dùng relative path '/api' (an toàn HTTPS, không lo Mixed Content)
// 2. Chạy qua Live Server (cổng 5500, 3000) hoặc file://: fallback sang 'http://127.0.0.1:5000/api'
const isLiveServer = (window.location.port === '5500' || window.location.port === '3000' || window.location.protocol === 'file:');
const API_BASE = isLiveServer ? 'http://127.0.0.1:5000/api' : '/api';
let currentTenant = null;
let currentContract = null;
let activeInvoice = null;

// 1. CHUYỂN TAB ĐĂNG NHẬP / ĐĂNG KÝ
function switchAuthTab(tab) {
    const isLogin = (tab === 'login');
    document.getElementById('form-login').classList.toggle('hidden', !isLogin);
    document.getElementById('form-register').classList.toggle('hidden', isLogin);
    document.getElementById('tab-btn-login').classList.toggle('active', isLogin);
    document.getElementById('tab-btn-register').classList.toggle('active', !isLogin);
}

// 2. ĐĂNG NHẬP NGƯỜI THUÊ
async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();

    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, portal: 'tenant' })
        });
        const data = await res.json();

        if (res.status === 403) {
            alert("⛔ " + (data.message || "Bạn không có quyền truy cập cổng khách thuê!"));
            return;
        }

        if (data.success && data.user) {
            currentTenant = data.user;
            showPortalUI();
            await loadTenantPortalData();
            showToast(`👋 Chào mừng bạn trở lại, ${currentTenant.full_name}!`);
        } else {
            alert(`❌ Đăng nhập thất bại: ${data.message || 'Sai thông tin đăng nhập'}`);
        }
    } catch (err) {
        console.error("Lỗi đăng nhập:", err);
        alert("❌ Lỗi kết nối tới máy chủ API. Hãy kiểm tra server Flask hoặc đường truyền mạng!");
    }
}

// 3. ĐĂNG KÝ TÀI KHOẢN (BẢO MẬT: BẮT BUỘC ROLE 'TENANT')
async function handleRegister(event) {
    event.preventDefault();
    const full_name = document.getElementById('reg-fullname').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const email = document.getElementById('reg-email').value.trim();

    try {
        const res = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ full_name, username, password, phone, email })
        });
        const data = await res.json();

        if (data.success) {
            alert("✅ Đăng ký tài khoản Người thuê thành công! Vui lòng đăng nhập.");
            switchAuthTab('login');
            document.getElementById('login-username').value = username;
            document.getElementById('login-password').value = password;
        } else {
            alert(`❌ Đăng ký thất bại: ${data.message}`);
        }
    } catch (err) {
        console.error("Lỗi đăng ký:", err);
        alert("❌ Lỗi kết nối tới máy chủ API. Hãy kiểm tra server Flask hoặc đường truyền mạng!");
    }
}

// 4. ĐĂNG XUẤT
document.getElementById('btn-logout')?.addEventListener('click', async () => {
    try {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
    } catch (_) {}
    currentTenant = null;
    document.getElementById('auth-section').classList.remove('hidden');
    document.getElementById('portal-section').classList.add('hidden');
    document.getElementById('header-user-panel').classList.add('hidden');
    showToast('👋 Đã đăng xuất khỏi cổng cư dân.');
});

// 5. HIỂN THỊ GIAO DIỆN SAU KHI ĐĂNG NHẬP
function showPortalUI() {
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('portal-section').classList.remove('hidden');
    document.getElementById('header-user-panel').classList.remove('hidden');
    document.getElementById('user-display-name').textContent = currentTenant.full_name;
    document.getElementById('tenant-name').textContent = currentTenant.full_name;

    // Pre-fill profile info
    const phoneInp = document.getElementById('profile-phone');
    const emailInp = document.getElementById('profile-email');
    if (phoneInp) phoneInp.value = currentTenant.phone || '';
    if (emailInp) emailInp.value = currentTenant.email || '';
}

// 6. TẢI DỮ LIỆU PORTAL
async function loadTenantPortalData() {
    await Promise.all([
        loadContracts(),
        loadNotices(),
        loadInvoices(),
        loadMaintenance()
    ]);
}

// A. Thông tin phòng & hợp đồng
async function loadContracts() {
    const box = document.getElementById('tenant-contract-info');
    const badgeStatus = document.getElementById('badge-contract-status');
    try {
        const res = await fetch(`${API_BASE}/contracts`);
        const data = await res.json();
        const contracts = data.data || [];

        if (contracts.length === 0) {
            currentContract = null;
            if (badgeStatus) badgeStatus.textContent = 'CHỜ XẾP PHÒNG';
            box.innerHTML = `
                <div style="background: #ffffff; border: 1px dashed var(--border); padding: 24px; text-align: center;">
                    <div class="mono-label" style="margin-bottom: 8px;">TRẠNG THÁI HỒ SƠ: ĐANG CHỜ CHỦ TRỌ XẾP PHÒNG</div>
                    <p class="text-muted" style="font-size: 0.9rem;">
                        Tài khoản của bạn đã được lưu trên hệ thống. Chủ nhà trọ đang tiến hành sắp xếp phòng phù hợp cho bạn.<br>
                        Vui lòng liên hệ trực tiếp với quản lý nếu cần nhận phòng gấp.
                    </p>
                </div>
            `;
            return;
        }

        const c = contracts[0];
        currentContract = c;
        if (badgeStatus) badgeStatus.textContent = `HĐ #${c.id} - ${c.status || 'ACTIVE'}`;

        box.innerHTML = `
            <div class="contract-grid">
                <div class="contract-item">
                    <div class="mono-label">PHÒNG ĐANG THUÊ</div>
                    <div class="contract-val text-primary font-mono">PHÒNG ${escapeHtml(c.room_number)}</div>
                </div>
                <div class="contract-item">
                    <div class="mono-label">CƠ SỞ / KHU TRỌ</div>
                    <div class="contract-val" style="font-size: 0.95rem;">${escapeHtml(c.property_name)}</div>
                    <small class="text-muted">${escapeHtml(c.property_address || '')}</small>
                </div>
                <div class="contract-item">
                    <div class="mono-label">THỜI HẠN HỢP ĐỒNG</div>
                    <div class="contract-val font-mono" style="font-size: 0.9rem;">${c.start_date} ➔ ${c.end_date}</div>
                </div>
                <div class="contract-item">
                    <div class="mono-label">TIỀN THUÊ CỐ ĐỊNH</div>
                    <div class="contract-val font-mono">${formatMoney(c.monthly_rent)}/tháng</div>
                </div>
                <div class="contract-item">
                    <div class="mono-label">ĐƠN GIÁ ĐIỆN NƯỚC</div>
                    <div class="contract-val font-mono" style="font-size: 0.85rem;">
                        ⚡ ${formatMoney(c.electricity_rate)}/kWh<br>
                        💧 ${formatMoney(c.water_rate)}/m³
                    </div>
                </div>
                <div class="contract-item">
                    <div class="mono-label">TIỀN CỌC GIỮ PHÒNG</div>
                    <div class="contract-val font-mono">${formatMoney(c.deposit_amount || c.monthly_rent)}</div>
                </div>
            </div>
        `;
    } catch (err) {
        box.innerHTML = `<p class="text-danger p-3">Lỗi tải hợp đồng: ${err.message}</p>`;
    }
}

// B. Bảng tin thông báo & nhắc nhở từ chủ trọ (Notice Board)
async function loadNotices() {
    const box = document.getElementById('tenant-notices-container');
    const badge = document.getElementById('badge-notice-count');
    if (!box) return;

    try {
        const res = await fetch(`${API_BASE}/notices`);
        const data = await res.json();
        const list = data.data || [];

        if (badge) badge.textContent = `${list.length} thông báo`;

        if (list.length === 0) {
            box.innerHTML = `<p class="text-muted p-3">Chưa có thông báo nào từ chủ nhà trọ.</p>`;
            return;
        }

        box.innerHTML = list.map(n => {
            const isReminder = (n.notice_type === 'PaymentReminder');
            const isMaint = (n.notice_type === 'Maintenance');
            let itemClass = '';
            let typeBadge = `<span class="badge badge-primary">📢 CHUNG</span>`;

            if (isReminder) {
                itemClass = 'notice-reminder';
                typeBadge = `<span class="badge badge-danger">🚨 NHẮC NỢ</span>`;
            } else if (isMaint) {
                itemClass = 'notice-maintenance';
                typeBadge = `<span class="badge badge-warning">🛠️ BẢO TRÌ</span>`;
            }

            return `
                <div class="notice-item ${itemClass}">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <div>
                            ${typeBadge}
                            <strong style="margin-left: 6px; font-size: 0.95rem;">${escapeHtml(n.title)}</strong>
                        </div>
                        <small class="font-mono text-muted">${escapeHtml(n.created_at || '')}</small>
                    </div>
                    <p style="font-size: 0.88rem; line-height: 1.5; color: #333333;">${escapeHtml(n.content)}</p>
                </div>
            `;
        }).join('');
    } catch (err) {
        box.innerHTML = `<p class="text-danger p-2">Lỗi tải bảng tin: ${err.message}</p>`;
    }
}

// C. Module Hóa đơn & Thanh toán QR Code (Trọng tâm)
async function loadInvoices() {
    const activeBox = document.getElementById('active-invoice-breakdown');
    const statusBadgeBox = document.getElementById('active-invoice-status-badge');
    const historyTbody = document.getElementById('tenant-invoices-list');

    try {
        const res = await fetch(`${API_BASE}/invoices`);
        const data = await res.json();
        const invoices = data.data || [];

        if (invoices.length === 0) {
            if (activeBox) activeBox.innerHTML = `<p class="text-muted p-4">Hiện tại tài khoản chưa có hóa đơn nào được phát hành.</p>`;
            if (historyTbody) historyTbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted p-4">Chưa có lịch sử giao dịch.</td></tr>`;
            return;
        }

        // Hóa đơn mới nhất (kỳ hiện tại)
        activeInvoice = invoices[0];
        const isPaid = (activeInvoice.status === 'Paid');
        const isOverdue = (activeInvoice.status === 'Overdue');
        const isPartial = (activeInvoice.status === 'Partially Paid');

        // Render Badge trạng thái hóa đơn hiện tại
        if (statusBadgeBox) {
            if (isPaid) {
                statusBadgeBox.innerHTML = `<span class="badge badge-success" style="font-size: 0.85rem; padding: 6px 12px;">✓ ĐÃ THANH TOÁN THÀNH CÔNG</span>`;
            } else if (isOverdue) {
                statusBadgeBox.innerHTML = `<span class="badge badge-danger" style="font-size: 0.85rem; padding: 6px 12px;">🚨 HÓA ĐƠN QUÁ HẠN NỘP</span>`;
            } else if (isPartial) {
                statusBadgeBox.innerHTML = `<span class="badge badge-primary" style="font-size: 0.85rem; padding: 6px 12px;">⚡ ĐÃ NỘP MỘT PHẦN</span>`;
            } else {
                statusBadgeBox.innerHTML = `<span class="badge badge-warning" style="font-size: 0.85rem; padding: 6px 12px;">! CHỜ THANH TOÁN (HẠN: ${escapeHtml(activeInvoice.due_date)})</span>`;
            }
        }

        // Bóc tách chi tiết hóa đơn tháng hiện tại
        const eUsage = activeInvoice.electricity_usage || Math.max(0, (activeInvoice.electricity_end || 0) - (activeInvoice.electricity_start || 0));
        const wUsage = activeInvoice.water_usage || Math.max(0, (activeInvoice.water_end || 0) - (activeInvoice.water_start || 0));
        const trash = activeInvoice.trash_cost || activeInvoice.tien_rac || 50000;
        const wifi = activeInvoice.wifi_cost || 100000;

        if (activeBox) {
            activeBox.innerHTML = `
                <div style="background: #ffffff; border: 1px solid var(--border); padding: 18px; border-radius: 2px; margin-bottom: 14px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                        <span class="mono-label">PHÒNG TRỌ:</span>
                        <strong>Phòng ${escapeHtml(activeInvoice.room_number || '')} (${escapeHtml(activeInvoice.property_name || '')})</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                        <span class="mono-label">KỲ HÓA ĐƠN:</span>
                        <strong class="font-mono">Tháng ${escapeHtml(activeInvoice.invoice_month)}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span class="mono-label">HẠN THANH TOÁN:</span>
                        <span class="font-mono ${isOverdue ? 'text-danger font-bold' : ''}">${escapeHtml(activeInvoice.due_date)}</span>
                    </div>
                </div>

                <div class="utility-preview-box" style="margin-top: 0;">
                    <div class="utility-preview-row">
                        <span>1. Tiền thuê phòng:</span>
                        <strong class="font-mono">${formatMoney(activeInvoice.room_rent)}</strong>
                    </div>
                    <div class="utility-preview-row">
                        <span>2. Tiền điện (${activeInvoice.electricity_start} ➔ ${activeInvoice.electricity_end} = ${eUsage.toFixed(1)} kWh):</span>
                        <strong class="font-mono">${formatMoney(activeInvoice.electricity_cost)}</strong>
                    </div>
                    <div class="utility-preview-row">
                        <span>3. Tiền nước (${activeInvoice.water_start} ➔ ${activeInvoice.water_end} = ${wUsage.toFixed(1)} m³):</span>
                        <strong class="font-mono">${formatMoney(activeInvoice.water_cost)}</strong>
                    </div>
                    <div class="utility-preview-row">
                        <span>4. Tiền rác vệ sinh môi trường:</span>
                        <strong class="font-mono">${formatMoney(trash)}</strong>
                    </div>
                    <div class="utility-preview-row">
                        <span>5. Tiền mạng Internet / Wifi:</span>
                        <strong class="font-mono">${formatMoney(wifi)}</strong>
                    </div>
                    ${activeInvoice.service_cost > 0 ? `
                    <div class="utility-preview-row">
                        <span>6. Chi phí dịch vụ khác:</span>
                        <strong class="font-mono">${formatMoney(activeInvoice.service_cost)}</strong>
                    </div>` : ''}
                    <div class="utility-preview-row utility-preview-total" style="font-size: 1.1rem;">
                        <span>TỔNG TIỀN PHẢI TRẢ:</span>
                        <strong class="font-mono text-danger">${formatMoney(activeInvoice.total_amount)}</strong>
                    </div>
                </div>
            `;
        }

        // TỰ ĐỘNG SINH MÃ QR NGÂN HÀNG VIETQR
        const qrImg = document.getElementById('payment-qr-image');
        const amountDisplay = document.getElementById('bank-amount');
        const memoDisplay = document.getElementById('bank-memo');

        const memoText = `RENTMASTER ${activeInvoice.room_number || 'PHONG'} T${activeInvoice.invoice_month || ''}`.replace(/[^A-Za-z0-9 ]/g, '');
        const amountVal = Math.round(activeInvoice.total_amount || 0);

        if (amountDisplay) amountDisplay.textContent = formatMoney(amountVal);
        if (memoDisplay) memoDisplay.textContent = memoText;

        if (qrImg) {
            // Chuẩn VietQR API trực tiếp
            qrImg.src = `https://img.vietqr.io/image/MB-0901234567-compact2.png?amount=${amountVal}&addInfo=${encodeURIComponent(memoText)}&accountName=NGUYEN%20VAN%20CHU`;
        }

        // Render bảng lịch sử giao dịch
        if (historyTbody) {
            historyTbody.innerHTML = invoices.map(i => {
                const eU = i.electricity_usage || Math.max(0, (i.electricity_end || 0) - (i.electricity_start || 0));
                const wU = i.water_usage || Math.max(0, (i.water_end || 0) - (i.water_start || 0));
                const trWifi = (i.trash_cost || 50000) + (i.wifi_cost || 100000);
                const isP = (i.status === 'Paid');
                const isO = (i.status === 'Overdue');
                const rowCls = isO ? 'class="row-overdue"' : '';

                let bClass = 'badge-warning';
                let bText = '! CHƯA THANH TOÁN';
                if (isP) { bClass = 'badge-success'; bText = '✓ ĐÃ THANH TOÁN'; }
                else if (isO) { bClass = 'badge-danger'; bText = '🚨 QUÁ HẠN'; }

                return `
                    <tr ${rowCls}>
                        <td><strong class="font-mono">Tháng ${escapeHtml(i.invoice_month)}</strong></td>
                        <td class="font-mono">${formatMoney(i.room_rent)}</td>
                        <td>
                            <span class="font-mono">${i.electricity_start} ➔ ${i.electricity_end} (${eU.toFixed(1)} kWh)</span><br>
                            <strong>${formatMoney(i.electricity_cost)}</strong>
                        </td>
                        <td>
                            <span class="font-mono">${i.water_start} ➔ ${i.water_end} (${wU.toFixed(1)} m³)</span><br>
                            <strong>${formatMoney(i.water_cost)}</strong>
                        </td>
                        <td class="font-mono">${formatMoney(trWifi)}</td>
                        <td><strong class="font-mono" style="font-size: 1rem;">${formatMoney(i.total_amount)}</strong></td>
                        <td><small class="font-mono">${escapeHtml(i.due_date)}</small></td>
                        <td><span class="badge ${bClass}">${bText}</span></td>
                        <td><small class="font-mono text-muted">${escapeHtml(i.paid_at || '—')}</small></td>
                    </tr>
                `;
            }).join('');
        }
    } catch (err) {
        console.error("Lỗi tải hóa đơn:", err);
    }
}

// D. Module Báo cáo & Theo dõi tiến độ bảo trì sự cố
async function loadMaintenance() {
    const tbody = document.getElementById('tenant-maintenance-list');
    const badge = document.getElementById('badge-tenant-maint');
    try {
        const res = await fetch(`${API_BASE}/maintenance`);
        const data = await res.json();
        const list = data.data || [];

        if (badge) badge.textContent = `${list.length} sự cố`;

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted p-4">Bạn chưa gửi phản ánh sự cố nào.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(m => {
            const status = m.status || 'Pending';
            let badgeClass = 'badge-danger';
            let statusLabel = '⏳ Chờ tiếp nhận';

            if (status === 'In Progress') {
                badgeClass = 'badge-warning';
                statusLabel = '⚙️ Đang sửa chữa';
            } else if (status === 'Completed') {
                badgeClass = 'badge-success';
                statusLabel = '✅ Đã hoàn tất';
            }

            return `
                <tr>
                    <td><strong class="font-mono">#${m.id}</strong></td>
                    <td>
                        <strong>${escapeHtml(m.title)}</strong>
                        <div class="text-muted small">${escapeHtml(m.description || '')}</div>
                    </td>
                    <td><span class="badge badge-primary">${m.priority}</span></td>
                    <td><small class="font-mono text-muted">${escapeHtml(m.reported_at || m.created_at || '')}</small></td>
                    <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
                    <td><span class="font-italic text-muted">${escapeHtml(m.admin_notes || 'Đang chờ chủ trọ phản hồi...')}</span></td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-danger p-3">Lỗi tải sự cố: ${err.message}</td></tr>`;
    }
}

async function handleCreateMaintenance(event) {
    event.preventDefault();
    const category = document.getElementById('maint-category').value;
    const titleRaw = document.getElementById('maint-title').value.trim();
    const priority = document.getElementById('maint-priority').value;
    const description = document.getElementById('maint-desc').value.trim();

    const title = `[${category}] ${titleRaw}`;

    try {
        const res = await fetch(`${API_BASE}/maintenance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, priority, description })
        });
        const data = await res.json();

        if (data.success) {
            alert("✅ Đã gửi yêu cầu sửa chữa tới Chủ trọ thành công! Ban quản lý sẽ liên hệ kiểm tra.");
            document.getElementById('maint-title').value = '';
            document.getElementById('maint-desc').value = '';
            await loadMaintenance();
        } else {
            alert(`❌ Không thể gửi sự cố: ${data.message}`);
        }
    } catch (err) {
        console.error("Lỗi gửi sự cố:", err);
        alert("❌ Lỗi kết nối tới máy chủ.");
    }
}

// E. Profile & Đổi mật khẩu
async function handleUpdateContact(event) {
    event.preventDefault();
    const phone = document.getElementById('profile-phone').value.trim();
    const email = document.getElementById('profile-email').value.trim();

    try {
        const res = await fetch(`${API_BASE}/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, email })
        });
        const data = await res.json();

        if (data.success) {
            showToast('✅ Đã lưu số điện thoại & email mới');
        } else {
            alert(`❌ Không thể cập nhật: ${data.message}`);
        }
    } catch (err) {
        alert("❌ Lỗi kết nối tới máy chủ.");
    }
}

async function handleChangePassword(event) {
    event.preventDefault();
    const old_password = document.getElementById('pwd-old').value.trim();
    const new_password = document.getElementById('pwd-new').value.trim();
    const confirm_password = document.getElementById('pwd-confirm').value.trim();

    if (new_password !== confirm_password) {
        alert("⚠️ Mật khẩu xác nhận không khớp với mật khẩu mới!");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_password, new_password })
        });
        const data = await res.json();

        if (data.success) {
            alert("✅ Đổi mật khẩu thành công! Vui lòng ghi nhớ mật khẩu mới.");
            document.getElementById('pwd-old').value = '';
            document.getElementById('pwd-new').value = '';
            document.getElementById('pwd-confirm').value = '';
        } else {
            alert(`❌ ${data.message}`);
        }
    } catch (err) {
        alert("❌ Lỗi kết nối tới máy chủ.");
    }
}

// 7. UTILITY HELPERS
function copyAccountNumber() {
    const acc = document.getElementById('bank-acc-number')?.textContent || '0901234567';
    navigator.clipboard.writeText(acc).then(() => {
        showToast('📋 Đã sao chép số tài khoản: ' + acc);
    }).catch(() => {
        showToast('📋 Số tài khoản MB: ' + acc);
    });
}

function scrollToSection(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
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

// Tự động kiểm tra phiên khi mở trang
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch(`${API_BASE}/auth/me`);
        const data = await res.json();
        if (data.authenticated && data.user && data.user.role === 'tenant') {
            currentTenant = data.user;
            showPortalUI();
            await loadTenantPortalData();
        }
    } catch (_) {}
});
