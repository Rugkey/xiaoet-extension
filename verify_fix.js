const fs = require('fs');
const code = fs.readFileSync('./src/background/service-worker.js', 'utf8');

// Check for the exact changes
const hasMultiInValidation = code.includes("['google', 'deepseek', 'deepl', 'openai', 'multi']");
const hasContextParam = code.includes("context = ''");
const hasDomainPromptsWithContext = code.includes('Use the following context');

console.log('Fix verification:');
console.log('- Multi engine in validation:', hasMultiInValidation ? '✅' : '❌');
console.log('- Context param handling:', hasContextParam ? '✅' : '❌');
console.log('- Domain prompts with context:', hasDomainPromptsWithContext ? '✅' : '❌');

const allFixed = hasMultiInValidation && hasContextParam && hasDomainPromptsWithContext;
console.log('\nOverall result:', allFixed ? '✅ All fixes applied' : '❌ Some fixes missing');