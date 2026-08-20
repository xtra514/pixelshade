async function mapWithConcurrency(items, limit, mapper) {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new RangeError('Concurrency limit must be a positive integer');
    }

    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await mapper(items[index], index);
        }
    }

    const workerCount = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

module.exports = { mapWithConcurrency };
