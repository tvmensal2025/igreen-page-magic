/** Auth helpers para edge functions (cron / service_role). */

export function isServiceRoleAuth(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (serviceRole && authHeader === `Bearer ${serviceRole}`) return true;
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt || jwt.split(".").length < 2) return false;
  try {
    const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(b64 + pad));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}
