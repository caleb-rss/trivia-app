PRAGMA foreign_keys = ON;


/* =========================================================
   QUESTIONS
   ========================================================= */

CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    /*
     * Preserve your existing spreadsheet IDs like Q1001.
     * This is separate from SQLite's internal numeric ID.
     */
    question_code TEXT UNIQUE,

    format TEXT,
    topic TEXT,
    difficulty INTEGER,

    question TEXT NOT NULL,
    answer TEXT NOT NULL,

    notes TEXT,
    

    /*
     * Lets us retire questions without deleting history.
     */
    enabled INTEGER NOT NULL DEFAULT 1,

    /*
     * Legacy/import tracking.
     */
    needs_review INTEGER NOT NULL DEFAULT 0,

    legacy_last_used TEXT,
    legacy_freshness_weeks INTEGER,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


/* =========================================================
   TRIVIA SETS
   One row represents one weekly trivia session/set.
   ========================================================= */

CREATE TABLE IF NOT EXISTS trivia_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    name TEXT NOT NULL,

    played_at TEXT,

    source_sheet TEXT,

    /*
     * draft   = generated but not yet approved
     * ready   = approved for use
     * played  = actually used
     */
    status TEXT NOT NULL DEFAULT 'played',

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


/* =========================================================
   SET QUESTIONS
   Links questions to historical/generated trivia sets.
   ========================================================= */

CREATE TABLE IF NOT EXISTS set_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    set_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,

    /*
     * Order within that trivia set.
     */
    position INTEGER,

    /*
     * Optional because older sheets may not have clean rounds.
     */
    round INTEGER,

    /*
     * Useful for preserving exactly what appeared historically
     * even if a question is later edited.
     */
    question_snapshot TEXT,
    answer_snapshot TEXT,

    /*
     * How the importer matched this historical entry.
     *
     * examples:
     * exact_id
     * exact_question
     * exact_answer
     * fuzzy
     * manual
     */
    match_method TEXT,

    match_confidence REAL,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (set_id)
        REFERENCES trivia_sets(id)
        ON DELETE CASCADE,

    FOREIGN KEY (question_id)
        REFERENCES questions(id)
        ON DELETE RESTRICT,

    UNIQUE(set_id, question_id, position)
);


/* =========================================================
   UNMATCHED HISTORY
   Historical rows we could not safely connect to the bank.
   ========================================================= */

CREATE TABLE IF NOT EXISTS unmatched_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    set_id INTEGER,

    source_sheet TEXT,
    source_row INTEGER,

    question_text TEXT,
    answer_text TEXT,
    question_code TEXT,

    reason TEXT,

    reviewed INTEGER NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (set_id)
        REFERENCES trivia_sets(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS import_match_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    set_id INTEGER NOT NULL,

    source_sheet TEXT,
    source_row INTEGER,

    source_question TEXT,
    source_answer TEXT,
    source_question_code TEXT,

    candidate_question_id INTEGER,
    match_method TEXT,
    match_confidence REAL,

    selected INTEGER NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (set_id)
        REFERENCES trivia_sets(id)
        ON DELETE CASCADE,

    FOREIGN KEY (candidate_question_id)
        REFERENCES questions(id)
        ON DELETE CASCADE
);


/* =========================================================
   INDEXES
   ========================================================= */

CREATE INDEX IF NOT EXISTS idx_questions_code
    ON questions(question_code);

CREATE INDEX IF NOT EXISTS idx_questions_topic
    ON questions(topic);

CREATE INDEX IF NOT EXISTS idx_questions_difficulty
    ON questions(difficulty);

CREATE INDEX IF NOT EXISTS idx_sets_played_at
    ON trivia_sets(played_at);

CREATE INDEX IF NOT EXISTS idx_set_questions_question
    ON set_questions(question_id);

CREATE INDEX IF NOT EXISTS idx_set_questions_set
    ON set_questions(set_id);