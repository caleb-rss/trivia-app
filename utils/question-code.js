function normalizeQuestionCode(
    value,
    width = 5
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }


    const match =
        String(value)
            .trim()
            .toUpperCase()
            .match(/^Q(\d+)$/);


    if (!match) {
        return null;
    }


    const number =
        Number.parseInt(
            match[1],
            10
        );


    if (Number.isNaN(number)) {
        return null;
    }


    return (
        "Q" +
        String(number).padStart(
            width,
            "0"
        )
    );
}


module.exports = {
    normalizeQuestionCode
};