// Sets the Windows .exe icon and version info with a pure-JS resource editor,
// so the installer can be built on Windows, Linux or macOS without wine/rcedit.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { NtExecutable, NtExecutableResource, Data, Resource } = await import('resedit');
  const app = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${app.productFilename}.exe`);
  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);

  const iconFile = Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map(i => i.data));

  const vi = Resource.VersionInfo.fromEntries(res.entries)[0] || Resource.VersionInfo.createEmpty();
  const [a, b, c] = app.version.split('.').map(Number);
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: app.productName, ProductName: app.productName, CompanyName: app.companyName || app.productName,
    LegalCopyright: `Copyright © ${new Date().getFullYear()} ${app.productName}`, OriginalFilename: `${app.productFilename}.exe`, InternalName: app.productName
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('  • afterPack: icon and version info set on', path.basename(exePath));
};
