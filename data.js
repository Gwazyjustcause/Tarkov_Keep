"use strict";

async function readSnapshot(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}: HTTP ${response.status}`);
  if (!path.endsWith(".gz")) return response.json();

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 31 || bytes[1] !== 139) {
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json();
}
