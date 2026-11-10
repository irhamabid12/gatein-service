const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const ping = require('ping');

const {
    loadFullConfig, getGates, getGateConfig,
    addGateConfig, updateGateConfig, deleteGateConfig
} = require('./services/configManager');
const tcpClient = require('./services/tcpClient');
const monitor = require('./services/monitor');
const logger = require('./services/logger');
const { printTicket } = require('./services/printer');
const { getServerStats } = require('./services/serverStats');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/assets', express.static(path.join(__dirname, 'assets'), { etag: false, lastModified: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));
app.use('/view', express.static(path.join(__dirname, 'view')));

const port = loadFullConfig().server?.port || 3002;

logger.init(io);
tcpClient.init(io);
// Saat pertama kali service dijalankan, seluruh gate dalam kondisi disconnect (tidak auto-connect)
tcpClient.disconnectAllConnections();
monitor.init(io);
require('./services/cleanup').startCleanupSchedule();

const gateIdOf = (req) => req.params.gateId || req.query.gateId || req.body?.gateId || null;

// Pastikan gate ada; kalau tidak, balas 404
function withGate(handler) {
    return (req, res) => {
        const gate = getGateConfig(gateIdOf(req));
        if (!gate) return res.status(404).json({ success: false, message: `Gate "${gateIdOf(req)}" tidak ditemukan` });
        return handler(req, res, gate, String(gate.parking_class.gate_id));
    };
}

// ---------- Status server service ----------
app.get('/api/server-status', (req, res) => {
    const gates = getGates();
    const connected = gates.filter(g => tcpClient.getStatus(g.parking_class.gate_id).connected).length;
    res.json({
        success: true,
        ...getServerStats(),
        socketClients: io.engine.clientsCount,
        gates: { total: gates.length, controllerActive: connected }
    });
});

// ---------- Manajemen gate ----------
app.get('/api/gates', (req, res) => {
    const gates = getGates().map(g => ({
        gate_id: g.parking_class.gate_id,
        nama_gate: g.parking_class.nama_gate,
        device_name: g.device?.name,
        status: tcpClient.getStatus(g.parking_class.gate_id)
    }));
    res.json({ success: true, gates });
});

app.post('/api/gates', (req, res) => {
    try {
        const gate = addGateConfig(req.body);
        const id = gate.parking_class.gate_id;
        // Tidak auto-connect: connect/disconnect dilakukan manual dari dashboard gate
        monitor.checkSingleGate(gate);
        res.json({ success: true, message: `Gate "${gate.parking_class.nama_gate}" (ID: ${id}) berhasil ditambahkan`, gateId: id });
    } catch (e) {
        res.status(400).json({ success: false, message: e.message });
    }
});

app.delete('/api/gates/:gateId', (req, res) => {
    try {
        const removed = deleteGateConfig(req.params.gateId);
        tcpClient.removeGateClient(req.params.gateId);
        res.json({
            success: true,
            message: `Gate "${removed.parking_class.nama_gate}" dihapus`,
            redirectGateId: getGates()[0]?.parking_class?.gate_id || null
        });
    } catch (e) {
        res.status(400).json({ success: false, message: e.message });
    }
});

// ---------- Kontrol per gate (tanpa :gateId = gate pertama) ----------
app.post(['/connect', '/connect/:gateId'], withGate((req, res, g, id) => {
    tcpClient.startConnection(id);
    res.json({ message: `[Gate ${id}] Connecting to ${g.controller.ip}:${g.controller.port}` });
}));

app.post(['/disconnect', '/disconnect/:gateId'], withGate((req, res, g, id) => {
    tcpClient.disconnect(id);
    res.json({ message: `[Gate ${id}] Disconnected` });
}));

app.post(['/reset', '/reset/:gateId'], withGate((req, res, g, id) => {
    tcpClient.sendData("ER!\r\n", id);
    res.json({ message: 'Reset command sent' });
}));

app.post(['/open-gate', '/open-gate/:gateId'], withGate(async (req, res, g, id) => {
    const ok = await tcpClient.sendDataWithRetry("ON!\r\n", id);
    if (ok) res.json({ message: 'Open gate command sent' });
    else res.status(503).json({ message: 'Failed to send open gate command after retries' });
}));

app.post(['/close-gate', '/close-gate/:gateId'], withGate((req, res, g, id) => {
    tcpClient.sendData("OFF\r\n", id);
    res.json({ message: 'Close gate command sent' });
}));

app.post(['/api/print-ticket', '/api/print-ticket/:gateId'], withGate(async (req, res, g) => {
    try {
        const ok = await printTicket(req.body.ticketNo, req.body.isRfid, g);
        res.json({ success: ok, message: ok ? 'Ticket printed successfully' : 'Failed to print ticket' });
    } catch (e) {
        console.error('Print ticket error:', e);
        res.status(500).json({ success: false, message: 'Internal server error while printing ticket' });
    }
}));

