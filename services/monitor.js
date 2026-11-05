const net = require('net');
const config = require('../config.json');

function checkTCP(ip, port, timeout = 2000) {
    return new Promise((resolve) => {
        if (!ip || !port) {
            return resolve(false);
        }
        const socket = new net.Socket();
        socket.setTimeout(timeout);
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });
        socket.connect(port, ip);
    });
}

async function checkHTTP(url) {
    if (!url) return false;
    try {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
        return true;
    } catch (e) {
        try {
            const res2 = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
            return true;
        } catch(e2) {
            return false;
        }
    }
}

let ioInstance = null;

async function runMonitor() {
    if (!ioInstance) return;
    
    // if ()
    // Check Controller
    const tcpClient = require('./tcpClient');
    const status = tcpClient.getStatus();
    
    if (status.disconnecting !== true) {
        const controllerIP = config.controller.ip;
        const controllerPort = config.controller.port;
        const controllerOnline = await checkTCP(controllerIP, controllerPort);
        ioInstance.emit('controller-status', controllerOnline ? 'online' : 'offline');
        ioInstance.emit('status-device', 'connected');
    } else {
        ioInstance.emit('status-device', 'disconnected');
    }

    // Check Printer
    const printerIP = config.printer.ip;
    const printerPort = config.printer.port;
    const printerOnline = await checkTCP(printerIP, printerPort);
    ioInstance.emit('printer-status', printerOnline ? 'online' : 'offline'); 

    // Check Camera
    const cameraIP = config.camera.ip;
    const cameraPort = config.camera.port;
    const cameraOnline = await checkTCP(cameraIP, cameraPort);
    ioInstance.emit('camera-status', cameraOnline ? 'online' : 'offline');

    // Check Endpoint
    const endpointServer = config.endpoint;
    const endpointOnline = await checkHTTP(endpointServer);
    ioInstance.emit('endpoint-status', endpointOnline ? 'online' : 'offline');
}

function init(io) {
    ioInstance = io;
    
    // Initial check
    runMonitor();
    
    // Monitor every 5 seconds
    setInterval(runMonitor, 5000);
}

module.exports = { init };
