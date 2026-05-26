const fs = require('fs');

if (!fs.existsSync('src/tabs')) {
  fs.mkdirSync('src/tabs');
}

const appContextCode = `import React from 'react';
export const AppContext = React.createContext<any>(null);
`;
fs.writeFileSync('src/AppContext.tsx', appContextCode);

let appContent = fs.readFileSync('src/App.tsx', 'utf8');

const lastReturnIdx = appContent.lastIndexOf('  return (');
const body = appContent.substring(appContent.indexOf('export default function App() {'), lastReturnIdx);

const vars = [];
const regex = /(?:const|let|async function|function)\s+(?:\[([^\]]+)\]|([a-zA-Z0-9_]+))\s*(?:=|\()/g;
let match;
while ((match = regex.exec(body)) !== null) {
  if (match[1]) {
    vars.push(...match[1].split(',').map(s => s.trim()));
  } else if (match[2]) {
    vars.push(match[2].trim());
  }
}

// Ensure unique vars and eliminate keywords
const uniqueVars = [...new Set(vars)].filter(v => v && !['useState','useEffect','useRef','useMemo','useCallback','App'].includes(v));

// Extract the icon imports from App.tsx
const iconMatch = appContent.match(/import\s+\{([^}]+)\}\s+from\s+["']lucide-react["']/);
const iconsStr = iconMatch ? iconMatch[1] : '';

// Extracted tags
function extractTab(tabName, componentName) {
  const startStr = `{activeTab === "${tabName}" && (`;
  const startIdx = appContent.indexOf(startStr);
  if (startIdx === -1) return false;
  
  let openCount = 0;
  let endIdx = -1;
  for (let i = startIdx + startStr.length - 1; i < appContent.length; i++) {
    if (appContent[i] === '(') openCount++;
    if (appContent[i] === ')') openCount--;
    if (openCount === 0) {
      endIdx = i;
      break;
    }
  }
  
  if (endIdx === -1) return false;
  
  const innerContent = appContent.substring(startIdx + startStr.length, endIdx);
  
  const compCode = `import React, { useContext } from "react";
import { AppContext } from "../AppContext";
import { ${iconsStr} } from "lucide-react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "../components/ui/accordion";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

export default function ${componentName}() {
  const { ${uniqueVars.join(', ')} } = useContext(AppContext);
  return (
    ${innerContent}
  );
}
`;
  fs.writeFileSync(`src/tabs/${componentName}.tsx`, compCode);
  
  // Replace in App
  appContent = appContent.substring(0, startIdx) + 
               `{activeTab === "${tabName}" && <${componentName} />}` + 
               appContent.substring(endIdx + 1);
               
  // Ensure import
  appContent = `import ${componentName} from "./tabs/${componentName}";\n` + appContent;
  return true;
}

extractTab('settings', 'SettingsTab');
extractTab('global-worldbook', 'GlobalWorldbookTab');
extractTab('chat', 'ChatTab');
extractTab('chat-history', 'ChatHistoryTab');
extractTab('characters', 'CharactersTab');

// Wrap return with Provider
const returnStmt = '  return (';
const returnIdxRe = appContent.lastIndexOf('  return (');
const providerValue = `{ ${uniqueVars.join(', ')} }`;
const replacementVal = `  const appContextValue = ${providerValue};\n` + returnStmt + `\n    <AppContext.Provider value={appContextValue}>`;
appContent = appContent.substring(0, returnIdxRe) + replacementVal + appContent.substring(returnIdxRe + returnStmt.length);

const finalClosing = appContent.lastIndexOf(')');
const finalReplacement = `    </AppContext.Provider>\n  )`;
appContent = appContent.substring(0, finalClosing) + finalReplacement + appContent.substring(finalClosing + 1);

appContent = `import { AppContext } from "./AppContext";\n` + appContent;

fs.writeFileSync('src/App.tsx', appContent);

console.log('Extraction success?');
