import net from 'net';

function checkPort(host, port, name) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => {
      console.log(`[OK] ${name} is reachable on ${host}:${port}`);
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      console.log(`[FAIL] ${name} timed out on ${host}:${port}`);
      socket.destroy();
      resolve(false);
    });
    socket.on('error', (err) => {
      console.log(`[FAIL] ${name} error on ${host}:${port}: ${err.message}`);
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function main() {
  await checkPort('localhost', 5433, 'PostgreSQL (port 5433)');
  await checkPort('localhost', 5432, 'PostgreSQL (port 5432)');
  await checkPort('localhost', 6379, 'Redis (port 6379)');
  await checkPort('localhost', 1112, 'Zea Voice Backend (port 1112)');
  await checkPort('localhost', 5020, 'Zea Voice Frontend (port 5020)');
  await checkPort('127.0.0.1', 6333, 'Qdrant (port 6333)');
  await checkPort('127.0.0.1', 1113, 'Embedding (port 1113)');
}
main();
