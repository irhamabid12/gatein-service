function handleReconnect(connectFn, ip, port) {
    console.log("Reconnect in 3 seconds...");
    setTimeout(() => {
        connectFn(ip, port);
    }, 3000);
}

module.exports = { handleReconnect };