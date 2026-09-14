console.log("Starting DB test...");

const db = require("../db/database");

console.log("Database loaded.");

const tables = db
    .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
    `)
    .all();

console.log("Tables found:");

console.log(tables);

console.log("DB test complete.");