"""Minimal asar archive reader: list / extract entries without external deps."""
import json
import os
import struct
import sys

ASAR = r"C:\Users\anixuil\AppData\Local\Programs\DeepSeek Harness\resources\app.asar"


def load_header(path):
    with open(path, "rb") as f:
        head = f.read(64)
        u32_at_4 = struct.unpack("<I", head[4:8])[0]
        f.seek(0)
        probe = f.read(4 * 1024 * 1024)
    marker = probe.find(b'{"files":')
    if marker < 0:
        raise RuntimeError("header JSON not found")
    text = probe[marker:].decode("utf-8", errors="replace")
    header, consumed = json.JSONDecoder().raw_decode(text)
    data_start = 8 + u32_at_4
    # sanity: header JSON must sit inside the header region
    if not (marker + consumed <= data_start + 64):
        print(f"warn: header json ends at {marker + consumed}, data_start={data_start}", file=sys.stderr)
    return header, data_start


def walk(node, prefix=""):
    for name, entry in node.get("files", {}).items():
        full = f"{prefix}/{name}" if prefix else name
        if "files" in entry:
            yield from walk(entry, full)
        else:
            yield full, entry


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "list"
    keyword = sys.argv[2] if len(sys.argv) > 2 else ""
    header, data_start = load_header(ASAR)
    total = os.path.getsize(ASAR)
    entries = [(p, e) for p, e in walk(header) if keyword.lower() in p.lower()]
    print(f"# asar={total} data_start={data_start} entries={len(entries)}", file=sys.stderr)
    if mode == "list":
        for p, e in sorted(entries):
            print(f"{e.get('size', 0):>9}  {p}")
        print(f"\nmatched: {len(entries)}")
        return
    if mode == "extract":
        out_root = sys.argv[3]
        with open(ASAR, "rb") as f:
            for p, e in sorted(entries):
                dest = os.path.join(out_root, p.replace("/", os.sep))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                f.seek(data_start + int(e["offset"]))
                with open(dest, "wb") as out:
                    out.write(f.read(e["size"]))
        print(f"extracted {len(entries)} files -> {out_root}")
        return


if __name__ == "__main__":
    main()
