const os = require('os');

let prevCpu = snapshotCpu();

function snapshotCpu() {
    return os.cpus().map(c => ({
        idle: c.times.idle,
        total: Object.values(c.times).reduce((a, b) => a + b, 0)
    }));
}

// Persentase pemakaian CPU sejak pemanggilan sebelumnya
function cpuUsagePercent() {
    const now = snapshotCpu();
    let idle = 0, total = 0;
    now.forEach((c, i) => {
        idle += c.idle - (prevCpu[i]?.idle || 0);
        total += c.total - (prevCpu[i]?.total || 0);
    });
    prevCpu = now;
    return total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}

function getIPv4() {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
        (list || []).forEach(i => {
            if (i.family === 'IPv4' && !i.internal) out.push(`${name}: ${i.address}`);
        });
    }
    return out;
}

function getServerStats() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const mem = process.memoryUsage();
    return {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        nodeVersion: process.version,
        pid: process.pid,
        ips: getIPv4(),
        uptimeSystem: os.uptime(),
        uptimeProcess: process.uptime(),
        cpu: {
            cores: os.cpus().length,
            model: os.cpus()[0]?.model || '-',
            usage: cpuUsagePercent(),
            load: os.loadavg().map(v => Math.round(v * 100) / 100)
        },
        ram: {
            total, used, free,
            percent: Math.round((used / total) * 1000) / 10
        },
        process: {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal
        },
        time: new Date()
    };
}

module.exports = { getServerStats };

