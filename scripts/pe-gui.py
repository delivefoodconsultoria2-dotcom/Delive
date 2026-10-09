# Marca o .exe como programa de janela (GUI) para não abrir a janela preta do console.
import struct, sys
p = sys.argv[1]
b = bytearray(open(p, "rb").read())
pe = struct.unpack_from("<I", b, 0x3C)[0]
assert b[pe:pe + 4] == b"PE\0\0"
struct.pack_into("<H", b, pe + 24 + 68, 2)  # IMAGE_SUBSYSTEM_WINDOWS_GUI
open(p, "wb").write(b)
