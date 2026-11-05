function printTicket(ticketNo, isRfid = false) {
    fetch('/api/print-ticket', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ticketNo, isRfid })
    })
    .then(response => response.json())
    .then(data => {
        alert(data.message);
    })
    .catch(error => {
        console.error('Error printing ticket:', error);
        alert('Failed to print ticket');
    });
}

const socket = io();


function loadConfig() {
    fetch('/api/get-config')
    .then(response => response.json())
    .then(config => {
        $('input[name="DEVICE_NAME"]').val(config.device.name);
        $('input[name="CONTROLLER_IP"]').val(config.controller.ip);
        $('input[name="CONTROLLER_PORT"]').val(config.controller.port);
        $('input[name="PRINTER_IP"]').val(config.printer.ip);
        $('input[name="PRINTER_PORT"]').val(config.printer.port);
        $('input[name="CAMERA_IP"]').val(config.camera.ip);
        $('input[name="CAMERA_PORT"]').val(config.camera.port);
        $('input[name="CAMERA_USERNAME"]').val(config.camera.username);
        $('input[name="CAMERA_PASSWORD"]').val(config.camera.password);
        $('input[name="ENDPOINT_SERVER"]').val(config.endpoint);
        $('input[name="NAMA_GOLONGAN"]').val(config.parking_class.nama_golongan);
        $('input[name="GOLONGAN_ID"]').val(config.parking_class.golongan_id);
        $('input[name="NAMA_TARIF"]').val(config.parking_class.nama_tarif);
        $('input[name="TARIF_ID"]').val(config.parking_class.tarif_id);
        $('input[name="NAMA_GATE"]').val(config.parking_class.nama_gate);
        $('input[name="GATE_ID"]').val(config.parking_class.gate_id);
        $('input[name="MEMBER"]').prop('checked', config.parking_class.member);
        $('input[name="CETAK_TIKET_MEMBER"]').prop('checked', config.parking_class.print_ticket_member);
    });
}

loadConfig();

// Get PC server IP
document.getElementById('val-ip').innerText = window.location.hostname;

$('#btn-connect').on('click', function () {
    fetch('/connect', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
});

$('#btn-disconnect').on('click', function () {
    fetch('/disconnect', {
        method: 'POST'
    })
});

// SPA Navigation
$('.nav-link').on('click', function(e) {
    e.preventDefault();
    $('.nav-link').removeClass('active');
    $(this).addClass('active');

    const target = $(this).data('target');
    $('#current-status-view, #device-config-view').addClass('d-none');
    $('#' + target).removeClass('d-none');
});

// Device Config Submit
$('#form-device-config').on('submit', function(e) {
    e.preventDefault();
    const formData = $(this).serializeArray();
    const data = {};
    formData.forEach(item => data[item.name] = item.value);
    // console.log(data);
    // return;
    fetch('/api/config', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(res => res.json())
    .then(data => {
        alert(data.message);
        if (data.success) {
            loadConfig();
        }
    })
    .catch(err => {
        alert('Failed to save configuration');
    });
});

$('#btn-reset').on('click', function () {
    fetch('/reset', { method: 'POST' });
});

$('#btn-open-gate').on('click', function () {
    fetch('/open-gate', { method: 'POST' });
});

$('#btn-close-gate').on('click', function () {
    fetch('/close-gate', { method: 'POST' });
});

const updateStatus = (id, status) => {
    const el = document.getElementById(id);
    if (el) {
        if (status === "online") {
            el.textContent = "Online";
            el.classList.remove("bg-danger");
            el.classList.add("bg-success");
        } else if(status === "offline") {
            el.textContent = "Offline";
            el.classList.remove("bg-success");
            el.classList.add("bg-danger");
        } else if(status === "connected") {
            el.textContent = "Connected";
            el.classList.remove("bg-danger");
            el.classList.add("bg-success");
        } else if(status === "disconnected") {
            el.textContent = "Disconnected";
            el.classList.remove("bg-success");
            el.classList.add("bg-danger");
        }
    }
};

socket.on("status-device", (status) => updateStatus("status-device", status));
socket.on("controller-status", (status) => updateStatus("controller-status", status));
socket.on("printer-status", (status) => updateStatus("printer-status", status));
socket.on("camera-status", (status) => updateStatus("camera-status", status));
socket.on("endpoint-status", (status) => updateStatus("endpoint-status", status));
socket.on("pingData", (msg) => {
    document.getElementById("controller-latency").textContent = `\ (${msg.latencyController !== 'unknown' ? msg.latencyController : '0'} ms)`;
    document.getElementById("printer-latency").textContent = `\ (${msg.latencyPrinter !== 'unknown' ? msg.latencyPrinter : '0'} ms)`;
    document.getElementById("camera-latency").textContent = `\ (${msg.latencyCamera !== 'unknown' ? msg.latencyCamera : '0'} ms)`;
    document.getElementById("endpoint-latency").textContent = `\ (${msg.latencyEndpoint !== 'unknown' ? msg.latencyEndpoint : '0'} ms)`;
});

socket.on("log-output", (msg) => {
    const logEl = document.getElementById("log-output");
    if (logEl) {
        if (msg.includes('end process')) {
            logEl.value = "";
            return;
        }

        logEl.value += (logEl.value ? "\n" : "") + msg;
        logEl.scrollTop = logEl.scrollHeight;
    }
});

$('#toggle-password').click(function () {
    const input = $(this).parent().find('input');
    if (input.attr('type') === 'password') {
        input.attr('type', 'text');
        $(this).html('<i class="bi bi-eye-fill"></i>');
    } else {
        input.attr('type', 'password');
        $(this).html('<i class="bi bi-eye-slash-fill"></i>');
    }
});