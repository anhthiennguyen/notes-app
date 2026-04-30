import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
  const tmp = join(tmpdir(), `heic-${Date.now()}`);
  const inPath = `${tmp}.heic`;
  const outPath = `${tmp}.jpg`;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    await writeFile(inPath, Buffer.from(await file.arrayBuffer()));
    await execFileAsync("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", inPath, "--out", outPath]);

    const jpeg = await readFile(outPath);
    const base64 = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    return NextResponse.json({ src: base64 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("convert-heic error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    await Promise.allSettled([unlink(inPath), unlink(outPath)]);
  }
}
