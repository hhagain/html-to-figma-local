const path = require('node:path');
const { writeDependencyManifest } = require('./runtime-check.cjs');
module.exports = async context => {
  if(context.electronPlatformName !== 'win32') return;
  const resources=path.join(context.appOutDir,'resources');
  const manifest=writeDependencyManifest(resources);
  console.log('Verified packaged capture dependencies: '+manifest.packages.map(p=>p.name+'@'+p.version).join(', ')+'; '+manifest.files.length+' files.');
};
