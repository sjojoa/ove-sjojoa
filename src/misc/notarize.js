const { notarize } = require('electron-notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;  
  if (electronPlatformName !== 'darwin' || !process.env.APPLEID) {
    return; // nothing to notarize (e.g. local unsigned builds)
  }

  const appName = context.packager.appInfo.productFilename;

  return await notarize({
    appBundleId: context.packager.appInfo.id,
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLEID,
    appleIdPassword: process.env.APPLEIDPASS,
  });
};