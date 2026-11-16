import { readRequests } from "../../../lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const requests = await readRequests();
    // The reader sorts newest first. Compare the timestamps in UTC.
    const latestDate = requests.length ? new Date(requests[0].created_at) : null;
    const summary = {
      open_requests: 0,
      urgent_open: 0,
      completed_this_month: 0,
    };

    for (const request of requests) {
      if (request.status !== "Complete") {
        summary.open_requests += 1;
        if (request.priority === "Urgent") summary.urgent_open += 1;
      } else {
        const createdAt = new Date(request.created_at);
        if (
          createdAt.getUTCFullYear() === latestDate.getUTCFullYear() &&
          createdAt.getUTCMonth() === latestDate.getUTCMonth()
        ) {
          summary.completed_this_month += 1;
        }
      }
    }

    return Response.json(summary, { status: 200 });
  } catch {
    return Response.json(
      { error: "Could not load the summary." },
      { status: 500 }
    );
  }
}
