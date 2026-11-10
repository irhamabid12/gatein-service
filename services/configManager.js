const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');

function defaultGate(server = {}) {
    return {
        device: { name: 'New Gate Device', ip: server.ip || '0.0.0.0', port: server.port || '3002' },
        controller: { ip: '0.0.0.0', port: '8023' },
        printer: { ip: '0.0.0.0', port: '9100' },
        camera: { ip: '0.0.0.0', port: '80', username: 'admin', password: '' },
        endpoint_local: 'http://127.0.0.1:8000',
        endpoint_live: 'https://parkir.rsudrsoetomo.jatimprov.go.id',
        endpoint: 'http://127.0.0.1:8000',
        parking_class: {
            nama_golongan: '', golongan_id: '',
            nama_tarif: '', tarif_id: '',
            nama_gate: '', gate_id: '',
            member: false, print_ticket_member: false
        }
    };
}

function saveFullConfig(fullConfig) {
    fs.writeFileSync(configPath, JSON.stringify(fullConfig, null, 2));
}

/**
 * Baca config. Format lama (single gate) otomatis dimigrasi ke format { server, gates: [] }.
 */
function loadFullConfig() {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    if (!Array.isArray(raw.gates)) {
        const gate = {
            device: raw.device,
            controller: raw.controller,
            printer: raw.printer,
            camera: raw.camera,
            endpoint_local: raw.endpoint_local,
            endpoint_live: raw.endpoint_live,
            endpoint: raw.endpoint,
            parking_class: raw.parking_class
        };
        const migrated = {
            server: { ip: raw.device?.ip || '0.0.0.0', port: raw.device?.port || '3002' },
            gates: [gate]
        };
        saveFullConfig(migrated);
        return migrated;
    }

    if (!raw.server) {
        raw.server = { ip: '0.0.0.0', port: '3002' };
    }
    return raw;
}

function getGates() {
    return loadFullConfig().gates;
}

function getGateConfig(gateId) {
    const gates = getGates();
    if (gateId === undefined || gateId === null || gateId === '') return gates[0] || null;
    return gates.find(g => String(g.parking_class?.gate_id) === String(gateId)) || null;
}

function applyPayload(gate, data) {
    if (data.DEVICE_NAME !== undefined) gate.device.name = data.DEVICE_NAME;
    if (data.CONTROLLER_IP !== undefined) gate.controller.ip = data.CONTROLLER_IP;
    if (data.CONTROLLER_PORT !== undefined) gate.controller.port = String(data.CONTROLLER_PORT).trim() || '8023';
    if (data.PRINTER_IP !== undefined) gate.printer.ip = data.PRINTER_IP;
    if (data.PRINTER_PORT !== undefined) gate.printer.port = String(data.PRINTER_PORT).trim() || '9100';
    if (data.CAMERA_IP !== undefined) gate.camera.ip = data.CAMERA_IP;
    if (data.CAMERA_PORT !== undefined) gate.camera.port = String(data.CAMERA_PORT).trim() || '80';
    if (data.CAMERA_USERNAME !== undefined) gate.camera.username = data.CAMERA_USERNAME;
    if (data.CAMERA_PASSWORD !== undefined) gate.camera.password = data.CAMERA_PASSWORD;
    if (data.ENDPOINT_SERVER !== undefined) gate.endpoint = data.ENDPOINT_SERVER;

    const pc = gate.parking_class;
    if (data.NAMA_GOLONGAN !== undefined) pc.nama_golongan = data.NAMA_GOLONGAN;
    if (data.GOLONGAN_ID !== undefined) pc.golongan_id = String(data.GOLONGAN_ID);
    if (data.NAMA_TARIF !== undefined) pc.nama_tarif = data.NAMA_TARIF;
    if (data.TARIF_ID !== undefined) pc.tarif_id = String(data.TARIF_ID);
    if (data.NAMA_GATE !== undefined) pc.nama_gate = data.NAMA_GATE;
    if (data.GATE_ID !== undefined) pc.gate_id = String(data.GATE_ID).trim();

    // Checkbox HTML: ada = true, tidak dikirim = false
    pc.member = data.MEMBER !== undefined && data.MEMBER !== false && data.MEMBER !== 'false';
    pc.print_ticket_member = data.CETAK_TIKET_MEMBER !== undefined && data.CETAK_TIKET_MEMBER !== false && data.CETAK_TIKET_MEMBER !== 'false';
    return gate;
}

function addGateConfig(data) {
    const full = loadFullConfig();
    const gateId = String(data.GATE_ID || '').trim();
    if (!gateId) throw new Error('Gate ID wajib diisi');
    if (full.gates.some(g => String(g.parking_class?.gate_id) === gateId)) {
        throw new Error(`Gate dengan ID "${gateId}" sudah terdaftar`);
    }
    const gate = applyPayload(defaultGate(full.server), data);
    full.gates.push(gate);
    saveFullConfig(full);
    return gate;
}

function updateGateConfig(targetGateId, data) {
    const full = loadFullConfig();
    const idx = full.gates.findIndex(g => String(g.parking_class?.gate_id) === String(targetGateId));
    if (idx === -1) throw new Error(`Gate dengan ID "${targetGateId}" tidak ditemukan`);

    if (data.GATE_ID !== undefined) {
        const newId = String(data.GATE_ID).trim();
        if (!newId) throw new Error('Gate ID tidak boleh kosong');
        if (full.gates.some((g, i) => i !== idx && String(g.parking_class?.gate_id) === newId)) {
            throw new Error(`Gate ID "${newId}" sudah digunakan gate lain`);
        }
    }

    full.gates[idx] = applyPayload(full.gates[idx], data);
    saveFullConfig(full);
    return full.gates[idx];
}

function deleteGateConfig(gateId) {
    const full = loadFullConfig();
    if (full.gates.length <= 1) throw new Error('Minimal harus ada 1 gate');
    const idx = full.gates.findIndex(g => String(g.parking_class?.gate_id) === String(gateId));
    if (idx === -1) throw new Error(`Gate dengan ID "${gateId}" tidak ditemukan`);
    const [removed] = full.gates.splice(idx, 1);
    saveFullConfig(full);
    return removed;
}

module.exports = {
    loadFullConfig, getGates, getGateConfig,
    addGateConfig, updateGateConfig, deleteGateConfig
};

