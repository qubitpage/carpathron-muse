// Sets the Windows .exe icon and version info without needing Wine (pure JS via resedit).
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const { NtExecutable, NtExecutableResource, Data, Resource } = await import('resedit');
  const pkg = ctx.packager.appInfo;
  const exePath = path.join(ctx.appOutDir, `${pkg.productFilename}.exe`);
  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);

  const iconFile = Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));

  const v = pkg.version.split('.').map(Number);
  const vi = Resource.VersionInfo.fromEntries(res.entries)[0] || Resource.VersionInfo.createEmpty();
  vi.setFileVersion(v[0], v[1], v[2], 0, 1033);
  vi.setProductVersion(v[0], v[1], v[2], 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'Carpathron Robotics & Coding',
    ProductName: 'Carpathron Robotics & Coding',
    CompanyName: 'Qubitpage LIMITED',
    OriginalFilename: `${pkg.productFilename}.exe`,
    InternalName: pkg.productFilename,
    LegalCopyright: `Copyright ${new Date().getFullYear()} Qubitpage LIMITED`,
  });
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • afterPack: icon + version info set on ${path.basename(exePath)}`);
};
