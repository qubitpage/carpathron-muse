#!/usr/bin/env python3
"""Build a Microsoft Store MSIX/AppX package on any OS (no Windows SDK needed).

Writes the same layout as Microsoft's makeappx / MSIX SDK packer (github.com/microsoft/msix-packaging, src/msix/pack):
  - ZIP with Zip64 end records, local headers with the data-descriptor flag and Zip64 data descriptors
  - each file deflated in 64 KB blocks (Z_FULL_FLUSH after every block, then Z_FINISH), or stored for
    already-compressed types (png, jpg, zip, ...)
  - AppxBlockMap.xml: SHA-256 of every 64 KB uncompressed block (+ compressed size), LfhSize per file
  - [Content_Types].xml with Default/Override entries
The package is unsigned: the Microsoft Store signs it after certification.

Usage: pack-msix.py <win-unpacked dir> <assets dir> <AppxManifest.xml> <out.msix>
Payload layout (as electron-builder): app\\<files>, assets\\<tiles>, AppxManifest.xml.
"""
import base64, hashlib, os, struct, sys, time, zlib
from xml.sax.saxutils import escape, quoteattr

BLOCK = 64 * 1024

# Extensions stored without compression and content types (subset of MSIX SDK ContentType.cpp; default octet-stream/deflate)
CT = {
    'appx': ('application/vnd.ms-appx', False), 'cab': ('application/vnd.ms-cab-compressed', False),
    'dll': ('application/x-msdownload', True), 'exe': ('application/x-msdownload', True),
    'gz': ('application/x-gzip-compressed', False), 'json': ('application/json', True), 'pdf': ('application/pdf', True),
    'zip': ('application/x-zip-compressed', False), 'rar': ('application/x-rar-compressed', False),
    'tar': ('application/x-tar', False), 'css': ('text/css', True), 'csv': ('text/csv', True),
    'htm': ('text/html', True), 'html': ('text/html', True), 'js': ('application/x-javascript', True),
    'txt': ('text/plain', True), 'xml': ('text/xml', True), 'xsd': ('text/xml', True),
    'm4a': ('audio/mp4', False), 'mp3': ('audio/mpeg', False), 'wav': ('audio/wav', True), 'wma': ('audio/x-ms-wma', False),
    'bmp': ('image/bmp', True), 'gif': ('image/gif', False), 'ico': ('image/vnd.microsoft.icon', True),
    'jpg': ('image/jpeg', False), 'jpeg': ('image/jpeg', False), 'png': ('image/png', False), 'svg': ('image/svg+xml', True),
    'tif': ('image/tiff', True), 'tiff': ('image/tiff', True), 'avi': ('video/avi', False), 'mpeg': ('video/mpeg', False),
    'mpg': ('video/mpeg', False), 'mov': ('video/quicktime', False), 'wmv': ('video/x-ms-wmv', False),
}
DEFAULT_CT = ('application/octet-stream', True)
ENC = {' ': '%20', '!': '%21', '#': '%23', '$': '%24', '%': '%25', '&': '%26', "'": '%27', '(': '%28', ')': '%29',
       '+': '%2B', ',': '%2C', ';': '%3B', '=': '%3D', '@': '%40', '[': '%5B', ']': '%5D', '^': '%5E', '`': '%60',
       '{': '%7B', '}': '%7D'}


def opc_name(name):  # percent-encode like Encoding::EncodeFileName; '\\' -> '/'; non-ASCII as UTF-8 %XX
    out = []
    for ch in name:
        if ch in ENC: out.append(ENC[ch])
        elif ch == '\\': out.append('/')
        elif ord(ch) > 0x7F: out.extend('%%%02X' % b for b in ch.encode('utf-8'))
        else: out.append(ch)
    return ''.join(out)


