const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const dbPath = path.join(
    __dirname,
    "trivia.db"
);

const schemaPath = path.join(
    __dirname,
    "schema.sql"
);

const db = new Database(dbPath);


/*
 * SQLite settings
 */
db.pragma("foreign_keys = ON");

/*
 * WAL is generally nicer for a web application because reads
 * do not block writes as aggressively.
 */
db.pragma("journal_mode = WAL");


/*
 * Initialize schema.
 */
const schema =
    fs.readFileSync(
        schemaPath,
        "utf8"
    );

db.exec(schema);


module.exports = db;