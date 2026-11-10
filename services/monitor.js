const net = require('net');
const { getGates } = require('./configManager');

function checkTCP(ip, port, timeout = 2000) {
    return new Promise((resolve) => {
        if (!ip || !port) return resolve(false);
        const socket = new net.Socket();
        socket.setTimeout(timeout);
        socket.on('connect', () => { socket.destroy(); resolve(true); });
        socket.on('timeout', () => { socket.destroy(); resolve(false); });
        socket.on('error', () => { socket.destroy(); resolve(false); });
        socket.connect(Number(port), ip);
    });
}

async function checkHTTP(url) {
    if (!url) return false;
    try {
        await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
        return true;
    } catch (e) {
        try {
            await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
            return true;
        } catch (e2) {
            return false;
        }
    }
}

let ioInstance = null;

async function checkSingleGate(gate) {
    if (!ioInstance || !gate) return;
    const gateId = String(gate.parking_class?.gate_id || '');
    if (!gateId) return;

    const emit = (event, online) => ioInstance.emit(event, { gateId, data: online ? 'online' : 'offline' });

    const tcpClient = require('./tcpClient');
    const status = tcpClient.getStatus(gateId);

    if (status.disconnecting) {
        ioInstance.emit('status-device', { gateId, data: 'disconnected' });
        ioInstance.emit('controller-status', { gateId, data: 'offline' });
    } else {
        const online = await checkTCP(gate.controller?.ip, gate.controller?.port);
        emit('controller-status', online);
        ioInstance.emit('status-device', { gateId, data: status.connected ? 'connected' : 'disconnected' });
    }

    emit('printer-status', await checkTCP(gate.printer?.ip, gate.printer?.port));
    emit('camera-status', await checkTCP(gate.camera?.ip, gate.camera?.port));
    emit('endpoint-status', await checkHTTP(gate.endpoint));
}

async function runMonitor() {
    if (!ioInstance) return;
    await Promise.all(getGates().map(checkSingleGate));
}

function init(io) {
    ioInstance = io;
    runMonitor();
    setInterval(runMonitor, 5000);
}

module.exports = { init, runMonitor, checkSingleGate };
