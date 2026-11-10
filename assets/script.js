const gateId = String(document.body.dataset.gateId || '');
const initialTab = document.body.dataset.initialTab || 'current-status-view';
const enc = encodeURIComponent(gateId);
const VIEWS = '#current-status-view, #device-config-view, #add-gate-view';

function switchTab(target, updateUrl = false) {
    $('.sidebar-left .nav-link[data-target]').removeClass('active');
    $(`.sidebar-left .nav-link[data-target="${target}"]`).addClass('active');
    $(VIEWS).addClass('d-none');
    $('#' + target).removeClass('d-none');
    if (updateUrl) {
        if (target === 'device-config-view') history.pushState({}, '', `/config/${enc}`);
        else if (target === 'current-status-view') history.pushState({}, '', `/gate/${enc}`);
    }
}
if (initialTab !== 'current-status-view') switchTab(initialTab);

const socket = io();

function postJson(url, body) {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    }).then(r => r.json());
}

function printTicket(ticketNo, isRfid = false) {
    postJson(`/api/print-ticket/${enc}`, { ticketNo, isRfid })
        .then(d => alert(d.message))
        .catch(() => alert('Failed to print ticket'));
}

function loadGates() {
    fetch('/api/gates').then(r => r.json()).then(d => {
        if (!d.success) return;
        const sel = $('#gate-selector').empty().append($('<option>').val('__server__').text('Current Status (Server)'));
        const list = $('#sidebar-gate-list').empty();
        d.gates.forEach(g => {
            const id = String(g.gate_id);
            sel.append($('<option>').val(id).text(`${g.nama_gate} (${id})`).prop('selected', id === gateId));
            list.append($('<a>').attr('href', `/gate/${encodeURIComponent(id)}`)
                .css({ fontSize: '12px', background: id === gateId ? '#004d73' : '' })
                .text(`${g.nama_gate} (${id})`));
        });
        $('#btn-delete-gate').prop('disabled', d.gates.length <= 1);
    });
}

$(document).on('change', '#gate-selector', function () {
    if ($(this).val() === '__server__') { location.href = '/'; return; }
    const id = encodeURIComponent($(this).val());
    const inConfig = !$('#device-config-view').hasClass('d-none');
    location.href = inConfig ? `/config/${id}` : `/gate/${id}`;
});

function loadConfig() {
    fetch(`/api/get-config/${enc}`).then(r => r.json()).then(c => {
        if (!c.device) return;
        const f = $('#form-device-config');
        const set = (n, v) => f.find(`input[name="${n}"]`).val(v);
        set('ORIGINAL_GATE_ID', c.parking_class.gate_id);
        set('DEVICE_NAME', c.device.name);
        set('CONTROLLER_IP', c.controller.ip);
        set('CONTROLLER_PORT', c.controller.port);
        set('PRINTER_IP', c.printer.ip);
        set('PRINTER_PORT', c.printer.port);
        set('CAMERA_IP', c.camera.ip);
        set('CAMERA_PORT', c.camera.port);
        set('CAMERA_USERNAME', c.camera.username);
        set('CAMERA_PASSWORD', c.camera.password);
        set('ENDPOINT_SERVER', c.endpoint);
        set('NAMA_GOLONGAN', c.parking_class.nama_golongan);
        set('GOLONGAN_ID', c.parking_class.golongan_id);
        set('NAMA_TARIF', c.parking_class.nama_tarif);
        set('TARIF_ID', c.parking_class.tarif_id);
        set('NAMA_GATE', c.parking_class.nama_gate);
        set('GATE_ID', c.parking_class.gate_id);
        f.find('input[name="MEMBER"]').prop('checked', !!c.parking_class.member);
        f.find('input[name="CETAK_TIKET_MEMBER"]').prop('checked', !!c.parking_class.print_ticket_member);
    });
}

loadConfig();
loadGates();
document.getElementById('val-ip').innerText = location.hostname;

