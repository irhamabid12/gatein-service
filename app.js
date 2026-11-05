const path = require('path');
const fs = require('fs');
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const tcpClient = require('./services/tcpClient');
const monitor = require('./services/monitor');
const logger = require('./services/logger');
const { printTicket } = require('./services/printer');
const express = require('express');
const http = require('http');
const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);
const ping = require('ping');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/view', express.static(path.join(__dirname, 'view')));

const port = config.device.port || 3002;

logger.init(io);
tcpClient.init(io);
monitor.init(io);

tcpClient.startConnection();

require('./services/cleanup').startCleanupSchedule();


app.post('/connect', (req, res) => {
    tcpClient.startConnection();

    res.json({ message: `Connecting to ${config.controller.ip}:${config.controller.port}` });
});

// endpoint disconnect
app.post('/disconnect', (req, res) => {
    tcpClient.disconnect();
    res.json({ message: 'Disconnected' });
});

app.post('/reset', (req, res) => {
    tcpClient.sendData("ER!\r\n");
    res.json({ message: 'Reset command sent' });
});

app.post('/open-gate', async (req, res) => {
    const ok = await tcpClient.sendDataWithRetry("ON!\r\n");
    if (ok) {
        res.json({ message: 'Open gate command sent' });
    } else {
        res.status(503).json({ message: 'Failed to send open gate command after retries' });
    }
});

app.post('/close-gate', (req, res) => {
    tcpClient.sendData("OFF\r\n");
    res.json({ message: 'Close gate command sent' });
});

app.post('/api/print-ticket', async (req, res) => {
    const { ticketNo, isRfid } = req.body;
    try {
        const success = await printTicket(ticketNo, isRfid);
        if (success) {
            res.json({ success: true, message: 'Ticket printed successfully' });
        } else {
            res.json({ success: false, message: 'Failed to print ticket' });
        }
    } catch (error) {
        console.error('Print ticket error:', error);
        res.status(500).json({ success: false, message: 'Internal server error while printing ticket' });
    }
});

app.get('/api/config', (req, res) => {
    const currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    res.json(currentConfig);
});

app.get('/api/get-config', (req, res) => {
    const currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    res.json(currentConfig);
});

app.post('/api/config', (req, res) => {
    const data = req.body;
    const currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    if (data.DEVICE_NAME !== undefined) currentConfig.device.name = data.DEVICE_NAME;
    if (data.IP_ADDRESS !== undefined) currentConfig.device.ip = data.IP_ADDRESS;
    if (data.PORT !== undefined) currentConfig.device.port = data.PORT;

    if (data.CONTROLLER_IP !== undefined) currentConfig.controller.ip = data.CONTROLLER_IP;
    if (data.CONTROLLER_PORT !== undefined) currentConfig.controller.port = data.CONTROLLER_PORT;

    if (data.PRINTER_IP !== undefined) currentConfig.printer.ip = data.PRINTER_IP;
    if (data.PRINTER_PORT !== undefined) currentConfig.printer.port = data.PRINTER_PORT;

    if (data.CAMERA_IP !== undefined) currentConfig.camera.ip = data.CAMERA_IP;
    if (data.CAMERA_PORT !== undefined) currentConfig.camera.port = data.CAMERA_PORT;
    if (data.CAMERA_USERNAME !== undefined) currentConfig.camera.username = data.CAMERA_USERNAME;
    if (data.CAMERA_PASSWORD !== undefined) currentConfig.camera.password = data.CAMERA_PASSWORD;

    if (data.ENDPOINT_SERVER !== undefined) currentConfig.endpoint = data.ENDPOINT_SERVER;

    if (data.NAMA_GOLONGAN !== undefined) currentConfig.parking_class.nama_golongan = data.NAMA_GOLONGAN;
    if (data.GOLONGAN_ID !== undefined) currentConfig.parking_class.golongan_id = data.GOLONGAN_ID;
    if (data.NAMA_TARIF !== undefined) currentConfig.parking_class.nama_tarif = data.NAMA_TARIF;
    if (data.TARIF_ID !== undefined) currentConfig.parking_class.tarif_id = data.TARIF_ID;
    if (data.NAMA_GATE !== undefined) currentConfig.parking_class.nama_gate = data.NAMA_GATE;
    if (data.GATE_ID !== undefined) currentConfig.parking_class.gate_id = data.GATE_ID;
    data.MEMBER !== undefined ? currentConfig.parking_class.member = true : currentConfig.parking_class.member = false;
    data.CETAK_TIKET_MEMBER !== undefined ? currentConfig.parking_class.print_ticket_member = true : currentConfig.parking_class.print_ticket_member = false;

    fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2));
    res.json({ success: true, message: 'Configuration saved! Please restart the device/app to fully apply changes.' });

    // Optionally exit after short delay to let nodemon restart it
    setTimeout(() => process.exit(0), 1000);
});



