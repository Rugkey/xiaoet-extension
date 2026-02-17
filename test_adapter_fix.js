/**
 * Test script to verify the fix for ContentAdapter not defined error
 */

const fs = require('fs');

console.log('Testing ContentAdapter fix...');

// Check if manifest.json includes adapter.js in content scripts
const manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
const contentScripts = manifest.content_scripts[0].js;
const webAccessibleResources = manifest.web_accessible_resources[0].resources;

const hasAdapterInContentScripts = contentScripts.includes('src/content/adapter.js');
const hasAdapterInWebResources = webAccessibleResources.includes('src/content/adapter.js');

console.log(hasAdapterInContentScripts ? '✅ adapter.js included in content scripts' : '❌ adapter.js missing from content scripts');
console.log(hasAdapterInWebResources ? '✅ adapter.js included in web accessible resources' : '❌ adapter.js missing from web resources');

// Check if PDF viewer HTML includes adapter.js
const pdfViewerHtml = fs.readFileSync('./src/pdf/web/academic-viewer.html', 'utf8');
const hasAdapterInPdfViewer = pdfViewerHtml.includes('src/content/adapter.js');

console.log(hasAdapterInPdfViewer ? '✅ adapter.js included in PDF viewer HTML' : '❌ adapter.js missing from PDF viewer HTML');

// Check if main.js has safety checks
const mainJs = fs.readFileSync('./src/content/main.js', 'utf8');
const hasSafetyCheck = mainJs.includes('typeof ContentAdapter !== \'undefined\'');
const hasSafeContextCall = mainJs.includes('adapter ? adapter.getContextAroundSelection');

console.log(hasSafetyCheck ? '✅ Safety check added for ContentAdapter initialization' : '❌ Safety check missing for ContentAdapter initialization');
console.log(hasSafeContextCall ? '✅ Safe call added for adapter methods' : '❌ Safe call missing for adapter methods');

const allFixed = hasAdapterInContentScripts && hasAdapterInWebResources && hasAdapterInPdfViewer && hasSafetyCheck && hasSafeContextCall;
console.log('\nOverall result:', allFixed ? '✅ ContentAdapter error fix applied successfully!' : '❌ Some parts of the fix are missing');

console.log('\nFix Summary:');
console.log('- Added adapter.js to content scripts in manifest.json');
console.log('- Added adapter.js to web accessible resources in manifest.json');
console.log('- Added adapter.js to PDF viewer HTML');
console.log('- Added safety checks to prevent ContentAdapter not defined errors');
console.log('- Ensured safe method calls when adapter may not be available');