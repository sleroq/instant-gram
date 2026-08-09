function normalize(value: string) {
    return value.normalize('NFKD').replaceAll(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

function tokenScore(candidate: string, query: string) {
    if (candidate.startsWith(query)) return query.length * 8 - candidate.length * 0.01;
    const contiguous = candidate.indexOf(query);
    if (contiguous >= 0) return query.length * 5 - contiguous;
    let position = -1;
    let gap = 0;
    for (const character of query) {
        const next = candidate.indexOf(character, position + 1);
        if (next < 0) return undefined;
        if (position >= 0) gap += next - position - 1;
        position = next;
    }
    return query.length * 2 - gap * 0.25;
}

export function fuzzyMatchScore(value: string, query: string) {
    const normalizedQuery = normalize(query).trim();
    if (!normalizedQuery) return 0;
    const candidates = normalize(value).split(/\s+/).filter(Boolean);
    let total = 0;
    for (const token of normalizedQuery.split(/\s+/)) {
        const score = Math.max(...candidates.map(candidate => tokenScore(candidate, token) ?? -Infinity));
        if (!Number.isFinite(score)) return undefined;
        total += score;
    }
    return total;
}
