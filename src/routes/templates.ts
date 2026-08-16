import { Hono } from "hono";
import { requireAuth, type AuthContext } from "../lib/auth";
import { getTemplate, listTemplates } from "../lib/templates";
import { jsonError } from "../lib/http";

type AppEnv = { Bindings: Env; Variables: { auth: AuthContext } };

export const templateRoutes = new Hono<AppEnv>();

templateRoutes.use("*", requireAuth);

templateRoutes.get("/", (c) => c.json({ templates: listTemplates() }));

templateRoutes.get("/:id", (c) => {
  const template = getTemplate(c.req.param("id"));
  if (!template) return jsonError(c, 404, "Template not found.");
  return c.json(template);
});