app.get(['/status', '/status/:gateId'], withGate((req, res, g, id) => {
    res.json(tcpClient.getStatus(id));
}));

// ---------- Konfigurasi per gate ----------
app.get(['/api/config', '/api/config/:gateId', '/api/get-config', '/api/get-config/:gateId'],
    withGate((req, res, g) => res.json(g)));

app.post(['/api/config', '/api/config/:gateId'], withGate((req, res, g, oldId) => {
    try {
        const updated = updateGateConfig(oldId, req.body);
        const newId = updated.parking_class.gate_id;
        // Putuskan koneksi lama gate ini saja (config berubah); koneksi ulang dilakukan manual
        tcpClient.resetGateClient(newId, oldId);
        monitor.checkSingleGate(updated);
        res.json({
            success: true,
            message: `Konfigurasi Gate "${updated.parking_class.nama_gate}" (ID: ${newId}) disimpan`,
            gateId: newId
        });
    } catch (e) {
        res.status(400).json({ success: false, message: e.message });
    }
}));

// ---------- Halaman web ----------
function renderDashboard(req, res, gateId, tab) {
    const gate = getGateConfig(gateId);
    if (!gate) {
        return res.status(404).send(`<h3>Gate ID "${String(gateId).replace(/[<>&"]/g, '')}" tidak ditemukan</h3><a href="/">Kembali ke dashboard</a>`);
    }
    const pc = gate.parking_class;
    const vars = {
        DEVICE_NAME: gate.device?.name || 'Unknown Device',
        IP_ADDRESS: gate.device?.ip || '0.0.0.0',
        CONTROLLER_IP: gate.controller?.ip || '0.0.0.0',
        CONTROLLER_PORT: gate.controller?.port || '0',
        PRINTER_IP: gate.printer?.ip || '0.0.0.0',
        PRINTER_PORT: gate.printer?.port || '0',
        CAMERA_IP: gate.camera?.ip || '0.0.0.0',
        CAMERA_PORT: gate.camera?.port || '0',
        ENDPOINT_SERVER: gate.endpoint || '',
        NAMA_GOLONGAN: pc.nama_golongan || '-',
        NAMA_TARIF: pc.nama_tarif || '-',
        NAMA_GATE: pc.nama_gate || '-',
        GATE_ID: String(pc.gate_id),
        INITIAL_TAB: tab,
        MEMBER: pc.member ? 'Aktif' : 'Inactive',
        CETAK_TIKET_MEMBER: pc.print_ticket_member ? 'Aktif' : 'Inactive'
    };
    let html = fs.readFileSync(path.join(__dirname, 'view', 'index.html'), 'utf8');
    for (const [k, v] of Object.entries(vars)) html = html.replaceAll(`{{${k}}}`, v);
    res.send(html);
}

// Dashboard server (hanya status server service)
app.get(['/', '/server'], (req, res) => {
    res.sendFile(path.join(__dirname, 'view', 'server.html'));
});

// Form tambah gate (memakai halaman gate pertama sebagai kerangka)
app.get('/add-gate', (req, res) => {
    const first = getGates()[0];
    renderDashboard(req, res, first?.parking_class?.gate_id, 'add-gate-view');
});
app.get('/index', (req, res) => res.redirect('/'));

// Route config berdasarkan gate id
app.get(['/config/:gateId', '/gate/:gateId/config'], (req, res) =>
    renderDashboard(req, res, req.params.gateId, 'device-config-view'));
app.get('/gate/:gateId', (req, res) =>
    renderDashboard(req, res, req.params.gateId, 'current-status-view'));

server.listen(port, () => console.log(`Multi-Gate service running on port ${port}`));

// Satu interval global untuk ping semua gate
setInterval(async () => {
    for (const g of getGates()) {
        try {
            const host = (g.endpoint || '').replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
            const [c, p, cam, ep] = await Promise.all([
                ping.promise.probe(g.controller?.ip),
                ping.promise.probe(g.printer?.ip),
                ping.promise.probe(g.camera?.ip),
                host ? ping.promise.probe(host) : Promise.resolve({ time: 'unknown', alive: false })
            ]);
            io.emit('pingData', {
                gateId: String(g.parking_class.gate_id),
                time: new Date(),
                latencyController: c.time, aliveController: c.alive,
                latencyPrinter: p.time, alivePrinter: p.alive,
                latencyCamera: cam.time, aliveCamera: cam.alive,
                latencyEndpoint: ep.time, aliveEndpoint: ep.alive
            });
        } catch (e) { /* abaikan error ping sesaat */ }
    }
}, 2000);

io.on('connection', () => monitor.runMonitor());
