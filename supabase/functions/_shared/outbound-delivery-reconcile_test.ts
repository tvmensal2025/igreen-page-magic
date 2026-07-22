import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isAckOk,
  isPendingStale,
  mapWhapiDeliveryStatus,
  shouldUpgradeDelivery,
  RECONCILE_PENDING_STALE_MS,
} from "./outbound-delivery-reconcile.ts";

Deno.test("mapWhapiDeliveryStatus covers string and numeric codes", () => {
  assertEquals(mapWhapiDeliveryStatus("pending"), "pending");
  assertEquals(mapWhapiDeliveryStatus("delivered"), "delivered");
  assertEquals(mapWhapiDeliveryStatus("read"), "read");
  assertEquals(mapWhapiDeliveryStatus("failed"), "failed");
  assertEquals(mapWhapiDeliveryStatus(1), "pending");
  assertEquals(mapWhapiDeliveryStatus(3), "delivered");
  assertEquals(mapWhapiDeliveryStatus(4), "read");
});

Deno.test("shouldUpgradeDelivery never downgrades delivered→pending", () => {
  assertEquals(shouldUpgradeDelivery("delivered", "pending"), false);
  assertEquals(shouldUpgradeDelivery("queued", "delivered"), true);
  assertEquals(shouldUpgradeDelivery("sent", "failed"), true);
});

Deno.test("isAckOk accepts sent/delivered/read", () => {
  assertEquals(isAckOk("sent"), true);
  assertEquals(isAckOk("delivered"), true);
  assertEquals(isAckOk("queued"), false);
  assertEquals(isAckOk("pending"), false);
});

Deno.test("isPendingStale after threshold", () => {
  const old = new Date(Date.now() - RECONCILE_PENDING_STALE_MS - 1000).toISOString();
  const fresh = new Date(Date.now() - 60_000).toISOString();
  assertEquals(isPendingStale(old), true);
  assertEquals(isPendingStale(fresh), false);
});
