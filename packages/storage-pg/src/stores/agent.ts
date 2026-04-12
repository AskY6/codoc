import type { AgentId, AgentListing } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type {
  AgentStore,
  Clock,
  Ctx,
  Rev,
  StoredAgent,
  Timestamp,
  UpdateAgentInput,
} from "@cobook/storage";
import { and, eq } from "drizzle-orm";
import { pgDb } from "../ctx.js";
import { isUniqueViolation } from "../pg-error.js";
import { agents } from "../schema.js";

interface Deps {
  readonly clock: Clock;
}

interface Row {
  id: string;
  name: string;
  description: string;
  rev: string;
  createdAt: number;
  updatedAt: number;
}

function toStored(row: Row): StoredAgent {
  return {
    listing: {
      id: row.id as AgentId,
      name: row.name,
      description: row.description,
    },
    rev: row.rev as Rev,
    createdAt: row.createdAt as Timestamp,
    updatedAt: row.updatedAt as Timestamp,
  };
}

export function createPgAgentStore(deps: Deps): AgentStore {
  return {
    async get(ctx: Ctx, id: AgentId) {
      const db = pgDb(ctx);
      const row = await db
        .select()
        .from(agents)
        .where(eq(agents.id, id as string))
        .then((r) => r[0]);
      if (!row) return err({ kind: "agent-not-found" as const });
      return ok(toStored(row));
    },

    async list(ctx: Ctx) {
      const db = pgDb(ctx);
      const rows = await db.select().from(agents);
      return rows.map(toStored);
    },

    async create(ctx: Ctx, listing: AgentListing) {
      const db = pgDb(ctx);
      const now = deps.clock.now();
      const rev = crypto.randomUUID() as Rev;
      try {
        const row = await db
          .insert(agents)
          .values({
            id: listing.id as string,
            name: listing.name,
            description: listing.description,
            rev: rev as string,
            createdAt: now as number,
            updatedAt: now as number,
          })
          .returning()
          .then((r) => r[0]!);
        return ok(toStored(row));
      } catch (e) {
        if (isUniqueViolation(e))
          return err({ kind: "agent-already-exists" as const });
        throw e;
      }
    },

    async update(ctx: Ctx, input: UpdateAgentInput) {
      const db = pgDb(ctx);
      const now = deps.clock.now();
      const newRev = crypto.randomUUID() as Rev;
      const { listing, expectedRev } = input;

      const rows = await db
        .update(agents)
        .set({
          name: listing.name,
          description: listing.description,
          rev: newRev as string,
          updatedAt: now as number,
        })
        .where(
          and(
            eq(agents.id, listing.id as string),
            eq(agents.rev, expectedRev as string),
          )!,
        )
        .returning();

      if (rows.length === 0) {
        const existing = await db
          .select({ rev: agents.rev })
          .from(agents)
          .where(eq(agents.id, listing.id as string))
          .then((r) => r[0]);
        if (!existing) return err({ kind: "agent-not-found" as const });
        return err({
          kind: "agent-conflict" as const,
          currentRev: existing.rev as Rev,
        });
      }

      return ok(toStored(rows[0]!));
    },

    async delete(ctx: Ctx, id: AgentId) {
      const db = pgDb(ctx);
      const rows = await db
        .delete(agents)
        .where(eq(agents.id, id as string))
        .returning({ id: agents.id });
      if (rows.length === 0)
        return err({ kind: "agent-not-found" as const });
      return ok(undefined);
    },
  };
}