// cek status
app.get('/status', (req, res) => {
    res.json({
        connected: tcpClient.getStatus()
    });
});

app.get('/', (req, res) => {
    let html = fs.readFileSync(path.join(__dirname, 'view', 'index.html'), 'utf8');
    const deviceName = config.device.name || 'Unknown Device';
    const ipAddress = config.device.ip || '0.0.0.0';
    const controllerIP = config.controller.ip || '0.0.0.0';
    const controllerPort = config.controller.port || '0';
    const printerIP = config.printer.ip || '0.0.0.0';
    const printerPort = config.printer.port || '0';
    const cameraIP = config.camera.ip || '0.0.0.0';
    const cameraPort = config.camera.port || '0';
    const endpointServer = config.endpoint || 'localhost:3000';
    const namaGolongan = config.parking_class.nama_golongan || 'Unknown Golongan';
    const namaTarif = config.parking_class.nama_tarif || 'Unknown Tarif';
    const namaGate = config.parking_class.nama_gate || 'Unknown Gate';
    const gateId = config.parking_class.gate_id || 'Unknown Gate ID';
    
    html = html.replaceAll('{{DEVICE_NAME}}', deviceName);
    html = html.replaceAll('{{IP_ADDRESS}}', ipAddress);
    html = html.replaceAll('{{CONTROLLER_IP}}', controllerIP);
    html = html.replaceAll('{{CONTROLLER_PORT}}', controllerPort);
    html = html.replaceAll('{{PRINTER_IP}}', printerIP);
    html = html.replaceAll('{{PRINTER_PORT}}', printerPort);
    html = html.replaceAll('{{CAMERA_IP}}', cameraIP);
    html = html.replaceAll('{{CAMERA_PORT}}', cameraPort);
    html = html.replaceAll('{{ENDPOINT_SERVER}}', endpointServer);
    html = html.replaceAll('{{NAMA_GOLONGAN}}', namaGolongan);
    html = html.replaceAll('{{NAMA_TARIF}}', namaTarif);
    html = html.replaceAll('{{NAMA_GATE}}', namaGate);
    html = html.replaceAll('{{GATE_ID}}', gateId);
    html = html.replaceAll('{{MEMBER}}', config.parking_class.member ? 'Aktif' : 'Inactive');
    html = html.replaceAll('{{CETAK_TIKET_MEMBER}}', config.parking_class.print_ticket_member ? 'Aktif' : 'Inactive');
    res.send(html);
});

app.get('/index', (req, res) => {
    res.redirect('/');
});

server.listen(port, () => {
    console.log(`API running on port ${port}`);
});

io.on('connection', (socket) => {
  console.log('client connected');

  setInterval(async () => {
    const url = config.endpoint;
    const host = url.replace('http://', '').replace('https://', '');
    const res = await ping.promise.probe(config.controller.ip);
    const resPrinter = await ping.promise.probe(config.printer.ip);
    const resCamera = await ping.promise.probe(config.camera.ip);
    const resEndpoint = await ping.promise.probe(host);

    socket.emit('pingData', {
      time: new Date(),
      latencyController: res.time,
      aliveController: res.alive,
      latencyPrinter: resPrinter.time,
      alivePrinter: resPrinter.alive,
      latencyCamera: resCamera.time,
      aliveCamera: resCamera.alive,
      latencyEndpoint: resEndpoint.time,
      aliveEndpoint: resEndpoint.alive
    });
  }, 2000);
});