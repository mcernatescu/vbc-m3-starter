import { readRequests } from "../../../lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const requests = await readRequests();
    const columns = [
      "created_at",
      "requester_name",
      "location",
      "description",
      "priority",
      "status",
    ];
    // Quoting every value preserves commas and line breaks; double embedded quotes.
    const rows = requests.map((request) =>
      columns.map((column) => `"${request[column].replaceAll('"', '""')}"`).join(",")
    );
    const csv = [columns.join(","), ...rows].join("\r\n") + "\r\n";

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="morrowlane-requests.csv"',
      },
    });
  } catch {
    return Response.json(
      { error: "Could not export requests." },
      { status: 500 }
    );
  }
}
