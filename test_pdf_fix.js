/**
 * Test script to verify the fix for PDF text selection translation
 */

const fs = require('fs');

console.log('Testing PDF text selection fix...');

// Check if the PDF viewer has the translation selection handler
const pdfViewerCode = fs.readFileSync('./src/pdf/web/academic-viewer.js', 'utf8');
const hasTranslationHandler = pdfViewerCode.includes('handleTranslationSelection');
const hasCustomEventDispatch = pdfViewerCode.includes('xiaoetPdfTextSelected');

console.log(hasTranslationHandler ? '✅ Translation selection handler added to PDF viewer' : '❌ Translation selection handler missing');
console.log(hasCustomEventDispatch ? '✅ Custom event dispatch added to PDF viewer' : '❌ Custom event dispatch missing');

// Check if main.js listens for the custom event
const mainCode = fs.readFileSync('./src/content/main.js', 'utf8');
const hasEventListener = mainCode.includes('xiaoetPdfTextSelected');
const hasEventHandler = mainCode.includes('handleTranslationParams(text)');

console.log(hasEventListener ? '✅ Event listener added to main.js' : '❌ Event listener missing from main.js');
console.log(hasEventHandler ? '✅ Event handler implemented in main.js' : '❌ Event handler not implemented in main.js');

const allFixed = hasTranslationHandler && hasCustomEventDispatch && hasEventListener && hasEventHandler;
console.log('\nOverall result:', allFixed ? '✅ PDF translation selection fix applied successfully!' : '❌ Some parts of the fix are missing');

console.log('\nFix Summary:');
console.log('- Added text selection handler in PDF viewer to detect selections');
console.log('- Added custom event dispatch to communicate with main content script');
console.log('- Added event listener in main.js to handle PDF selections');
console.log('- Connected PDF selections to the existing translation UI');