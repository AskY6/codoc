import { describe, it, expect, vi } from "vitest";
import { DataTree } from "../data-tree.js";
import { registerLoader } from "../loader/registry.js";
import type { LoaderFn } from "../types.js";

describe("DataTree", () => {
  describe("construction", () => {
    it("builds fields from flat data", () => {
      const tree = new DataTree({
        type: {
          properties: {
            title: { type: "string" },
            count: { type: "number" },
          },
        },
        data: {
          title: "Hello",
          count: 42,
        },
      });
      expect(tree.getAllPaths()).toContain("/title");
      expect(tree.getAllPaths()).toContain("/count");
    });

    it("builds fields from nested data (3+ levels)", () => {
      const tree = new DataTree({
        type: {
          properties: {
            user: {
              type: "object",
              properties: {
                profile: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    age: { type: "number" },
                  },
                },
              },
            },
          },
        },
        data: {
          user: {
            profile: {
              name: "Alice",
              age: 30,
            },
          },
        },
      });
      expect(tree.getAllPaths()).toContain("/user");
      expect(tree.getAllPaths()).toContain("/user/profile");
      expect(tree.getAllPaths()).toContain("/user/profile/name");
      expect(tree.getAllPaths()).toContain("/user/profile/age");
    });

    it("detects $ref declarations in data", () => {
      const tree = new DataTree({
        type: {
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
          },
        },
        data: {
          title: "Hello",
          summary: { $ref: "/title" },
        },
      });
      const summaryField = tree.getField("/summary");
      expect(summaryField?.meta.loader).toEqual({
        type: "ref",
        $ref: "/title",
      });
    });
  });

  describe("observe / force", () => {
    it("resolves literal fields", async () => {
      const tree = new DataTree({
        type: {
          properties: {
            title: { type: "string" },
            count: { type: "number" },
          },
        },
        data: {
          title: "Hello",
          count: 42,
        },
      });
      expect(await tree.observe("/title")).toBe("Hello");
      expect(await tree.observe("/count")).toBe(42);
    });

    it("resolves $ref fields by following the reference", async () => {
      const tree = new DataTree({
        type: {
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
          },
        },
        data: {
          title: "Hello CoDoc",
          summary: { $ref: "/title" },
        },
      });
      expect(await tree.observe("/summary")).toBe("Hello CoDoc");
    });

    it("resolves chained $ref fields (A → B → C)", async () => {
      const tree = new DataTree({
        type: {
          properties: {
            a: { type: "string" },
            b: { type: "string" },
            c: { type: "string" },
          },
        },
        data: {
          a: "origin",
          b: { $ref: "/a" },
          c: { $ref: "/b" },
        },
      });
      expect(await tree.observe("/c")).toBe("origin");
    });

    it("resolves cross-references in nested data", async () => {
      const tree = new DataTree({
        type: {
          properties: {
            user: {
              type: "object",
              properties: {
                name: { type: "string" },
              },
            },
            greeting: { type: "string" },
          },
        },
        data: {
          user: { name: "Alice" },
          greeting: { $ref: "/user/name" },
        },
      });
      expect(await tree.observe("/greeting")).toBe("Alice");
    });

    it("is idempotent: multiple observe calls return cached value", async () => {
      const tree = new DataTree({
        type: {
          properties: { title: { type: "string" } },
        },
        data: { title: "Hello" },
      });
      const v1 = await tree.observe("/title");
      const v2 = await tree.observe("/title");
      expect(v1).toBe(v2);
      expect(tree.getField("/title")?.state).toEqual({
        status: "resolved",
        value: "Hello",
      });
    });
  });

  describe("laziness", () => {
    it("unobserved fields remain idle (thunks not executed)", async () => {
      const tree = new DataTree({
        type: {
          properties: {
            observed: { type: "string" },
            unobserved: { type: "string" },
          },
        },
        data: {
          observed: "yes",
          unobserved: "no",
        },
      });

      // Only observe one field
      await tree.observe("/observed");

      // The observed field should be resolved
      expect(tree.getField("/observed")?.state.status).toBe("resolved");
      // The unobserved field should still be idle
      expect(tree.getField("/unobserved")?.state.status).toBe("idle");
    });

    it("$ref target is forced only when the referring field is observed", async () => {
      const tree = new DataTree({
        type: {
          properties: {
            source: { type: "string" },
            derived: { type: "string" },
            independent: { type: "number" },
          },
        },
        data: {
          source: "origin",
          derived: { $ref: "/source" },
          independent: 99,
        },
      });

      // Observe only the derived field
      await tree.observe("/derived");

      // source was forced as a dependency of derived
      expect(tree.getField("/source")?.state.status).toBe("resolved");
      // derived is resolved
      expect(tree.getField("/derived")?.state.status).toBe("resolved");
      // independent was never observed
      expect(tree.getField("/independent")?.state.status).toBe("idle");
    });
  });

  describe("cycle detection", () => {
    it("detects direct self-reference", async () => {
      const tree = new DataTree({
        type: {
          properties: { a: { type: "string" } },
        },
        data: {
          a: { $ref: "/a" },
        },
      });
      await expect(tree.observe("/a")).rejects.toMatchObject({
        kind: "cyclic_ref",
      });
    });

    it("detects A → B → A cycle", async () => {
      const tree = new DataTree({
        type: {
          properties: {
            a: { type: "string" },
            b: { type: "string" },
          },
        },
        data: {
          a: { $ref: "/b" },
          b: { $ref: "/a" },
        },
      });
      await expect(tree.observe("/a")).rejects.toMatchObject({
        kind: "cyclic_ref",
      });
    });

    it("detects A → B → C → A cycle with path info", async () => {
      const tree = new DataTree({
        type: {
          properties: {
            a: { type: "string" },
            b: { type: "string" },
            c: { type: "string" },
          },
        },
        data: {
          a: { $ref: "/b" },
          b: { $ref: "/c" },
          c: { $ref: "/a" },
        },
      });
      try {
        await tree.observe("/a");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.kind).toBe("cyclic_ref");
        expect(err.cycle).toBeDefined();
        expect(err.cycle.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("validation", () => {
    it("passes validation for correct types", async () => {
      const tree = new DataTree({
        type: {
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
        },
        data: {
          name: "Alice",
          age: 30,
        },
      });
      expect(await tree.observe("/name")).toBe("Alice");
      expect(await tree.observe("/age")).toBe(30);
    });

    it("throws validation error for type mismatch", async () => {
      const tree = new DataTree({
        type: {
          properties: {
            count: { type: "number" },
          },
        },
        data: {
          count: "not-a-number",
        },
      });
      await expect(tree.observe("/count")).rejects.toMatchObject({
        kind: "validation",
        path: "/count",
      });
    });

    it("validates $ref resolved values against target field schema", async () => {
      // summary has type:number but references title which is a string
      const tree = new DataTree({
        type: {
          properties: {
            title: { type: "string" },
            count: { type: "number" },
          },
        },
        data: {
          title: "Hello",
          count: { $ref: "/title" },
        },
      });
      // /title resolves fine as string
      expect(await tree.observe("/title")).toBe("Hello");
      // /count expects number but gets string "Hello" via $ref
      await expect(tree.observe("/count")).rejects.toMatchObject({
        kind: "validation",
        path: "/count",
      });
    });
  });

  describe("error handling", () => {
    it("throws ref_not_found for non-existent path", async () => {
      const tree = new DataTree({
        type: { properties: { a: { type: "string" } } },
        data: { a: { $ref: "/nonexistent" } },
      });
      await expect(tree.observe("/a")).rejects.toMatchObject({
        kind: "ref_not_found",
      });
    });

    it("throws ref_not_found for observing non-existent field", async () => {
      const tree = new DataTree({
        type: { properties: {} },
        data: {},
      });
      await expect(tree.observe("/ghost")).rejects.toMatchObject({
        kind: "ref_not_found",
      });
    });

    it("re-throws cached error on subsequent observe", async () => {
      const tree = new DataTree({
        type: { properties: { a: { type: "string" } } },
        data: { a: { $ref: "/nonexistent" } },
      });
      await expect(tree.observe("/a")).rejects.toMatchObject({
        kind: "ref_not_found",
      });
      // Second call should re-throw the same cached error
      await expect(tree.observe("/a")).rejects.toMatchObject({
        kind: "ref_not_found",
      });
    });
  });

  describe("custom loader", () => {
    it("supports custom loaders via registerLoader", async () => {
      const customLoader: LoaderFn = async (field) => {
        return "custom-value";
      };
      registerLoader("custom", customLoader);

      const tree = new DataTree({
        type: { properties: { a: { type: "string" } } },
        data: { a: "placeholder" },
      });
      // Manually set field to use custom loader for testing
      const field = tree.getField("/a")!;
      (field.meta as any).loader = { type: "custom" };
      field.state = { status: "idle" };

      expect(await tree.observe("/a")).toBe("custom-value");
    });

    it("custom loader that creates a cycle triggers data-tree cycle detection", async () => {
      // A custom loader that forces its own path, bypassing ref loader's check
      const cyclicLoader: LoaderFn = async (field, context) => {
        return context.force(field.path);
      };
      registerLoader("cyclic", cyclicLoader);

      const tree = new DataTree({
        type: { properties: { x: { type: "string" } } },
        data: { x: "placeholder" },
      });
      const field = tree.getField("/x")!;
      (field.meta as any).loader = { type: "cyclic" };
      field.state = { status: "idle" };

      await expect(tree.observe("/x")).rejects.toMatchObject({
        kind: "cyclic_ref",
      });
    });

    it("wraps unknown non-FieldError thrown by loader", async () => {
      const throwingLoader: LoaderFn = async () => {
        throw new Error("unexpected boom");
      };
      registerLoader("throwing", throwingLoader);

      const tree = new DataTree({
        type: { properties: { y: {} } },
        data: { y: "placeholder" },
      });
      const field = tree.getField("/y")!;
      (field.meta as any).loader = { type: "throwing" };
      field.state = { status: "idle" };

      await expect(tree.observe("/y")).rejects.toMatchObject({
        kind: "loader",
        message: "unexpected boom",
      });
    });
  });
});
