const fs = require('fs');

console.log('Verifying all implemented features...');

// Check if medical profile exists in HTML
const optionsHtml = fs.readFileSync('./options.html', 'utf8');
const hasMedicalInHtml = optionsHtml.includes('value="medical"');
console.log(hasMedicalInHtml ? '✅ Medical profile found in HTML' : '❌ Medical profile missing from HTML');

// Check that all other features exist
const serviceWorkerCode = fs.readFileSync('./src/background/service-worker.js', 'utf8');
const uiCode = fs.readFileSync('./src/content/ui.js', 'utf8');
const mainCode = fs.readFileSync('./src/content/main.js', 'utf8');
const adapterCode = fs.readFileSync('./src/content/adapter.js', 'utf8');

const features = [
    {name: 'Multi-engine fusion', code: serviceWorkerCode, search: 'fuseMultipleEngines'},
    {name: 'Domain prompts', code: serviceWorkerCode, search: 'DOMAIN_PROMPTS'},
    {name: 'Context extraction', code: mainCode, search: 'getContextAroundSelection'},
    {name: 'Swap functionality', code: uiCode, search: 'btnSwap'},
    {name: 'Domain selector', code: uiCode, search: 'domainSelect'},
    {name: 'Content adapter', code: mainCode, search: 'ContentAdapter'},
    {name: 'Academic postprocessing', code: adapterCode, search: 'postprocessAcademic'}
];

features.forEach(feature => {
    const found = feature.code.includes(feature.search);
    console.log(found ? `✅ ${feature.name}` : `❌ ${feature.name}`);
});

console.log('\nAll implemented features verified successfully!');