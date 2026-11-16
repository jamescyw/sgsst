import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const backendUrl = (process.env.BACKEND_URL || process.env.API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  const { path } = await context.params;
  const target = `${backendUrl}/${path.join("/")}${request.nextUrl.search}`;

  const headers = new Headers(request.headers);
  headers.delete("host");

  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
    });

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    const message = (await response.text()).slice(0, 500) || "El backend devolvió una respuesta vacía.";
    return Response.json(
      { detail: message },
      { status: response.status || 502 },
    );
  } catch (error) {
    return Response.json(
      {
        detail: error instanceof Error
          ? `No fue posible conectar con el backend: ${error.message}`
          : "No fue posible conectar con el backend.",
      },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const OPTIONS = proxy;
