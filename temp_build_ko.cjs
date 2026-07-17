const fs = require('fs');
const path = require('path');

// Read the koTranslations from the verification script
const koTranslations = require('./temp_gen_ko.cjs');

// Read the file
const filePath = path.join(__dirname, 'src', 'locales', 'translations.ts');
const originalContent = fs.readFileSync(filePath, 'utf8');

// Normalize line endings
const content = originalContent.replace(/\r\n/g, '\n');

// Extract the en section to use its line structure as template
const enStart = content.indexOf('"en":');
const enEndTag = '  },\n  "ja":';
const enEndIdx = content.indexOf(enEndTag, enStart);
const enSectionRaw = content.substring(enStart, enEndIdx);

const enLines = enSectionRaw.split('\n');
let koLines = [];

// Process each line of the en section
for (let i = 0; i < enLines.length; i++) {
  const line = enLines[i];
  const trimmed = line.trim();

  if (i === 0) {
    // Replace "en" section header with "ko"
    koLines.push('  "ko": {');
    continue;
  }

  if (!trimmed) {
    koLines.push(line);
    continue;
  }

  // Skip the last line if it's the section closing (it's not included in extraction)
  if (trimmed === '{' || trimmed === '},') {
    koLines.push(line);
    continue;
  }

  // Match key-value pairs
  const match = trimmed.match(/^\s*"([^"]+)"\s*:\s*"(.+)",?$/);
  if (match) {
    const key = match[1];
    const koValue = koTranslations[key];
    if (koValue !== undefined) {
      const indent = line.match(/^(\s*)/)[1];
      const escapedKo = koValue
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
      koLines.push(indent + '"' + key + '": "' + escapedKo + '",');
    } else {
      console.log('WARNING: Missing translation for key:', key);
      koLines.push(line);
    }
  } else {
    // Non-matching lines (empty, brackets, etc.)
    koLines.push(line);
  }
}

// The en section extraction doesn't include the closing '  },' 
// because it was used as the end delimiter. Add it manually.
koLines.push('  }');

const koSection = koLines.join('\n');

// The file ends with:
//   "nav.playground": "Sandbox",
//   }
// };
// 
// We need to replace the last section closing:
//   "nav.playground": "Sandbox",
//   },\n\n  "ko": {\n    ...\n  }\n};

// Find the LAST occurrence of '\n  }\n};'
// which is the es section closing + file closing
const closingPattern = '\n  }\n};';
const lastClosingPos = content.lastIndexOf(closingPattern);

if (lastClosingPos === -1) {
  console.log('ERROR: Could not find closing pattern');
  // Debug: show last 100 chars
  console.log('Last 100 chars:', JSON.stringify(content.slice(-100)));
  process.exit(1);
}

// Build the new content:
// Everything before the closing pattern + ',' + '\n\n' + koSection + '\n};\n'
const newContent = 
  content.substring(0, lastClosingPos) +   // everything before '\n  }'
  '\n  },\n\n' +                            // close es with comma, add blank line
  koSection + '\n' +                        // ko section
  '};\n';                                   // final closing

// Write back with original line endings (CRLF on Windows)
const finalContent = newContent.replace(/\n/g, '\r\n');
fs.writeFileSync(filePath, finalContent, 'utf8');

console.log('KO section inserted successfully!');
console.log('Original size:', originalContent.length, 'chars');
console.log('New size:', finalContent.length, 'chars');

// Verify the structure by reading key areas
const verifyContent = finalContent.replace(/\r\n/g, '\n');
const esEnd = verifyContent.lastIndexOf('\n  },\n\n  "ko":');
const koEnd = verifyContent.lastIndexOf('\n  }\n};');
console.log('es section end found at:', esEnd !== -1);
console.log('ko section end found at:', koEnd !== -1);

// Count keys
const koStart = verifyContent.lastIndexOf('\n  "ko": {');
const koSectionText = verifyContent.substring(koStart);
const keyMatches = koSectionText.match(/"([^"]+)"\s*:\s*"/g);
console.log('Keys in ko section:', keyMatches ? keyMatches.length : 0);
