import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

// Respect quoted commas, escaped quotes, and line breaks in CSV fields.
function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];

    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (character === "," || character === "\n" || character === "\r")) {
      row.push(field);
      field = "";
      if (character !== ",") {
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
        if (character === "\r" && csv[index + 1] === "\n") index += 1;
      }
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("Unclosed CSV field");
  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

export async function readRequests() {
  const csv = await readFile(
    path.join(process.cwd(), "data", "seed-requests.csv"),
    "utf8"
  );
  const [headers, ...rows] = parseCsv(csv);
  const requests = rows.map((row, index) => ({
    id: index + 1,
    ...Object.fromEntries(headers.map((header, column) => [header, row[column]])),
  }));

  requests.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return requests;
}

let pendingWrite = Promise.resolve();

export function createRequest(fields) {
  // Assign IDs and append rows in order when submissions arrive together.
  const write = pendingWrite.then(async () => {
    const filePath = path.join(process.cwd(), "data", "seed-requests.csv");
    const csv = await readFile(filePath, "utf8");
    const request = {
      id: parseCsv(csv).length,
      created_at: new Date().toISOString(),
      requester_name: fields.requester_name,
      location: fields.location,
      description: fields.description,
      priority: fields.priority,
      status: "New",
    };
    const values = [
      request.created_at,
      request.requester_name,
      request.location,
      request.description,
      request.priority,
      request.status,
    ];
    const row = values.map((value) => `"${value.replaceAll('"', '""')}"`).join(",");
    const separator = csv.endsWith("\n") || csv.endsWith("\r") ? "" : "\n";
    await appendFile(filePath, `${separator}${row}\n`, "utf8");
    return request;
  });

  // A failed save must not prevent subsequent submissions.
  pendingWrite = write.catch(() => {});
  return write;
}
