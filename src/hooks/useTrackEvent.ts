import { supabase } from "@/integrations/supabase/client";

function getDeviceType(): string {
  const width = window.innerWidth;
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

function getUtmParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get("utm_source") || null,
    utm_medium: params.get("utm_medium") || null,
    utm_campaign: params.get("utm_campaign") || null,
  };
}

export function trackClickEvent(
  consultantId: string,
  eventTarget: string,
  pageType: string
) {
  const utm = getUtmParams();
  supabase.from("page_events").insert({
    consultant_id: consultantId,
    event_type: "click",
    event_target: eventTarget,
    page_type: pageType,
    device_type: getDeviceType(),
    ...utm,
  }).then(() => {});
}

export function getTrackingMeta() {
  return {
    device_type: getDeviceType(),
    ...getUtmParams(),
  };
}
