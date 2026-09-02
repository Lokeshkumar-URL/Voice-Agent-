import pg from 'pg';

const passwordsToTest = ['postgres', 'admin', 'root', '123456', 'password', '1234', '0000', 'postgres123', ''];

for (const password of passwordsToTest) {
  const client = new pg.Client({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres',
    password: password,
    port: 5432,
  });

  try {
    await client.connect();
    console.log(`FOUND_CREDENTIALS: user='postgres', password='${password}'`);
    await client.end();
    process.exit(0);
  } catch (err) {
    if (err.message.includes('authentication failed')) {
      // wrong password
    } else if (err.message.includes('database')) {
      console.log(`FOUND_CREDENTIALS: user='postgres', password='${password}' (db missing)`);
      process.exit(0);
    } else {
      console.log(`Error for '${password}': ${err.message}`);
    }
  }
}

console.log('Tested all common passwords, none matched.');
