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
    get: () => Promise<{ empty: boolean; docs: { id: string; exists: true; data: () => DocData }[] }>;
}

function buildQuery(docs: DocData[]): FakeQuery {
    const query: FakeQuery = {
        where: jest.fn((field: string, op: string, value: unknown) =>
            buildQuery(docs.filter((doc) => matchesWhere(doc, field, op, value)))
        ),
        orderBy: jest.fn(() => query),
        limit: jest.fn(() => query),
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
        Object.entries(seed).map(([name, docs]) => [name, docs.map((doc) => ({ ...doc }))])
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
                const found = docs.find((d) => d.id === id);

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
            };
            return callback(transaction);
        }),
    };
}
