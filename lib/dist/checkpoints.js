// SQLite schema and checkpoint semantics adapted from LangChain's MIT-licensed
// SqliteSaver 1.0.4. See THIRD_PARTY_NOTICES.md. Uses Node's built-in driver so
// one installation works when different host agents select different Node ABIs.
import { DatabaseSync } from "node:sqlite";
import { BaseCheckpointSaver, TASKS, WRITES_IDX_MAP, copyCheckpoint, maxChannelVersion, } from "@langchain/langgraph-checkpoint";
export class SqliteSaver extends BaseCheckpointSaver {
    db;
    constructor(db, serde) {
        super(serde);
        this.db = db;
        db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL DEFAULT '', checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT, type TEXT, checkpoint BLOB, metadata BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id));
      CREATE TABLE IF NOT EXISTS writes (
        thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL DEFAULT '', checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL, idx INTEGER NOT NULL, channel TEXT NOT NULL, type TEXT, value BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx));`);
        // Preparing explicit column selections also rejects incompatible existing schemas.
        db.prepare("SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata FROM checkpoints LIMIT 0").all();
        db.prepare("SELECT thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value FROM writes LIMIT 0").all();
    }
    static fromConnString(path) {
        return new SqliteSaver(new DatabaseSync(path));
    }
    transaction(action) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
            action();
            this.db.exec("COMMIT");
        }
        catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }
    async tuple(row) {
        const checkpoint = (await this.serde.loadsTyped(row.type ?? "json", row.checkpoint));
        const writes = this.db
            .prepare("SELECT task_id, channel, type, value FROM writes WHERE thread_id=? AND checkpoint_ns=? AND checkpoint_id=? ORDER BY task_id, idx")
            .all(row.thread_id, row.checkpoint_ns, row.checkpoint_id);
        if (checkpoint.v < 4 && row.parent_checkpoint_id) {
            const sends = this.db
                .prepare("SELECT type, value FROM writes WHERE thread_id=? AND checkpoint_ns=? AND checkpoint_id=? AND channel=? ORDER BY idx")
                .all(row.thread_id, row.checkpoint_ns, row.parent_checkpoint_id, TASKS);
            checkpoint.channel_values[TASKS] = await Promise.all(sends.map((w) => this.serde.loadsTyped(w.type ?? "json", w.value)));
            checkpoint.channel_versions[TASKS] = Object.keys(checkpoint.channel_versions).length
                ? maxChannelVersion(...Object.values(checkpoint.channel_versions))
                : this.getNextVersion(undefined);
        }
        return {
            config: {
                configurable: {
                    thread_id: row.thread_id,
                    checkpoint_ns: row.checkpoint_ns,
                    checkpoint_id: row.checkpoint_id,
                },
            },
            checkpoint,
            metadata: (await this.serde.loadsTyped(row.type ?? "json", row.metadata)),
            parentConfig: row.parent_checkpoint_id
                ? {
                    configurable: {
                        thread_id: row.thread_id,
                        checkpoint_ns: row.checkpoint_ns,
                        checkpoint_id: row.parent_checkpoint_id,
                    },
                }
                : undefined,
            pendingWrites: await Promise.all(writes.map(async (w) => [
                w.task_id,
                w.channel,
                await this.serde.loadsTyped(w.type ?? "json", w.value),
            ])),
        };
    }
    async getTuple(config) {
        const c = config.configurable ?? {};
        if (!c.thread_id)
            throw new Error("Missing checkpoint thread_id");
        const args = [c.thread_id, c.checkpoint_ns ?? ""];
        if (c.checkpoint_id)
            args.push(c.checkpoint_id);
        const row = this.db
            .prepare(`SELECT * FROM checkpoints WHERE thread_id=? AND checkpoint_ns=? ${c.checkpoint_id ? "AND checkpoint_id=?" : "ORDER BY checkpoint_id DESC LIMIT 1"}`)
            .get(...args);
        return row ? this.tuple(row) : undefined;
    }
    async *list(config, options = {}) {
        const where = [], args = [];
        const c = config.configurable ?? {};
        for (const [column, value] of [
            ["thread_id", c.thread_id],
            ["checkpoint_ns", c.checkpoint_ns],
        ]) {
            if (value !== undefined && value !== null) {
                where.push(`${column}=?`);
                args.push(value);
            }
        }
        if (options.before?.configurable?.checkpoint_id) {
            where.push("checkpoint_id<?");
            args.push(options.before.configurable.checkpoint_id);
        }
        for (const [key, value] of Object.entries(options.filter ?? {})) {
            if (value !== undefined) {
                where.push("json_extract(CAST(metadata AS TEXT), ?) IS json_extract(?, '$')");
                args.push(`$.${JSON.stringify(key)}`, JSON.stringify(value));
            }
        }
        let sql = `SELECT * FROM checkpoints ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY checkpoint_id DESC`;
        if (options.limit !== undefined) {
            sql += " LIMIT ?";
            args.push(Math.max(0, Math.floor(options.limit)));
        }
        const rows = this.db.prepare(sql).all(...args);
        for (const row of rows)
            yield await this.tuple(row);
    }
    async put(config, checkpoint, metadata) {
        const c = config.configurable ?? {};
        if (!c.thread_id)
            throw new Error("Missing checkpoint thread_id");
        const [[type, body], [metadataType, meta]] = await Promise.all([
            this.serde.dumpsTyped(copyCheckpoint(checkpoint)),
            this.serde.dumpsTyped(metadata),
        ]);
        if (type !== metadataType)
            throw new Error("Checkpoint and metadata serializers differ");
        this.db
            .prepare("INSERT OR REPLACE INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(c.thread_id, c.checkpoint_ns ?? "", checkpoint.id, c.checkpoint_id ?? null, type, body, meta);
        return {
            configurable: {
                thread_id: c.thread_id,
                checkpoint_ns: c.checkpoint_ns ?? "",
                checkpoint_id: checkpoint.id,
            },
        };
    }
    async putWrites(config, writes, taskId) {
        const c = config.configurable ?? {};
        if (!c.thread_id || !c.checkpoint_id)
            throw new Error("Missing checkpoint thread_id or checkpoint_id");
        const rows = await Promise.all(writes.map(async ([channel, value], index) => {
            const [type, body] = await this.serde.dumpsTyped(value);
            return [
                c.thread_id,
                c.checkpoint_ns ?? "",
                c.checkpoint_id,
                taskId,
                WRITES_IDX_MAP[channel] ?? index,
                channel,
                type,
                body,
            ];
        }));
        const statement = this.db.prepare(`INSERT ${writes.every(([channel]) => channel in WRITES_IDX_MAP) ? "OR REPLACE" : "OR IGNORE"} INTO writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        this.transaction(() => {
            for (const row of rows)
                statement.run(...row);
        });
    }
    async deleteThread(threadId) {
        this.transaction(() => {
            this.db.prepare("DELETE FROM writes WHERE thread_id=?").run(threadId);
            this.db
                .prepare("DELETE FROM checkpoints WHERE thread_id=?")
                .run(threadId);
        });
    }
}
