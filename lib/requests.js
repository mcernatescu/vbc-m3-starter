import "server-only";
import { getSupabase } from "./supabase";

const COLUMNS = "id,created_at,requester_name,location,description,priority,status";
const PAGE_SIZE = 500;

export async function readRequests() {
  const supabase = getSupabase();
  const requests = [];
  let lastId;

  // Page by the stable primary key, including when the server caps page sizes.
  while (true) {
    let query = supabase.from("requests").select(COLUMNS)
      .order("id", { ascending: true }).limit(PAGE_SIZE);
    if (lastId !== undefined) query = query.gt("id", lastId);
    const { data, error } = await query;
    if (error || !data) throw new Error("Could not read requests.");
    if (data.length === 0) break;
    requests.push(...data);
    lastId = data[data.length - 1].id;
  }

  requests.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  return requests;
}

export async function createRequest(fields) {
  const { data, error } = await getSupabase().from("requests")
    .insert({
      requester_name: fields.requester_name,
      location: fields.location,
      description: fields.description,
      priority: fields.priority,
      status: "New",
    })
    .select(COLUMNS)
    .single();
  // The database supplies the identity ID and creation timestamp.
  if (error || !data) throw new Error("Could not save the request.");
  return data;
}

export async function updateRequestStatus(id, status) {
  const { data, error } = await getSupabase().from("requests")
    .update({ status })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new Error("Could not update the request status.");
  return data;
}
