// Dashboard server: hanya status server service (tanpa status gate)
const fmtBytes = (b) => (b >= 1024 ** 3)
    ? (b / 1024 ** 3).toFixed(2) + ' GB'
    : (b / 1024 ** 2).toFixed(0) + ' MB';

function fmtUptime(sec) {
    sec = Math.floor(sec);
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return `${d ? d + 'h ' : ''}${h}j ${m}m ${s}d`;
}

function loadServerStatus() {
    fetch('/api/server-status').then(r => r.json()).then(d => {
        $('#sv-service').text('Running').removeClass('bg-danger').addClass('bg-success');
        $('#sv-uptime').text(fmtUptime(d.uptimeProcess));
        $('#sv-uptime-sys').text(fmtUptime(d.uptimeSystem));
        $('#sv-cpu').text(`${d.cpu.usage}% (${d.cpu.cores} core)`);
        $('#sv-load').text(d.cpu.load.join(' / '));
        $('#sv-ram').text(`${fmtBytes(d.ram.used)} / ${fmtBytes(d.ram.total)} (${d.ram.percent}%)`);
        $('#sv-ram-bar').css('width', d.ram.percent + '%')
            .toggleClass('bg-danger', d.ram.percent >= 90)
            .toggleClass('bg-warning', d.ram.percent >= 75 && d.ram.percent < 90);
        $('#sv-clients').text(d.socketClients);
        $('#sv-host').text(d.hostname);
        $('#sv-os').text(d.platform);
        $('#sv-ips').text(d.ips.join(', ') || '-');
        $('#sv-node').text(`${d.nodeVersion} / ${d.pid}`);
        $('#sv-proc').text(`RSS ${fmtBytes(d.process.rss)}, Heap ${fmtBytes(d.process.heapUsed)} / ${fmtBytes(d.process.heapTotal)}`);
    }).catch(() => {
        $('#sv-service').text('Tidak terjangkau').removeClass('bg-success').addClass('bg-danger');
    });
}

// Status running tiap gate: Connected / Not Connected (koneksi TCP ke controller)
function renderGateRunning(gates) {
    const body = $('#gate-running').empty();
    const on = gates.filter(g => g.status && g.status.connected).length;
    $('#gate-summary').text(`${on} / ${gates.length} connected`)
        .toggleClass('bg-success', gates.length > 0 && on === gates.length)
        .toggleClass('bg-warning text-dark', on > 0 && on < gates.length)
        .toggleClass('bg-danger', on === 0 && gates.length > 0)
        .toggleClass('bg-secondary', gates.length === 0);
    gates.forEach(g => {
        const st = g.status || {};
        let badge = '<span class="badge bg-danger">Not Connected</span>';
        if (st.connected) badge = '<span class="badge bg-success">Connected</span>';
        else if (st.connecting) badge = '<span class="badge bg-warning text-dark">Connecting...</span>';
        else if (st.disconnecting) badge = '<span class="badge bg-secondary">Disconnected</span>';
        body.append($('<tr>')
            .append($('<td>').append($('<a>').attr('href', `/gate/${encodeURIComponent(g.gate_id)}`).text(g.nama_gate)))
            .append($('<td>').text(g.gate_id))
            .append($('<td>').text(`${st.ip || '-'}:${st.port || '-'}`))
            .append($('<td class="text-center">').html(badge)));
    });
}

function loadGates(rebuildMenus = true) {
    fetch('/api/gates').then(r => r.json()).then(d => {
        if (!d.success) return;
        renderGateRunning(d.gates);
        if (!rebuildMenus) return;
        const sel = $('#gate-selector').empty()
            .append($('<option>').val('__server__').text('Current Status (Server)').prop('selected', true));
        const list = $('#sidebar-gate-list').empty();
        d.gates.forEach(g => {
            const id = String(g.gate_id);
            sel.append($('<option>').val(id).text(`${g.nama_gate} (${id})`));
            list.append($('<a>').attr('href', `/gate/${encodeURIComponent(id)}`)
                .css({ fontSize: '12px' }).text(`${g.nama_gate} (${id})`));
        });
    });
}

$(document).on('change', '#gate-selector', function () {
    const v = $(this).val();
    location.href = v === '__server__' ? '/' : `/gate/${encodeURIComponent(v)}`;
});

loadServerStatus();
loadGates();
setInterval(loadServerStatus, 3000);
setInterval(() => loadGates(false), 3000);

