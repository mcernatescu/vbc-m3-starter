import { appendFile, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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

function queueWrite(operation) {
  const write = pendingWrite.then(operation);
  // A failed save must not prevent subsequent submissions.
  pendingWrite = write.catch(() => {});
  return write;
}

export function createRequest(fields) {
  // Assign IDs and append rows in order when submissions arrive together.
  return queueWrite(async () => {
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
}

export function updateRequestStatus(id, status) {
  return queueWrite(async () => {
    const filePath = path.join(process.cwd(), "data", "seed-requests.csv");
    const csv = await readFile(filePath, "utf8");
    const [headers, ...rows] = parseCsv(csv);
    // IDs follow source-row order, regardless of the table's date sorting.
    const row = rows[id - 1];
    if (!row) return null;
    const statusColumn = headers.indexOf("status");
    if (statusColumn === -1) throw new Error("Missing CSV status column");

    if (row[statusColumn] !== status) {
      row[statusColumn] = status;
      const updatedCsv = [headers, ...rows]
        .map((values) => values.map((value) => `"${value.replaceAll('"', '""')}"`).join(","))
        .join("\r\n") + "\r\n";
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, updatedCsv, "utf8");
        // Replace only after the complete CSV has been written successfully.
        await rename(temporaryPath, filePath);
      } finally {
        await unlink(temporaryPath).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    }

    return { id, ...Object.fromEntries(headers.map((header, column) => [header, row[column]])) };
  });
}
