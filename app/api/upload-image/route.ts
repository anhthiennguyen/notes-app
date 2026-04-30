import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { execFile } from "child_process";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
  const tmp = join(tmpdir(), `img-${Date.now()}`);

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    let buffer: Buffer;
    let filename = file.name;

    const isHeic = file.type === "image/heic" || file.type === "image/heif" ||
      filename.toLowerCase().endsWith(".heic") || filename.toLowerCase().endsWith(".heif");

    if (isHeic) {
      const inPath = `${tmp}.heic`;
      const outPath = `${tmp}.jpg`;
      try {
        await writeFile(inPath, Buffer.from(await file.arrayBuffer()));
        await execFileAsync("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", inPath, "--out", outPath]);
        buffer = await readFile(outPath);
        filename = filename.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg");
      } finally {
        await Promise.allSettled([unlink(inPath), unlink(`${tmp}.jpg`)]);
      }
    } else {
      buffer = Buffer.from(await file.arrayBuffer());
    }

    const blob = await put(filename, buffer, { access: "public" });
    return NextResponse.json({ src: blob.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("upload-image error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