def dos_time(t=None):
    lt = time.localtime(t or time.time())
    return ((lt.tm_hour << 11) | (lt.tm_min << 5) | (lt.tm_sec // 2),
            (((lt.tm_year - 1980) & 0x7F) << 9) | (lt.tm_mon << 5) | lt.tm_mday)


class Packer:
    def __init__(self, out):
        self.f = open(out, 'wb')
        self.cd = []  # (name_bytes, crc, csize, usize, offset, method)
        self.blockmap = []
        self.defaults = {}  # ext(lower) -> content type
        self.ct_lines = []
        self.dtime, self.ddate = dos_time()

    def _content_type(self, name, ctype, force_override=False):
        enc = opc_name(name)
        fname = enc.rsplit('/', 1)[-1]
        if force_override or '.' not in fname:
            self.ct_lines.append('<Override ContentType=%s PartName=%s/>' % (quoteattr(ctype), quoteattr('/' + enc)))
            return
        ext = fname.rsplit('.', 1)[1]
        low = ext.lower()
        if low in self.defaults:
            if self.defaults[low] != ctype:
                self.ct_lines.append('<Override ContentType=%s PartName=%s/>' % (quoteattr(ctype), quoteattr('/' + enc)))
        else:
            self.defaults[low] = ctype
            self.ct_lines.append('<Default ContentType=%s Extension=%s/>' % (quoteattr(ctype), quoteattr(ext)))

    def add(self, name, data, compress, ctype=None, in_blockmap=True):
        """name uses '\\' separators like Windows; data: bytes."""
        zname = opc_name(name) if ctype is not None else name
        nb = zname.encode('utf-8')
        if ctype is not None: self._content_type(name, ctype)
        offset = self.f.tell()
        method = 8 if compress else 0
        # Local file header: version 45, flag 0x0008 (data descriptor), crc/sizes 0, no extra field
        lfh = struct.pack('<IHHHHHIIIHH', 0x04034b50, 45, 0x0008, method, self.dtime, self.ddate, 0, 0, 0, len(nb), 0) + nb
        self.f.write(lfh)
        blocks = []
        crc = 0
        written = 0
        comp = zlib.compressobj(9, zlib.DEFLATED, -15, 9, zlib.Z_DEFAULT_STRATEGY) if compress else None
        for i in range(0, len(data), BLOCK):
            blk = data[i:i + BLOCK]
            crc = zlib.crc32(blk, crc)
            out = (comp.compress(blk) + comp.flush(zlib.Z_FULL_FLUSH)) if compress else blk
            self.f.write(out); written += len(out)
            blocks.append((base64.b64encode(hashlib.sha256(blk).digest()).decode(), len(out)))
        if compress:
            tail = comp.flush(zlib.Z_FINISH)
            self.f.write(tail); written += len(tail)
        crc &= 0xFFFFFFFF
        # Zip64 data descriptor: signature, crc, 8-byte compressed and uncompressed sizes
        self.f.write(struct.pack('<IIQQ', 0x08074b50, crc, written, len(data)))
        self.cd.append((nb, crc, written, len(data), offset, method))
        if in_blockmap:
            parts = ['<File Name=%s Size="%d" LfhSize="%d">' % (quoteattr(name.replace('/', '\\')), len(data), len(lfh))]
            for h, sz in blocks:
                parts.append('<Block Hash="%s" Size="%d"/>' % (h, sz) if compress else '<Block Hash="%s"/>' % h)
            parts.append('</File>')
            self.blockmap.append(''.join(parts))

    def add_payload(self, name, path):
        ext = name.rsplit('.', 1)[-1].lower() if '.' in name.rsplit('\\', 1)[-1] else ''
        ctype, compress = CT.get(ext, DEFAULT_CT)
        with open(path, 'rb') as fh:
            self.add(name, fh.read(), compress, ctype)

    def close(self, manifest_bytes):
        self.add('AppxManifest.xml', manifest_bytes, True, 'application/vnd.ms-appx.manifest+xml')
        bm = ('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\r\n'
              '<BlockMap xmlns="http://schemas.microsoft.com/appx/2010/blockmap" HashMethod="http://www.w3.org/2001/04/xmlenc#sha256">'
              + ''.join(self.blockmap) + '</BlockMap>').encode('utf-8')
        # The block map itself: content type override, not listed in the block map
        self._content_type('AppxBlockMap.xml', 'application/vnd.ms-appx.blockmap+xml', force_override=True)
        self.add('AppxBlockMap.xml', bm, True, None, in_blockmap=False)
        ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
              '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + ''.join(self.ct_lines) + '</Types>').encode('utf-8')
        self.add('[Content_Types].xml', ct, True, None, in_blockmap=False)
        # Central directory
        start = self.f.tell()
        for nb, crc, cs, us, off, method in self.cd:
            extra = b''
            fields = []
            if us > 0xFFFFFFFE: fields.append(struct.pack('<Q', us))
            if cs > 0xFFFFFFFE: fields.append(struct.pack('<Q', cs))
            if off > 0xFFFFFFFE: fields.append(struct.pack('<Q', off))
            if fields:
                body = b''.join(fields); extra = struct.pack('<HH', 1, len(body)) + body
            self.f.write(struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 45, 45, 0x0008, method, self.dtime, self.ddate, crc,
                                     min(cs, 0xFFFFFFFF) if cs <= 0xFFFFFFFE else 0xFFFFFFFF,
                                     us if us <= 0xFFFFFFFE else 0xFFFFFFFF, len(nb), len(extra), 0, 0, 0, 0,
                                     off if off <= 0xFFFFFFFE else 0xFFFFFFFF) + nb + extra)
        size = self.f.tell() - start
        z64 = self.f.tell()
        n = len(self.cd)
        self.f.write(struct.pack('<IQHHIIQQQQ', 0x06064b50, 44, 45, 45, 0, 0, n, n, size, start))
        self.f.write(struct.pack('<IIQI', 0x07064b50, 0, z64, 1))
        self.f.write(struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, 0xFFFF, 0xFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0))
        self.f.close()


def main():
    src, assets, manifest, out = sys.argv[1:5]
    p = Packer(out)
    files = []
    for root, _, names in os.walk(src):
        for n in names:
            full = os.path.join(root, n)
            files.append(('app\\' + os.path.relpath(full, src).replace(os.sep, '\\'), full))
    for n in sorted(os.listdir(assets)):
        if n.lower().endswith('.png'):
            files.append(('assets\\' + n, os.path.join(assets, n)))
    for name, full in sorted(files, key=lambda x: x[0].lower()):
        p.add_payload(name, full)
    with open(manifest, 'rb') as fh:
        p.close(fh.read())
    print(f'{out}: {len(files)} files, {os.path.getsize(out) / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
