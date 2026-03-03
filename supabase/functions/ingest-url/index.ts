import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function detectPlatform(url: string): string {
  const domain = extractDomain(url).toLowerCase();
  if (domain.includes("linkedin.com")) return "linkedin";
  if (domain.includes("reddit.com")) return "reddit";
  if (domain.includes("youtube.com") || domain.includes("youtu.be"))
    return "youtube";
  return "web";
}

/** Perform the actual save operation -- shared by POST and GET handlers */
async function saveUrl(
  url: string,
  title: string,
  ts?: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
  // Validate URL
  if (!url || typeof url !== "string") {
    return { status: 400, body: { error: "Missing or invalid 'url' field" } };
  }

  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith("http")) {
      return {
        status: 400,
        body: { error: "URL must use http or https protocol" },
      };
    }
  } catch {
    return { status: 400, body: { error: "Invalid URL format" } };
  }

  // Create Supabase client
  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  );

  // Check for duplicate source_url
  const { data: existing, error: dupError } = await supabaseClient
    .from("content_items")
    .select("id, title")
    .eq("source_url", url)
    .limit(1);

  if (dupError) {
    return {
      status: 500,
      body: {
        error: "Database error checking duplicates",
        details: dupError.message,
      },
    };
  }

  if (existing && existing.length > 0) {
    return {
      status: 409,
      body: {
        success: false,
        duplicate: true,
        existing_id: existing[0].id,
        existing_title: existing[0].title,
        message: "URL already exists in IMS",
      },
    };
  }

  // Build the record
  const sourceDomain = extractDomain(url);
  const platform = detectPlatform(url);
  const pageTitle = (title && typeof title === "string" ? title : "").slice(
    0,
    500,
  );
  const queuedAt = ts ? new Date(ts).toISOString() : new Date().toISOString();

  const record = {
    title: pageTitle || sourceDomain,
    content: "",
    source_url: url,
    source_domain: sourceDomain,
    platform: platform,
    content_type: "bookmark",
    captured_date: queuedAt,
    metadata: {
      ingestion_source: "bookmarklet",
      bookmarklet_title: pageTitle,
      queued_at: queuedAt,
    },
  };

  // Insert
  const { data: inserted, error: insertError } = await supabaseClient
    .from("content_items")
    .insert(record)
    .select("id")
    .single();

  if (insertError) {
    return {
      status: 500,
      body: { error: "Failed to insert record", details: insertError.message },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      id: inserted.id,
      title: record.title,
      message: "Saved to IMS queue",
    },
  };
}

const IMS_APP_URL = "https://ims-xi-ten.vercel.app";

/** Build a redirect URL to the IMS /saved page based on the save result */
function buildRedirectUrl(result: {
  status: number;
  body: Record<string, unknown>;
}): string {
  const { body } = result;
  const base = `${IMS_APP_URL}/saved`;

  if (body.duplicate) {
    const existingTitle = String(body.existing_title || "Duplicate URL");
    return `${base}?status=duplicate&existing_title=${encodeURIComponent(existingTitle)}`;
  } else if (body.success) {
    const title = String(body.title || "");
    return `${base}?status=ok&title=${encodeURIComponent(title)}`;
  } else {
    const error = String(body.error || "Unknown error");
    return `${base}?status=error&error=${encodeURIComponent(error)}`;
  }
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // --- GET: Popup mode (bookmarklet via window.open) ---
  // The save happens server-side, then the popup is redirected to the IMS
  // Next.js app at /saved which renders the result natively. This avoids
  // Chrome's cross-origin HTML sandboxing that caused raw HTML to display.
  if (req.method === "GET") {
    const params = new URL(req.url).searchParams;
    const url = params.get("url") ?? "";
    const title = params.get("title") ?? "";

    if (!url) {
      const redirectUrl = `${IMS_APP_URL}/saved?status=error&error=${encodeURIComponent("Missing ?url= parameter")}`;
      return new Response(null, {
        status: 302,
        headers: { "Location": redirectUrl },
      });
    }

    const result = await saveUrl(url, title);
    const redirectUrl = buildRedirectUrl(result);

    return new Response(null, {
      status: 302,
      headers: { "Location": redirectUrl },
    });
  }

  // --- POST: JSON API (existing behavior, unchanged) ---
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Parse request body
  let body: { url?: string; title?: string; ts?: number };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { url, title, ts } = body;

  if (!url || typeof url !== "string") {
    return jsonResponse({ error: "Missing or invalid 'url' field" }, 400);
  }

  const result = await saveUrl(url, title ?? "", ts);
  return jsonResponse(result.body, result.status);
});
