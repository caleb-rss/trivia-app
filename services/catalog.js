const db = require("../db/database");

function clean(value) {
    if (value === undefined || value === null) return null;
    const result = String(value).trim();
    return result === "" ? null : result;
}

function normalize(value) {
    const cleaned = clean(value);
    if (!cleaned) return "";
    return cleaned
        .toLowerCase()
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/&/g, " and ")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenize(value) {
    return new Set(
        normalize(value)
            .split(" ")
            .filter(token => token.length > 2)
    );
}

function jaccardSimilarity(firstValue, secondValue) {
    const first = tokenize(firstValue);
    const second = tokenize(secondValue);
    if (first.size === 0 || second.size === 0) return 0;
    let intersection = 0;
    for (const token of first) {
        if (second.has(token)) intersection++;
    }
    const union = new Set([...first, ...second]).size;
    return union === 0 ? 0 : intersection / union;
}

function lengthSimilarity(firstValue, secondValue) {
    const first = normalize(firstValue);
    const second = normalize(secondValue);
    if (!first || !second) return 0;
    const shorter = Math.min(first.length, second.length);
    const longer = Math.max(first.length, second.length);
    return longer === 0 ? 0 : shorter / longer;
}

function getCatalog({ search = "", filter = "all", topic = "", limit = 500 }) {
    const where = [];
    const params = { limit };

    if (search) {
        where.push(`(
            q.question LIKE @search
            OR q.answer LIKE @search
            OR q.topic LIKE @search
            OR q.format LIKE @search
            OR q.question_code LIKE @search
        )`);
        params.search = `%${search}%`;
    }

    if (topic) {
        where.push("q.topic = @topic");
        params.topic = topic;
    }

    if (filter === "missing_difficulty") where.push("q.difficulty IS NULL");
    if (filter === "missing_topic") where.push("(q.topic IS NULL OR TRIM(q.topic) = '')");
    if (filter === "missing_format") where.push("(q.format IS NULL OR TRIM(q.format) = '')");
    if (filter === "review") where.push("q.needs_review = 1");
    if (filter === "disabled") where.push("q.enabled = 0");
    if (filter === "enabled") where.push("q.enabled = 1");

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    return db.prepare(`
        SELECT
            q.id,
            q.question_code,
            q.question,
            q.answer,
            q.topic,
            q.format,
            q.difficulty,
            q.enabled,
            q.needs_review,
            COUNT(CASE WHEN ts.status = 'played' THEN sq.id END) AS times_used,
            MAX(CASE WHEN ts.status = 'played' THEN ts.played_at END) AS last_used
        FROM questions q
        LEFT JOIN set_questions sq ON sq.question_id = q.id
        LEFT JOIN trivia_sets ts ON ts.id = sq.set_id
        ${whereClause}
        GROUP BY q.id
        ORDER BY q.question_code ASC
        LIMIT @limit
    `).all(params);
}

function getTopics() {
    return db.prepare(`
        SELECT DISTINCT topic
        FROM questions
        WHERE topic IS NOT NULL AND TRIM(topic) != ''
        ORDER BY topic
    `).all();
}

function getFormats() {
    return db.prepare(`
        SELECT DISTINCT format
        FROM questions
        WHERE format IS NOT NULL AND TRIM(format) != ''
        ORDER BY format
    `).all();
}

function bulkUpdate({ ids, difficulty, topic, format, enabled, markReviewed }) {
    if (!ids.length) return 0;

    const statements = [];
    const params = {};

    if (difficulty !== undefined && difficulty !== "") {
        statements.push("difficulty = @difficulty");
        params.difficulty = Number(difficulty);
    }
    if (topic !== undefined && topic !== "") {
        statements.push("topic = @topic");
        params.topic = topic;
    }
    if (format !== undefined && format !== "") {
        statements.push("format = @format");
        params.format = format;
    }
    if (enabled === "1" || enabled === "0") {
        statements.push("enabled = @enabled");
        params.enabled = Number(enabled);
    }
    if (markReviewed) statements.push("needs_review = 0");
    if (!statements.length) return 0;

    statements.push("updated_at = CURRENT_TIMESTAMP");
    const placeholders = ids.map((_, index) => `@id${index}`);
    ids.forEach((id, index) => {
        params[`id${index}`] = Number(id);
    });

    return db.prepare(`
        UPDATE questions
        SET ${statements.join(", ")}
        WHERE id IN (${placeholders.join(", ")})
    `).run(params).changes;
}