function formToObject(form) {
    const o = {};
    $(form).serializeArray().forEach(i => o[i.name] = i.value);
    return o;
}

// Navigasi tab (SPA)
$('.sidebar-left .nav-link[data-target]').on('click', function (e) {
    e.preventDefault();
    switchTab($(this).data('target'), true);
});

// Simpan config gate ini
$('#form-device-config').on('submit', function (e) {
    e.preventDefault();
    postJson(`/api/config/${enc}`, formToObject(this)).then(r => {
        alert(r.message);
        if (r.success) location.href = `/gate/${encodeURIComponent(r.gateId)}`;
    }).catch(() => alert('Failed to save configuration'));
});

// Tambah gate baru
$('#form-add-gate').on('submit', function (e) {
    e.preventDefault();
    postJson('/api/gates', formToObject(this)).then(r => {
        alert(r.message);
        if (r.success) location.href = `/gate/${encodeURIComponent(r.gateId)}`;
    }).catch(() => alert('Gagal menambahkan gate'));
});

// Hapus gate
$('#btn-delete-gate').on('click', function () {
    if (!confirm(`Hapus Gate ID "${gateId}"?`)) return;
    fetch(`/api/gates/${enc}`, { method: 'DELETE' }).then(r => r.json()).then(r => {
        alert(r.message);
        if (r.success) location.href = r.redirectGateId ? `/gate/${encodeURIComponent(r.redirectGateId)}` : '/';
    });
});

$('#btn-connect').on('click', () => postJson(`/connect/${enc}`));
$('#btn-disconnect').on('click', () => postJson(`/disconnect/${enc}`));
$('#btn-reset').on('click', () => postJson(`/reset/${enc}`));
$('#btn-open-gate').on('click', () => postJson(`/open-gate/${enc}`));
$('#btn-close-gate').on('click', () => postJson(`/close-gate/${enc}`));

const STATUS = {
    online: ['Online', true], offline: ['Offline', false],
    connected: ['Connected', true], disconnected: ['Disconnected', false]
};
function updateStatus(id, status) {
    const el = document.getElementById(id);
    const s = STATUS[status];
    if (!el || !s) return;
    el.textContent = s[0];
    el.classList.toggle('bg-success', s[1]);
    el.classList.toggle('bg-danger', !s[1]);
}

// Hanya proses event milik gate yang sedang dibuka
function scoped(payload, cb) {
    if (payload && typeof payload === 'object' && payload.gateId !== undefined) {
        if (String(payload.gateId) === gateId) cb(payload.data);
    } else {
        cb(payload);
    }
}

['status-device', 'controller-status', 'printer-status', 'camera-status', 'endpoint-status'].forEach(ev =>
    socket.on(ev, p => scoped(p, st => updateStatus(ev, st))));

socket.on('pingData', (m) => {
    if (m.gateId && String(m.gateId) !== gateId) return;
    const ms = v => ` (${v !== 'unknown' ? v : '0'} ms)`;
    $('#controller-latency').text(ms(m.latencyController));
    $('#printer-latency').text(ms(m.latencyPrinter));
    $('#camera-latency').text(ms(m.latencyCamera));
    $('#endpoint-latency').text(ms(m.latencyEndpoint));
});

socket.on('log-output', (p) => scoped(p, (msg) => {
    if (typeof msg !== 'string') return;
    const el = document.getElementById('log-output');
    if (!el) return;
    if (msg.includes('end process')) { el.value = ''; return; }
    el.value += (el.value ? '\n' : '') + msg;
    el.scrollTop = el.scrollHeight;
}));

$(document).on('click', '.toggle-password', function () {
    const input = $(this).parent().find('input');
    const hidden = input.attr('type') === 'password';
    input.attr('type', hidden ? 'text' : 'password');
    $(this).html(`<i class="bi bi-eye${hidden ? '' : '-slash'}-fill"></i>`);
});

$('#btn-edit-config').on('click', () => switchTab('device-config-view', true));
