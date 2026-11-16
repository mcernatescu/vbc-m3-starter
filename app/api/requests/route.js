import { createRequest, readRequests } from "../../../lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const requests = await readRequests();
    return Response.json({ requests }, { status: 200 });
  } catch {
    return Response.json(
      { error: "Could not load requests from the seed CSV." },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    const fieldLabels = {
      requester_name: "Requester name",
      location: "Location",
      description: "Description",
      priority: "Priority",
    };
    const fields = {};
    for (const [field, label] of Object.entries(fieldLabels)) {
      if (typeof body?.[field] !== "string") {
        return Response.json(
          { error: `${label} is required and must be text.` },
          { status: 400 }
        );
      }
      fields[field] = body[field].trim();
      if (!fields[field]) {
        return Response.json({ error: `${label} is required.` }, { status: 400 });
      }
    }

    if (!["Minneapolis", "Chicago", "Denver", "Austin"].includes(fields.location)) {
      return Response.json(
        { error: "Location must be Minneapolis, Chicago, Denver, or Austin." },
        { status: 400 }
      );
    }
    if (!["Low", "Medium", "High", "Urgent"].includes(fields.priority)) {
      return Response.json(
        { error: "Priority must be Low, Medium, High, or Urgent." },
        { status: 400 }
      );
    }
    if (fields.description.length > 500) {
      return Response.json(
        { error: "Description must be 500 characters or fewer." },
        { status: 400 }
      );
    }

    const savedRequest = await createRequest(fields);
    return Response.json({ request: savedRequest }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Could not save the request to the seed CSV." },
      { status: 500 }
    );
  }
}
