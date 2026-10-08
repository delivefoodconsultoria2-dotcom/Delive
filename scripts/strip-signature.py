# Remove a assinatura Authenticode do node.exe antes de injetar o app,
# porque a injeção invalida a assinatura original do Node.
import struct, sys
p = sys.argv[1]
b = bytearray(open(p, "rb").read())
pe = struct.unpack_from("<I", b, 0x3C)[0]
assert b[pe:pe + 4] == b"PE\0\0"
opt = pe + 24
magic = struct.unpack_from("<H", b, opt)[0]
dd = opt + (112 if magic == 0x20B else 96)
sec = dd + 4 * 8
off, size = struct.unpack_from("<II", b, sec)
if off and size:
    struct.pack_into("<II", b, sec, 0, 0)
    if off + size >= len(b) - 8:
        del b[off:]
open(p, "wb").write(b)
print("assinatura removida" if off else "sem assinatura")
