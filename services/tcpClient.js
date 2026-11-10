const net = require('net');
const { printTicket } = require('./printer');
const { generateNoTicket, updateStatusTransaksi } = require('./processData');
const logger = require('./logger');
const { getGates, getGateConfig } = require('./configManager');
const { cameraHandler } = require('./camera');
const { uploadImage } = require('./upload');

let io = null;
const sessions = new Map(); // gateId -> state koneksi

function formatDate(date = new Date()) {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Semua event dikirim dengan gateId agar UI bisa memfilter per gate
function emitGate(gateId, event, data) {
    if (io) io.emit(event, { gateId: String(gateId), data });
}

function getSession(gateId) {
    const key = String(gateId);
    if (!sessions.has(key)) {
        sessions.set(key, { client: null, isConnecting: false, isDisconnecting: true, isProcess: false, timer: null });
    }
    return sessions.get(key);
}

function resolveGateId(gateId) {
    if (gateId) return String(gateId);
    const first = getGateConfig();
    return first ? String(first.parking_class.gate_id) : null;
}

function init(socketIO) {
    io = socketIO;
    logger.init(socketIO);
}

function startAllConnections() {
    getGates().forEach(g => startConnection(g.parking_class.gate_id));
}

function disconnectAllConnections() {
    getGates().forEach(g => disconnect(g.parking_class.gate_id));
}

function startConnection(gateId) {
    const id = resolveGateId(gateId);
    const gate = id && getGateConfig(id);
    if (!gate) {
        logger.log("error", `[TCP] Konfigurasi Gate ${gateId} tidak ditemukan`);
        return;
    }

    const s = getSession(id);
    s.isDisconnecting = false;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    if (s.client && !s.client.destroyed) return;
    if (s.isConnecting) return;

    const ip = gate.controller.ip;
    const port = Number(gate.controller.port);
    if (!ip || ip === '0.0.0.0') {
        logger.log("warn", `[TCP][Gate ${id}] IP controller belum diisi, koneksi dilewati. Isi lewat Edit Config.`);
        emitGate(id, "controller-status", "offline");
        return;
    }
    s.isConnecting = true;
    logger.log("info", `[TCP][Gate ${id}] Memulai koneksi ke controller ${ip}:${port}...`);

    const client = new net.Socket();
    s.client = client;

    client.connect(port, ip, () => {
        s.isConnecting = false;
        logger.log("info", `[TCP][Gate ${id}] Terhubung ke controller ${ip}:${port}`);
        emitGate(id, "controller-status", "online");
        emitGate(id, "status-device", "connected");
    });

    client.setKeepAlive(true, 5000);

    client.on('data', async (data) => {
        if (s.isDisconnecting || s.isProcess) return;

        // Ambil config terbaru setiap trigger agar perubahan config langsung berlaku
        const cfg = getGateConfig(id) || gate;
        const message = data.toString('ascii').trim();
        const log = (msg) => emitGate(id, "log-output", `${formatDate()} - ${msg}`);

        if (message === ":A") {
            log("Trigger masuk dengan tiket");
            s.isProcess = true;
            try {
                const ticket = await generateNoTicket('', cfg);
                if (ticket && typeof ticket === 'object') {
                    const ok = await printTicket(ticket.kode_parkir, false, cfg);
                    if (!ok) {
                        logger.log("error", `[Gate ${id}] Print ticket failed for kode_parkir: ${ticket.kode_parkir}`);
                        log(`Gagal cetak tiket (${ticket.kode_parkir}), mengupdate status transaksi...`);
                        const updateRes = await updateStatusTransaksi(ticket.kode_parkir, 'error', cfg);
                        if (updateRes?.message) {
                            log(`[${updateRes.status}] ${updateRes.message}`);
                        }
                        sendData("ER!\r\n", id);
                        return;
                    }
                    sendData("S02\r\n", id);
                    const filePath = await cameraHandler(ticket.foto_masuk, cfg);
                    if (filePath) await uploadImage(filePath, cfg);
                } else {
                    logger.log("error", `[Gate ${id}] Ticket not found`);
                    sendData("ER!\r\n", id);
                }
            } catch (err) {
                logger.log("error", `[Gate ${id}] Error: ${err.message}`);
                sendData("ER!\r\n", id);
            } finally {
                s.isProcess = false;
            }

        } else if (message.startsWith(":R")) {
            if (!cfg.parking_class.member) {
                sendData("ER!\r\n", id);
                return;
            }
            const rfid = message.replace(/^:R/, '');
            log(`Trigger masuk dengan kartu member, RFID: ${rfid}`);
            s.isProcess = true;
            try {
                const ticket = await generateNoTicket(rfid, cfg);
                if (ticket === "Anda sudah pernah masuk" || ticket === "Pelanggan tidak ditemukan") {
                    log(ticket === "Anda sudah pernah masuk" ? "Pelanggan sudah pernah masuk" : ticket);
                    sendData("S03\r\n", id);
                    return;
                }
                if (ticket && typeof ticket === 'object') {
                    let ok = true;
                    if (cfg.parking_class.print_ticket_member) {
                        ok = await printTicket(ticket.kode_parkir, true, cfg);
                    }
                    if (!ok) {
                        logger.log("error", `[Gate ${id}] Print ticket failed for kode_parkir: ${ticket.kode_parkir}`);
                        log(`Gagal cetak tiket member (${ticket.kode_parkir}), mengupdate status transaksi...`);
                        const updateRes = await updateStatusTransaksi(ticket.kode_parkir, 'error', cfg);
                        if (updateRes?.message) {
                            log(`[${updateRes.status}] ${updateRes.message}`);
                        }
                        sendData("ER!\r\n", id);
                        return;
                    }
                    sendData("S02\r\n", id);
                    const filePath = await cameraHandler(ticket.foto_masuk, cfg);
                    if (filePath) await uploadImage(filePath, cfg);
                } else {
                    logger.log("error", `[Gate ${id}] Ticket not found`);
                    sendData("ER!\r\n", id);
                }
            } catch (err) {
                logger.log("error", `[Gate ${id}] Error: ${err.message}`);
                sendData("ER!\r\n", id);
            } finally {
                s.isProcess = false;
            }

        } else if (message.startsWith(":C")) {
            log("Kendaraan terdeteksi");
            setTimeout(() => emitGate(id, "log-output", "end process"), 2000);
            logger.log("info", `[Gate ${id}] Kendaraan terdeteksi`);
        } else {
            logger.log("warn", `[Gate ${id}] Unknown message: ${message}`);
        }
    });

    client.on('error', (err) => {
        logger.log("error", `[TCP][Gate ${id}] Error koneksi ${ip}:${port}: ${err.message}`);
        emitGate(id, "controller-status", "offline");
    });

    client.on('close', () => {
        s.isConnecting = false;
        if (s.client) {
            s.client.removeAllListeners();
            s.client.destroy();
            s.client = null;
        }
        emitGate(id, "controller-status", "offline");
        if (!s.isDisconnecting) {
            logger.log("warn", `[TCP][Gate ${id}] Koneksi terputus. Reconnect dalam 3 detik...`);
            s.timer = setTimeout(() => startConnection(id), 3000);
        } else {
            logger.log("info", `[TCP][Gate ${id}] Koneksi ditutup (disconnect manual).`);
        }
    });
}

function disconnect(gateId) {
    const id = resolveGateId(gateId);
    if (!id) return;
    const s = getSession(id);
    s.isDisconnecting = true;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    if (s.client) {
        s.client.removeAllListeners();
        s.client.destroy();
        s.client = null;
    }
    s.isConnecting = false;
    emitGate(id, "status-device", "disconnected");
    emitGate(id, "controller-status", "offline");
}

// Dipanggil setelah config sebuah gate diubah (termasuk bila gate_id berganti)
function restartConnection(newGateId, oldGateId = null) {
    const oldId = String(oldGateId ?? newGateId);
    disconnect(oldId);
    if (oldId !== String(newGateId)) sessions.delete(oldId);
    startConnection(newGateId);
}

// Setelah config gate diubah: putuskan koneksi lama TANPA connect ulang otomatis
function resetGateClient(newGateId, oldGateId = null) {
    const oldId = String(oldGateId ?? newGateId);
    disconnect(oldId);
    if (oldId !== String(newGateId)) sessions.delete(oldId);
    emitGate(newGateId, "status-device", "disconnected");
    emitGate(newGateId, "controller-status", "offline");
}

function removeGateClient(gateId) {
    disconnect(gateId);
    sessions.delete(String(gateId));
}

function getStatus(gateId) {
    const id = resolveGateId(gateId);
    const gate = id && getGateConfig(id);
    const s = id ? getSession(id) : null;
    return {
        gateId: id,
        ip: gate?.controller?.ip,
        port: gate?.controller?.port,
        connected: Boolean(s?.client && !s.client.destroyed),
        connecting: Boolean(s?.isConnecting),
        disconnecting: Boolean(s?.isDisconnecting)
    };
}

function sendData(message, gateId) {
    return sendDataWithRetry(message, gateId);
}

async function sendDataWithRetry(message, gateId, maxRetries = 3, delayMs = 1500) {
    const id = resolveGateId(gateId);
    if (!id) return false;
    const s = getSession(id);
    const label = JSON.stringify(message);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (!s.client || s.client.destroyed) throw new Error('Controller tidak terhubung');
            await new Promise((resolve, reject) => {
                s.client.write(message, 'ascii', (err) => (err ? reject(err) : resolve()));
            });
            return true;
        } catch (err) {
            logger.log("warn", `[TCP][Gate ${id}] Gagal kirim ${label} (percobaan ${attempt}/${maxRetries}): ${err.message}`);
            if (attempt < maxRetries) {
                if (!s.client || s.client.destroyed) startConnection(id);
                await new Promise((r) => setTimeout(r, delayMs));
            }
        }
    }
    logger.log("error", `[TCP][Gate ${id}] Perintah ${label} gagal terkirim setelah ${maxRetries} percobaan`);
    return false;
}

module.exports = {
    init, startAllConnections, disconnectAllConnections, startConnection, disconnect,
    restartConnection, resetGateClient, removeGateClient, getStatus, sendData, sendDataWithRetry
};
