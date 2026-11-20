# Writes the menus of Scientific Word 5.5 as an indented list, read from its English resource
# file (sw550ENUS.dll, the RT_MENU resources; menu 10 is the main menu, 21 the Compute menu with
# MuPAD). scripts/menus55-compare.mjs compares that list with opensw's menus.
#   pip install pefile;  python scripts/menus55-dump.py C:\sw55\sw550ENUS.dll > menus55.txt
import sys, pefile, struct
pe = pefile.PE(sys.argv[1])
out = []
for t in pe.DIRECTORY_ENTRY_RESOURCE.entries:
    if t.id != 4: continue
    for n in t.directory.entries:
        for l in n.directory.entries:
            d = pe.get_data(l.data.struct.OffsetToData, l.data.struct.Size)
            out.append(f"=== MENU {n.id}")
            i = 4; depth = 0; ends = []
            while i < len(d):
                flags = struct.unpack_from('<H', d, i)[0]; i += 2
                popup = flags & 0x10
                if not popup:
                    i += 2  # id
                j = i
                while d[j:j+2] != b'\0\0': j += 2
                s = d[i:j].decode('utf-16le'); i = j + 2
                out.append('  ' * depth + ('[M] ' if popup else '') + (s.replace('\t', ' ') if s else '----'))
                if popup:
                    ends.append(bool(flags & 0x80)); depth += 1
                elif flags & 0x80:
                    while ends:
                        depth -= 1
                        if not ends.pop(): break
                if depth == 0 and not popup and flags & 0x80 and not ends: pass
print('\n'.join(out))
