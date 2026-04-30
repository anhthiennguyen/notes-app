import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
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

    const isHeic = file.type === "image/heic" || file.type === "image/heif" ||
      file.name.toLowerCase().endsWith(".heic") || file.name.toLowerCase().endsWith(".heif");

    if (isHeic) {
      const inPath = `${tmp}.heic`;
      const outPath = `${tmp}.jpg`;
      try {
        await writeFile(inPath, Buffer.from(await file.arrayBuffer()));
        await execFileAsync("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", inPath, "--out", outPath]);
        const buffer = await readFile(outPath);
        const compressed = await sharp(buffer)
          .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 75 })
          .toBuffer();
        const src = `data:image/jpeg;base64,${compressed.toString("base64")}`;
        return NextResponse.json({ src });
      } finally {
        await Promise.allSettled([unlink(inPath), unlink(outPath)]);
      }
    }

    // Non-HEIC: embed as-is
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "image/png";
    const src = `data:${mimeType};base64,${buffer.toString("base64")}`;
    return NextResponse.json({ src });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("upload-image error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
