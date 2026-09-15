const express = require("express");
const path = require("path");

const importRoutes =
    require("./routes/import");

const questionRoutes = require("./routes/questions");
const generatorRoutes = require("./routes/generator");
const setRoutes = require("./routes/sets");

const db = require("./db/database");
const catalogRoutes = require("./routes/catalog");


const app = express();
const PORT = 3001;

app.set("view engine", "ejs");

app.set(
    "views",
    path.join(__dirname, "views")
);

app.use(
    express.urlencoded({
        extended: true
    })
);

app.use(express.json());

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

app.use(
    "/import",
    importRoutes
);


/* =========================================================
   DASHBOARD
========================================================= */

app.get("/", (req, res) => {
    const stats = db.prepare(`
        SELECT
            COUNT(*) AS total,

            SUM(
                CASE
                    WHEN enabled = 1
                    THEN 1
                    ELSE 0
                END
            ) AS enabled,

            SUM(
                CASE
                    WHEN needs_review = 1
                    THEN 1
                    ELSE 0
                END
            ) AS needs_review

        FROM questions
    `).get();


    const usage = db.prepare(`
        SELECT
            COUNT(DISTINCT question_id)
                AS questions_used,

            COUNT(*)
                AS historical_uses

        FROM set_questions
    `).get();


    const neverUsed = db.prepare(`
        SELECT
            COUNT(*) AS count

        FROM questions q

        WHERE NOT EXISTS (
            SELECT 1
            FROM set_questions sq
            WHERE sq.question_id = q.id
        )
    `).get();


    const sets = db.prepare(`
        SELECT
            COUNT(*) AS count
        FROM trivia_sets
    `).get();


    res.render(
        "index",
        {
            stats,
            usage,
            neverUsed:
                neverUsed.count,

            sets:
                sets.count
        }
    );
});


/* =========================================================
   ROUTES
========================================================= */

app.use(
    "/questions",
    questionRoutes
);

app.use(
    "/generate",
    generatorRoutes
);

app.use(
    "/sets",
    setRoutes
);

app.use("/catalog", catalogRoutes);



/* =========================================================
   START
========================================================= */

app.listen(
    PORT,
    () => {
        console.log(
            `Trivia app running at http://localhost:${PORT}`
        );
    }
);