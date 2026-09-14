const express =
    require("express");


const {
    getTopics,
    generateSet,
    rerollQuestion
} = require(
    "../services/generator"
);


const router =
    express.Router();


/* =========================================================
   GENERATOR FORM
========================================================= */

router.get(
    "/",
    (req, res) => {

        res.render(
            "generate",
            {
                topics:
                    getTopics()
            }
        );
    }
);


/* =========================================================
   GENERATE SET
========================================================= */

router.post(
    "/",
    (req, res) => {

        const count =
            Math.max(
                1,
                Math.min(
                    Number(
                        req.body.count
                    ) || 30,

                    100
                )
            );


        const minWeeks =
            Math.max(
                0,
                Number(
                    req.body.min_weeks
                ) || 0
            );


        const topic =
            (
                req.body.topic ||
                ""
            ).trim();


        const preferUnused =
            req.body
                .prefer_unused ===
            "on";


        const balanceTopics =
            req.body
                .balance_topics ===
            "on";


        const selected =
            generateSet({
                count,
                minWeeks,
                topic,
                preferUnused,
                balanceTopics
            });


        res.render(
            "generated-set",
            {
                selected,

                settings: {
                    count,
                    minWeeks,
                    topic,
                    preferUnused,
                    balanceTopics
                }
            }
        );
    }
);


/* =========================================================
   REROLL ONE QUESTION
========================================================= */

router.post(
    "/reroll",
    (req, res) => {

        const minWeeks =
            Math.max(
                0,
                Number(
                    req.body.minWeeks
                ) || 0
            );


        const topic =
            (
                req.body.topic ||
                ""
            ).trim();


        const preferUnused =
            Boolean(
                req.body
                    .preferUnused
            );


        const balanceTopics =
            Boolean(
                req.body
                    .balanceTopics
            );


        const excludeIds =
            Array.isArray(
                req.body.excludeIds
            )
                ? req.body.excludeIds
                : [];


        const question =
            rerollQuestion({
                minWeeks,
                topic,
                preferUnused,
                balanceTopics,
                excludeIds
            });


        if (!question) {

            return res
                .status(404)
                .json({
                    error:
                        "No eligible replacement found."
                });
        }


        res.json(
            question
        );
    }
);


/* =========================================================
   EXPORT
========================================================= */

module.exports =
    router;