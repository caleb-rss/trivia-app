const express = require("express");

const {
    getCatalog,
    getTopics,
    getFormats,
    bulkUpdate,
    findDuplicatePairs,
    mergeQuestions
} = require("../services/catalog");

const router = express.Router();

router.get("/", (req, res) => {
    const search = (req.query.search || "").trim();
    const filter = req.query.filter || "all";
    const topic = (req.query.topic || "").trim();

    res.render("catalog", {
        questions: getCatalog({ search, filter, topic, limit: 500 }),
        topics: getTopics(),
        formats: getFormats(),
        search,
        filter,
        topic,
        updated: req.query.updated || null
    });
});

router.post("/bulk", (req, res) => {
    const ids = Array.isArray(req.body.ids)
        ? req.body.ids
        : req.body.ids
            ? [req.body.ids]
            : [];

    const changes = bulkUpdate({
        ids,
        difficulty: req.body.bulk_difficulty,
        topic: req.body.bulk_topic,
        format: req.body.bulk_format,
        enabled: req.body.bulk_enabled,
        markReviewed: req.body.mark_reviewed === "on"
    });

    res.redirect(`/catalog?updated=${changes}`);
});

router.get("/duplicates", (req, res) => {
    const threshold = Math.max(
        0.5,
        Math.min(Number(req.query.threshold) || 0.72, 0.98)
    );

    res.render("catalog-duplicates", {
        pairs: findDuplicatePairs({ threshold, limit: 150 }),
        threshold
    });
});

router.post("/merge", (req, res) => {
    try {
        const keeperCode = mergeQuestions({
            keeperId: req.body.keeper_id,
            duplicateId: req.body.duplicate_id
        });

        res.redirect(`/catalog/duplicates?merged=${encodeURIComponent(keeperCode)}`);
    } catch (error) {
        res.status(400).send(error.message);
    }
});

module.exports = router;