function findDuplicatePairs({ threshold = 0.72, limit = 150 } = {}) {
    const questions = db.prepare(`
        SELECT id, question_code, question, answer, topic, difficulty, format
        FROM questions
        WHERE enabled = 1
        ORDER BY id
    `).all();

    const pairs = [];

    for (let i = 0; i < questions.length; i++) {
        const first = questions[i];

        for (let j = i + 1; j < questions.length; j++) {
            const second = questions[j];
            const questionScore = jaccardSimilarity(first.question, second.question);
            const answerScore = jaccardSimilarity(first.answer, second.answer);
            const exactAnswer = normalize(first.answer) === normalize(second.answer);
            const lengthScore = lengthSimilarity(first.question, second.question);

            const score =
                (questionScore * 0.65) +
                (answerScore * 0.25) +
                (lengthScore * 0.10) +
                (exactAnswer ? 0.12 : 0);

            if (score >= threshold) {
                pairs.push({ first, second, score: Math.min(score, 1) });
            }
        }
    }

    return pairs.sort((a, b) => b.score - a.score).slice(0, limit);
}

function mergeQuestions({ keeperId, duplicateId }) {
    keeperId = Number(keeperId);
    duplicateId = Number(duplicateId);

    if (!keeperId || !duplicateId || keeperId === duplicateId) {
        throw new Error("Invalid merge selection.");
    }

    const keeper = db.prepare("SELECT * FROM questions WHERE id = ?").get(keeperId);
    const duplicate = db.prepare("SELECT * FROM questions WHERE id = ?").get(duplicateId);

    if (!keeper || !duplicate) throw new Error("Question not found.");

    const transaction = db.transaction(() => {
        const duplicateUses = db.prepare(`
            SELECT id, set_id
            FROM set_questions
            WHERE question_id = ?
        `).all(duplicateId);

        for (const usage of duplicateUses) {
            const keeperAlreadyInSet = db.prepare(`
                SELECT id
                FROM set_questions
                WHERE set_id = ? AND question_id = ?
            `).get(usage.set_id, keeperId);

            if (keeperAlreadyInSet) {
                db.prepare("DELETE FROM set_questions WHERE id = ?").run(usage.id);
            } else {
                db.prepare("UPDATE set_questions SET question_id = ? WHERE id = ?")
                    .run(keeperId, usage.id);
            }
        }

        db.prepare(`
            UPDATE questions
            SET
                topic = COALESCE(NULLIF(topic, ''), @duplicate_topic),
                format = COALESCE(NULLIF(format, ''), @duplicate_format),
                difficulty = COALESCE(difficulty, @duplicate_difficulty),
                needs_review = CASE
                    WHEN needs_review = 1 AND @duplicate_needs_review = 0 THEN 0
                    ELSE needs_review
                END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = @keeper_id
        `).run({
            keeper_id: keeperId,
            duplicate_topic: duplicate.topic,
            duplicate_format: duplicate.format,
            duplicate_difficulty: duplicate.difficulty,
            duplicate_needs_review: duplicate.needs_review
        });

        db.prepare("DELETE FROM questions WHERE id = ?").run(duplicateId);
    });

    transaction();
    return keeper.question_code;
}

module.exports = {
    getCatalog,
    getTopics,
    getFormats,
    bulkUpdate,
    findDuplicatePairs,
    mergeQuestions
};
