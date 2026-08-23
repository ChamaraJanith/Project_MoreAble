// A minimal in-memory stand-in for the Firestore Admin SDK surface this project's
// +api.ts route handlers actually use: collection(name).where(field, '==', value)
// (chainable), .doc(id).get()/.set()/.update(), and a simplified runTransaction.
// Shared by tests that need more than one collection wired together (e.g. the
// Journey Search API now joins routes + trips + buses).

type DocData = Record<string, any>;

function matchesWhere(doc: DocData, field: string, op: string, value: unknown): boolean {
    if (op !== '==') {
        throw new Error(`fakeFirestore: unsupported where operator "${op}"`);
    }
    return doc[field] === value;
}

interface FakeQuery {
    where: (field: string, op: string, value: unknown) => FakeQuery;
    orderBy: (...args: unknown[]) => FakeQuery;
    limit: (...args: unknown[]) => FakeQuery;
    /**
     * Field projection. Chainable and otherwise ignored: it changes what the
     * real SDK puts on the wire, not which documents come back or what a caller
     * can read off them, so a test asserting on the result sees the same thing
     * either way.
     */
    select: (...fields: string[]) => FakeQuery;
    get: () => Promise<{ empty: boolean; docs: { id: string; exists: true; data: () => DocData }[] }>;
}

function buildQuery(docs: DocData[]): FakeQuery {
    const query: FakeQuery = {
        where: jest.fn((field: string, op: string, value: unknown) =>
            buildQuery(docs.filter((doc) => matchesWhere(doc, field, op, value)))
        ),
        orderBy: jest.fn(() => query),
        limit: jest.fn(() => query),
        select: jest.fn(() => query),
        get: jest.fn(async () => ({
            empty: docs.length === 0,
            docs: docs.map((data) => ({
                id: data.id,
                exists: true as const,
                data: () => data,
            })),
        })),
    };
    return query;
}

export function createFakeFirestore(seed: Record<string, DocData[]> = {}) {
    const collections = new Map<string, DocData[]>(
        Object.entries(seed).map(([name, docs]) => [
            name,
            docs.map((doc) => ({
                id: doc.id || doc.bookingId || doc.tripId || doc.busId || doc.routeId || doc.userId || doc.stopId,
                ...doc,
            })),
        ])
    );

    function getCollectionDocs(name: string): DocData[] {
        if (!collections.has(name)) {
            collections.set(name, []);
        }
        return collections.get(name)!;
    }

    const collectionFn = jest.fn((name: string) => {
        const docs = getCollectionDocs(name);
        const query = buildQuery(docs);

        return {
            ...query,
            doc: jest.fn((id: string) => {
                const found = docs.find((d) => d.id === id || d.bookingId === id);

                return {
                    id,
                    get: jest.fn(async () => ({
                        exists: !!found,
                        id,
                        data: () => found,
                    })),
                    update: jest.fn(async (data: DocData) => {
                        if (found) {
                            Object.assign(found, data);
                        }
                    }),
                    set: jest.fn(async (data: DocData) => {
                        if (found) {
                            Object.assign(found, data);
                        } else {
                            docs.push({ id, ...data });
                        }
                    }),
                    delete: jest.fn(async () => {
                        const index = docs.findIndex((d) => d.id === id);
                        if (index !== -1) docs.splice(index, 1);
                    }),
                };
            }),
        };
    });

    return {
        collection: collectionFn,
        runTransaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => {
            const transaction = {
                get: jest.fn((ref: any) => ref.get()),
                set: jest.fn((ref: any, data: DocData) => ref.set(data)),
                update: jest.fn((ref: any, data: DocData) => ref.update(data)),
            };
            return callback(transaction);
        }),
    };
}