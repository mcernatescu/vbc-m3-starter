import { updateRequestStatus } from "../../../../lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    if (typeof id !== "string" || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
      return Response.json(
        { error: "Request ID must be a positive whole number." },
        { status: 400 }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!["New", "In Progress", "Complete"].includes(body?.status)) {
      return Response.json(
        { error: "Status must be New, In Progress, or Complete." },
        { status: 400 }
      );
    }

    const updatedRequest = await updateRequestStatus(Number(id), body.status);
    if (!updatedRequest) {
      return Response.json({ error: "Request not found." }, { status: 404 });
    }
    return Response.json({ request: updatedRequest }, { status: 200 });
  } catch {
    return Response.json(
      { error: "Could not update the request status in the seed CSV." },
      { status: 500 }
    );
  }
}
